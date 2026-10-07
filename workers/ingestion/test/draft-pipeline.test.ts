import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  aclParityProbe,
  DRAFT_CHECKS_PER_DAY,
  DRAFT_LIVE_RECALL_FLOOR,
  decideChecks,
  MutationPendingError,
  reconcileDraft,
  reserveCheckRun,
  aggregateRecall,
  runRetrievalBatch,
  type EvalFixture,
} from "../../../src/lib/ingest/draft-checks";
import {
  copyBaseChunkPage,
  copyBaseDocuments,
  embedChunkRange,
  finalizeDocument,
  writeDocumentChunks,
  type DocumentToIndex,
} from "../../../src/lib/ingest/draft-index";
import { generationNamespace, vectorIdForChunk } from "../../../src/lib/ingest/digests";
import { ensureDraftGeneration } from "../../../src/lib/store/corpus-d1";
import { closeDraft, ensureOpenDraft, failDraft, getOpenDraft } from "../../../src/lib/store/drafts";
import { ACTIVE_DOCUMENTS, db, fakeAi, fakeVectors, resetPipeline, seedActive } from "./helpers";

beforeEach(resetPipeline);

function deptDoc(documentId: string, departments: string[]): DocumentToIndex {
  return {
    documentId,
    title: documentId,
    sourcePath: `uploads/${documentId}.md`,
    sourceName: `${documentId}.md`,
    accessScope: "department",
    allowedRoles: [],
    allowedDepartments: departments,
    metadata: {},
    r2Key: `uploads/test/${documentId}`,
  };
}

async function newDraft(kind: "upload" | "reindex" = "upload") {
  const { draft } = await ensureOpenDraft(db(), { kind, createdBy: "admin-test" });
  return draft;
}

describe("single open draft", () => {
  it("reuses the open draft and creates a new one only after it closes", async () => {
    await seedActive();
    const first = await newDraft();
    const again = await ensureOpenDraft(db(), { kind: "upload", createdBy: "someone-else" });
    expect(again.created).toBe(false);
    expect(again.draft.generationId).toBe(first.generationId);
    await failDraft(db(), first.generationId, "TEST");
    expect(await getOpenDraft(db())).toBeNull();
    const next = await newDraft();
    expect(next.generationId).not.toBe(first.generationId);
  });

  it("the database refuses a second open draft even if the app check is bypassed", async () => {
    const first = await newDraft();
    await ensureDraftGeneration(db(), "g-bypass");
    await expect(
      env.CORPUS_DB.prepare(
        "INSERT INTO drafts (generation_id, kind, created_by, created_at) VALUES ('g-bypass', 'upload', 'x', 1)",
      ).run(),
    ).rejects.toThrow();
    await closeDraft(db(), first.generationId);
  });
});

describe("copy-on-write base copy", () => {
  it("copies every base document and chunk with new ids and reuses base embeddings", async () => {
    const vectors = fakeVectors();
    const ai = fakeAi();
    const active = await seedActive({ ai, vectors });
    const draft = await newDraft();
    expect(draft.baseGenerationId).toBe(active.generationId);
    await copyBaseDocuments(db(), {
      draftGenerationId: draft.generationId,
      baseGenerationId: active.generationId,
    });
    const embedsBefore = ai.embedded.length;
    let after = 0;
    let copied = 0;
    for (;;) {
      const page = await copyBaseChunkPage(
        { db: db(), ai, vectors: vectors.port },
        { draftGenerationId: draft.generationId, baseGenerationId: active.generationId, afterId: after },
      );
      copied += page.copied;
      expect(page.baseVectorsMissing).toBe(0);
      if (page.nextAfterId === null) break;
      after = page.nextAfterId;
    }
    expect(copied).toBe(active.chunkCount);
    // No embedding call: the base vectors were fetched and reused.
    expect(ai.embedded.length).toBe(embedsBefore);
    const rows = await env.CORPUS_DB.prepare(
      "SELECT chunk_id, vector_id, generation_id FROM chunks WHERE generation_id = ?",
    )
      .bind(draft.generationId)
      .all<{ chunk_id: string; vector_id: string }>();
    expect(rows.results).toHaveLength(active.chunkCount);
    const namespace = await generationNamespace(draft.generationId);
    for (const row of rows.results) {
      expect(row.chunk_id.endsWith(`--${draft.generationId}`)).toBe(true);
      expect(row.vector_id).toBe(await vectorIdForChunk(row.chunk_id));
      expect(vectors.store.get(row.vector_id)?.namespace).toBe(namespace);
    }
    const catalog = await env.CORPUS_DB.prepare(
      "SELECT COUNT(*) AS n FROM document_catalog WHERE generation_id = ?",
    )
      .bind(draft.generationId)
      .first<{ n: number }>();
    expect(catalog?.n).toBe(ACTIVE_DOCUMENTS.length);
  });

  it("is idempotent: running a page twice leaves the same rows", async () => {
    const active = await seedActive();
    const draft = await newDraft();
    const run = async () => {
      await copyBaseDocuments(db(), {
        draftGenerationId: draft.generationId,
        baseGenerationId: active.generationId,
      });
      await copyBaseChunkPage(
        { db: db(), ai: null, vectors: null },
        { draftGenerationId: draft.generationId, baseGenerationId: active.generationId, afterId: 0 },
      );
    };
    await run();
    await run();
    const n = await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE generation_id = ?")
      .bind(draft.generationId)
      .first<{ n: number }>();
    expect(n?.n).toBe(active.chunkCount);
  });

  it("reports base vectors the index no longer has", async () => {
    const vectors = fakeVectors();
    const active = await seedActive({ ai: fakeAi(), vectors });
    const first = await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ? LIMIT 1")
      .bind(active.generationId)
      .first<{ vector_id: string }>();
    vectors.drop(first!.vector_id);
    const draft = await newDraft();
    await copyBaseDocuments(db(), { draftGenerationId: draft.generationId, baseGenerationId: active.generationId });
    const page = await copyBaseChunkPage(
      { db: db(), ai: null, vectors: vectors.port },
      { draftGenerationId: draft.generationId, baseGenerationId: active.generationId, afterId: 0 },
    );
    expect(page.baseVectorsMissing).toBe(1);
  });
});

describe("document write, replace and embedding reuse", () => {
  it("replaces a document: old chunks and vectors go, new ones are written", async () => {
    const vectors = fakeVectors();
    const ai = fakeAi();
    const draft = await newDraft();
    const ctx = { db: db(), ai, vectors: vectors.port };
    const doc = deptDoc("upl-replace", ["hr"]);
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about onboarding paperwork and forms.`).join(" ");
    const first = await writeDocumentChunks(ctx, {
      generationId: draft.generationId,
      doc,
      body: `# Onboarding\n\n${long}`,
      ensureDocumentRow: true,
    });
    await embedChunkRange(ctx, { generationId: draft.generationId, documentId: doc.documentId, from: 0, to: first.chunkCount, reuseFromGenerationId: null });
    const idsBefore = [...vectors.store.keys()];
    expect(idsBefore.length).toBe(first.chunkCount);
    const second = await writeDocumentChunks(ctx, {
      generationId: draft.generationId,
      doc,
      body: "# Onboarding\n\nShort now.",
      ensureDocumentRow: true,
    });
    expect(second.chunkCount).toBe(1);
    const rows = await env.CORPUS_DB.prepare(
      "SELECT COUNT(*) AS n FROM chunks WHERE generation_id = ? AND document_id = ?",
    )
      .bind(draft.generationId, doc.documentId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
    // Every old vector was deleted before the new rows were written.
    expect(vectors.deleted.sort()).toEqual(idsBefore.sort());
  });

  it("embeds only new chunks and reuses embeddings for unchanged text", async () => {
    const vectors = fakeVectors();
    const ai = fakeAi();
    const active = await seedActive({ ai, vectors });
    const draft = await newDraft();
    const ctx = { db: db(), ai, vectors: vectors.port };
    const unchanged = ACTIVE_DOCUMENTS[0].body;
    const before = ai.embedded.length;
    const doc = deptDoc("upl-reuse", ["hr"]);
    // The same text as an existing active document, plus nothing new.
    const written = await writeDocumentChunks(ctx, {
      generationId: draft.generationId,
      doc,
      body: unchanged,
      ensureDocumentRow: true,
    });
    const result = await embedChunkRange(ctx, {
      generationId: draft.generationId,
      documentId: doc.documentId,
      from: 0,
      to: written.chunkCount,
      reuseFromGenerationId: active.generationId,
    });
    expect(result.reused).toBe(written.chunkCount);
    expect(result.embedded).toBe(0);
    expect(ai.embedded.length).toBe(before);
    // A genuinely new document does call the model.
    const fresh = deptDoc("upl-fresh", ["hr"]);
    const w2 = await writeDocumentChunks(ctx, {
      generationId: draft.generationId,
      doc: fresh,
      body: "# Fresh\n\nBrand new words nobody has embedded.",
      ensureDocumentRow: true,
    });
    const r2 = await embedChunkRange(ctx, { generationId: draft.generationId, documentId: fresh.documentId, from: 0, to: w2.chunkCount, reuseFromGenerationId: active.generationId });
    expect(r2.embedded).toBe(w2.chunkCount);
    expect(ai.embedded.length).toBe(before + w2.chunkCount);
  });

  it("with no AI or index bound it writes no vectors and says so", async () => {
    const draft = await newDraft();
    const ctx = { db: db(), ai: null, vectors: null };
    const doc = deptDoc("upl-kw", ["hr"]);
    const written = await writeDocumentChunks(ctx, { generationId: draft.generationId, doc, body: "# K\n\nwords", ensureDocumentRow: true });
    const result = await embedChunkRange(ctx, { generationId: draft.generationId, documentId: doc.documentId, from: 0, to: written.chunkCount, reuseFromGenerationId: null });
    expect(result).toEqual({ embedded: 0, reused: 0, skipped: written.chunkCount });
    await finalizeDocument(ctx, { generationId: draft.generationId, doc, body: "# K\n\nwords", department: null });
  });
});

describe("reconciliation", () => {
  async function draftWithVectors(options: { lag?: boolean } = {}) {
    const vectors = fakeVectors(options);
    const ai = fakeAi();
    const draft = await newDraft();
    const ctx = { db: db(), ai, vectors: vectors.port };
    const doc = deptDoc(`upl-rec-${crypto.randomUUID().slice(0, 8)}`, ["hr"]);
    const written = await writeDocumentChunks(ctx, { generationId: draft.generationId, doc, body: "# R\n\nreconcile me please", ensureDocumentRow: true });
    await embedChunkRange(ctx, { generationId: draft.generationId, documentId: doc.documentId, from: 0, to: written.chunkCount, reuseFromGenerationId: null });
    return { vectors, draft, doc };
  }

  it("with no index bound it records keyword_only, a complete clean audit, and reconciles", async () => {
    const draft = await newDraft();
    const outcome = await reconcileDraft({ db: db(), vectors: null, generationId: draft.generationId });
    expect(outcome).toMatchObject({ mode: "keyword_only", reconciled: true, status: "complete", missing: 0 });
    const audit = await env.CORPUS_DB.prepare(
      "SELECT status, missing_count, orphan_count FROM reconciliation_audits WHERE id = ?",
    )
      .bind(draft.generationId)
      .first<Record<string, unknown>>();
    expect(audit).toEqual({ status: "complete", missing_count: 0, orphan_count: 0 });
  });

  it("waits (by throwing) until the index processed the newest mutation", async () => {
    const { vectors, draft } = await draftWithVectors({ lag: true });
    await expect(
      reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId }),
    ).rejects.toBeInstanceOf(MutationPendingError);
    vectors.catchUp();
    const outcome = await reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId });
    expect(outcome).toMatchObject({ mode: "ledger_getbyids", reconciled: true, status: "complete", missing: 0 });
  });

  it("fails reconciliation when a ledger vector is missing from the index", async () => {
    const { vectors, draft, doc } = await draftWithVectors();
    const row = await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ? AND document_id = ?")
      .bind(draft.generationId, doc.documentId)
      .first<{ vector_id: string }>();
    vectors.drop(row!.vector_id);
    const outcome = await reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId });
    expect(outcome.mode).toBe("ledger_getbyids");
    expect(outcome.reconciled).toBe(false);
    expect(outcome.missing).toBe(1);
  });

  it("treats a vector with the wrong ACL metadata or namespace as missing", async () => {
    const { vectors, draft, doc } = await draftWithVectors();
    const row = await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ? AND document_id = ?")
      .bind(draft.generationId, doc.documentId)
      .first<{ vector_id: string }>();
    const stored = vectors.store.get(row!.vector_id)!;
    vectors.store.set(row!.vector_id, { ...stored, metadata: { acl_group: "f".repeat(32) } });
    expect((await reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId })).reconciled).toBe(false);
    vectors.store.set(row!.vector_id, { ...stored, namespace: "someone-elses-namespace" });
    expect((await reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId })).reconciled).toBe(false);
  });

  it("is partial when the index moves during the audit", async () => {
    const { vectors, draft } = await draftWithVectors();
    let calls = 0;
    const moving = {
      ...vectors.port,
      describe: async () => {
        calls += 1;
        return calls === 1 ? vectors.port.describe() : { processedUpToMutation: "m-999" };
      },
    };
    const outcome = await reconcileDraft({ db: db(), vectors: moving, generationId: draft.generationId });
    expect(outcome.status).toBe("partial");
    expect(outcome.reconciled).toBe(false);
  });
});

describe("ACL parity probe", () => {
  async function uploaded(scope: "department" | "role" | "public", names: string[]) {
    const draft = await newDraft();
    const ctx = { db: db(), ai: null, vectors: null };
    const doc: DocumentToIndex = {
      ...deptDoc(`upl-acl-${crypto.randomUUID().slice(0, 8)}`, scope === "department" ? names : []),
      accessScope: scope,
      allowedRoles: scope === "role" ? names : [],
    };
    await writeDocumentChunks(ctx, { generationId: draft.generationId, doc, body: "# A\n\nsome restricted words", ensureDocumentRow: true });
    return { draft, doc };
  }

  it("passes when stored ACLs match the selection", async () => {
    for (const [scope, names] of [["department", ["hr", "finance"]], ["role", ["hr_manager"]], ["public", []]] as const) {
      const { draft, doc } = await uploaded(scope, [...names]);
      const result = await aclParityProbe(db(), draft.generationId, [
        { documentId: doc.documentId, accessScope: scope, allowedRoles: doc.allowedRoles, allowedDepartments: doc.allowedDepartments },
      ]);
      expect(result).toMatchObject({ leaks: 0, parityErrors: 0 });
      expect(result.probes).toBeGreaterThan(1);
      await failDraft(db(), draft.generationId, "TEST");
    }
  });

  it("counts a chunk stored more widely than the selection as a leak", async () => {
    const { draft, doc } = await uploaded("department", ["hr"]);
    await env.CORPUS_DB.prepare("UPDATE chunks SET access_scope = 'public' WHERE generation_id = ? AND document_id = ?")
      .bind(draft.generationId, doc.documentId)
      .run();
    const result = await aclParityProbe(db(), draft.generationId, [
      { documentId: doc.documentId, accessScope: "department", allowedRoles: [], allowedDepartments: ["hr"] },
    ]);
    expect(result.leaks).toBeGreaterThan(0);
  });

  it("flags a chunk stored more narrowly than the selection", async () => {
    const { draft, doc } = await uploaded("department", ["hr"]);
    await env.CORPUS_DB.prepare("UPDATE chunks SET allowed_departments = '[\"legal\"]' WHERE generation_id = ? AND document_id = ?")
      .bind(draft.generationId, doc.documentId)
      .run();
    const result = await aclParityProbe(db(), draft.generationId, [
      { documentId: doc.documentId, accessScope: "department", allowedRoles: [], allowedDepartments: ["hr"] },
    ]);
    expect(result.parityErrors).toBeGreaterThan(0);
    // The stored list differs from the selection, which is reported as a leak too.
    expect(result.leaks).toBeGreaterThan(0);
  });
});

describe("check budget and decision", () => {
  it("pauses the eleventh draft in a UTC day and does not count yesterday or paused runs", async () => {
    const now = Date.UTC(2026, 9, 8, 12);
    const yesterday = Date.UTC(2026, 9, 7, 12);
    for (let index = 0; index < DRAFT_CHECKS_PER_DAY; index += 1) {
      const id = `g-budget-${index}`;
      await ensureDraftGeneration(db(), id);
      await env.CORPUS_DB.prepare("INSERT INTO draft_checks (generation_id, status, started_at) VALUES (?, 'passed', ?)")
        .bind(id, index < 2 ? yesterday : now)
        .run();
    }
    await ensureDraftGeneration(db(), "g-budget-new");
    // 8 today, so the new one is the ninth: allowed.
    expect(await reserveCheckRun(db(), "g-budget-new", now)).toBe("started");
    await ensureDraftGeneration(db(), "g-budget-new-2");
    // 9 counted today, the tenth is allowed and the eleventh is not.
    expect(await reserveCheckRun(db(), "g-budget-new-2", now)).toBe("started");
    await ensureDraftGeneration(db(), "g-budget-new-3");
    expect(await reserveCheckRun(db(), "g-budget-new-3", now)).toBe("paused");
    const paused = await env.CORPUS_DB.prepare("SELECT status FROM draft_checks WHERE generation_id = 'g-budget-new-3'").first<{ status: string }>();
    expect(paused?.status).toBe("paused");
    // Replays do not recount.
    expect(await reserveCheckRun(db(), "g-budget-new", now)).toBe("existing");
    await env.CORPUS_DB.prepare("DELETE FROM draft_checks WHERE generation_id LIKE 'g-budget-%'").run();
  });

  it("decides pass only when every gate holds", () => {
    const ok = { reconciled: true, aclLeaks: 0, parityErrors: 0, liveRecall: 0.995, retrievalAvailable: true, documentsAdded: 2 };
    expect(decideChecks(ok)).toEqual({ status: "passed", errorCode: null });
    expect(decideChecks({ ...ok, reconciled: false }).errorCode).toBe("RECONCILIATION_FAILED");
    expect(decideChecks({ ...ok, aclLeaks: 1 }).errorCode).toBe("ACL_LEAK");
    expect(decideChecks({ ...ok, parityErrors: 1 }).errorCode).toBe("ACL_PARITY");
    expect(decideChecks({ ...ok, retrievalAvailable: false }).errorCode).toBe("RETRIEVAL_UNAVAILABLE");
    expect(decideChecks({ ...ok, liveRecall: null }).errorCode).toBe("RETRIEVAL_UNAVAILABLE");
    expect(decideChecks({ ...ok, liveRecall: DRAFT_LIVE_RECALL_FLOOR - 0.01 }).errorCode).toBe("RECALL_BELOW_FLOOR");
    expect(decideChecks({ ...ok, documentsAdded: 0 }).errorCode).toBe("NOTHING_ADDED");
    expect(decideChecks({ ...ok, documentsAdded: null }).status).toBe("passed");
  });
});

describe("retrieval and ACL guard on a draft", () => {
  const fixture: EvalFixture = {
    principals: {
      hr: { user_id: "hr-user", roles: ["standard"], departments: ["hr"] },
      eng: { user_id: "eng-user", roles: ["standard"], departments: ["engineering"] },
    },
    questions: [
      { id: "q1", category: "factual", query: "core hours ten to four", principal: "hr", expected_document_ids: ["base-handbook"] },
      { id: "q2", category: "factual", query: "band four tops out", principal: "hr", expected_document_ids: ["base-salary"] },
      { id: "q3", category: "permission", query: "band four tops out", principal: "eng", expected_document_ids: [], forbidden_document_ids: ["base-salary"] },
    ],
  };

  // Embeds and reranks without a model: every candidate gets a descending score.
  const ai = {
    run: async (_model: string, input: Record<string, unknown>) => {
      if (Array.isArray(input.contexts)) {
        return { response: (input.contexts as unknown[]).map((_, id) => ({ id, score: 0.9 - id * 0.01 })) };
      }
      const count = Array.isArray(input.documents) ? input.documents.length : 1;
      return { data: Array.from({ length: count }, () => Array.from({ length: 1024 }, () => 0.1)) };
    },
  };
  const vectorize = { query: async () => ({ matches: [] }) };

  async function draftWithBase() {
    const active = await seedActive();
    const draft = await newDraft();
    await copyBaseDocuments(db(), { draftGenerationId: draft.generationId, baseGenerationId: active.generationId });
    await copyBaseChunkPage({ db: db(), ai: null, vectors: null }, { draftGenerationId: draft.generationId, baseGenerationId: active.generationId, afterId: 0 });
    return draft;
  }

  it("runs the questions against the draft and reports recall and zero leaks", async () => {
    const draft = await draftWithBase();
    const batch = await runRetrievalBatch({ db: db(), ai, vectorize, generationId: draft.generationId, fixture, from: 0, to: 3 });
    expect(batch).toMatchObject({ run: 3, leaks: 0, rankedCount: 2, recallSum: 2 });
    expect(aggregateRecall([batch])).toEqual({ questionsRun: 3, leaks: 0, liveRecall: 1 });
  });

  it("counts a question that retrieves a forbidden document as a leak", async () => {
    const draft = await draftWithBase();
    // The draft's copy of the HR-only document was widened to public.
    await env.CORPUS_DB.prepare("UPDATE chunks SET access_scope = 'public' WHERE generation_id = ? AND document_id = 'base-salary'")
      .bind(draft.generationId)
      .run();
    const batch = await runRetrievalBatch({ db: db(), ai, vectorize, generationId: draft.generationId, fixture, from: 2, to: 3 });
    expect(batch.leaks).toBe(1);
  });

  it("reports lower recall when the draft lost a document", async () => {
    const draft = await draftWithBase();
    await env.CORPUS_DB.prepare("DELETE FROM chunks WHERE generation_id = ? AND document_id = 'base-handbook'").bind(draft.generationId).run();
    const batch = await runRetrievalBatch({ db: db(), ai, vectorize, generationId: draft.generationId, fixture, from: 0, to: 2 });
    expect(aggregateRecall([batch]).liveRecall).toBe(0.5);
  });

  it("runs the guard on the keyword channel alone when no index is bound, and still catches a leak", async () => {
    const draft = await draftWithBase();
    const clean = await runRetrievalBatch({ db: db(), ai, vectorize: null, generationId: draft.generationId, fixture, from: 0, to: 3 });
    expect(clean.run).toBe(3);
    expect(clean.leaks).toBe(0);
    await env.CORPUS_DB.prepare("UPDATE chunks SET access_scope = 'public' WHERE generation_id = ? AND document_id = 'base-salary'")
      .bind(draft.generationId)
      .run();
    const leaky = await runRetrievalBatch({ db: db(), ai, vectorize: null, generationId: draft.generationId, fixture, from: 2, to: 3 });
    expect(leaky.leaks).toBe(1);
  });

  it("fails loudly on a question naming an unknown principal", async () => {
    const draft = await draftWithBase();
    const bad: EvalFixture = { ...fixture, questions: [{ id: "qx", category: "factual", query: "x y", principal: "nobody" }] };
    await expect(
      runRetrievalBatch({ db: db(), ai, vectorize, generationId: draft.generationId, fixture: bad, from: 0, to: 1 }),
    ).rejects.toThrow(/unknown principal/);
  });
});
