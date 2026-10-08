import { env } from "cloudflare:workers";
import { reconcileWithFinalRecord } from "../src/workflow";
import { beforeEach, describe, expect, it } from "vitest";

import {
  aclParityProbe,
  DRAFT_CHECKS_PER_DAY,
  DRAFT_LIVE_RECALL_FLOOR,
  decideChecks,
  finishCheckRun,
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
  DISCARD_GRACE_MS,
  embedChunkRange,
  finalizeDocument,
  purgeDiscardedDraft,
  writeDocumentChunks,
  type DocumentToIndex,
} from "../../../src/lib/ingest/draft-index";
import { generationNamespace, vectorIdForChunk } from "../../../src/lib/ingest/digests";
import { inventoryFromSettings, VectorInventoryError, type VectorInventory } from "../../../src/lib/ingest/vector-inventory";
import { ensureDraftGeneration } from "../../../src/lib/store/corpus-d1";
import { claimDiscard, closeDraft, ensureOpenDraft, failDraft, getOpenDraft, markBaseCopied } from "../../../src/lib/store/drafts";
import { claimFinalize, startIndexing } from "../../../src/lib/store/draft-state";
import { createUploadBatch, expireUndeliveredFiles, failUploadFile, recordUploadedObject } from "../../../src/lib/store/uploads";
import { readersToAcl } from "../../../src/lib/ingest/upload-validation";
import { ACTIVE_DOCUMENTS, db, fakeAi, fakeVectors, resetPipeline, seedActive, vectorFor } from "./helpers";

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

describe("base copy embedding compatibility", () => {
  async function incompatibleBase() {
    const vectors = fakeVectors();
    const ai = fakeAi();
    const active = await seedActive({ ai, vectors });
    // The base was embedded by another model that also happens to be 1024 wide.
    await env.CORPUS_DB.prepare("UPDATE corpus_generations SET embedding_model = ? WHERE id = ?")
      .bind("@cf/other/embedding-1024", active.generationId)
      .run();
    const draft = await newDraft();
    await copyBaseDocuments(db(), { draftGenerationId: draft.generationId, baseGenerationId: active.generationId });
    return { vectors, ai, active, draft };
  }

  it("re-embeds base chunks instead of copying vectors from another embedding model", async () => {
    const { vectors, ai, active, draft } = await incompatibleBase();
    const before = ai.embedded.length;
    const baseValues = new Map([...vectors.store].map(([id, record]) => [id, record.values]));
    let after = 0;
    for (;;) {
      const page = await copyBaseChunkPage(
        { db: db(), ai, vectors: vectors.port },
        { draftGenerationId: draft.generationId, baseGenerationId: active.generationId, afterId: after },
      );
      if (page.nextAfterId === null) break;
      after = page.nextAfterId;
    }
    expect(ai.embedded.length - before).toBe(active.chunkCount);
    const copied = await env.CORPUS_DB.prepare("SELECT vector_id, content FROM chunks WHERE generation_id = ?")
      .bind(draft.generationId)
      .all<{ vector_id: string; content: string }>();
    expect(copied.results).toHaveLength(active.chunkCount);
    for (const row of copied.results) {
      const stored = vectors.store.get(row.vector_id);
      expect(stored).toBeDefined();
      expect(Array.from(stored!.values)).toEqual(vectorFor(row.content));
    }
    expect(baseValues.size).toBe(active.chunkCount);
  });

  it("fails explicitly when the base is incompatible and nothing can re-embed", async () => {
    const { vectors, active, draft } = await incompatibleBase();
    await expect(
      copyBaseChunkPage(
        { db: db(), ai: null, vectors: vectors.port },
        { draftGenerationId: draft.generationId, baseGenerationId: active.generationId, afterId: 0 },
      ),
    ).rejects.toThrow(/INDEX_UNAVAILABLE/);
    expect([...vectors.store.keys()].filter((id) => id.length > 0).length).toBe(active.chunkCount);
  });

  it("still reuses a compatible base's vectors without calling the model", async () => {
    const vectors = fakeVectors();
    const ai = fakeAi();
    const active = await seedActive({ ai, vectors });
    const draft = await newDraft();
    await copyBaseDocuments(db(), { draftGenerationId: draft.generationId, baseGenerationId: active.generationId });
    const before = ai.embedded.length;
    await copyBaseChunkPage(
      { db: db(), ai, vectors: vectors.port },
      { draftGenerationId: draft.generationId, baseGenerationId: active.generationId, afterId: 0 },
    );
    expect(ai.embedded.length).toBe(before);
  });
});

describe("finalization claim", () => {
  async function readyToFinalize() {
    await seedActive();
    const draft = await newDraft();
    await startIndexing(db(), draft.generationId);
    await markBaseCopied(db(), draft.generationId);
    return draft;
  }

  it("lets the owner resume a claim it already committed and refuses any other instance", async () => {
    const draft = await readyToFinalize();
    expect(await claimFinalize(db(), draft.generationId, "instance-a")).toBe(true);
    // The step result was lost and the step ran again.
    expect(await claimFinalize(db(), draft.generationId, "instance-a")).toBe(true);
    expect(await claimFinalize(db(), draft.generationId, "instance-b")).toBe(false);
    const state = await env.CORPUS_DB.prepare("SELECT state FROM corpus_generations WHERE id = ?")
      .bind(draft.generationId)
      .first<{ state: string }>();
    expect(state?.state).toBe("reconciling");
  });

  it("is refused while a file is still open, and again after the draft closed", async () => {
    const draft = await readyToFinalize();
    const batch = await createUploadBatch(db(), {
      generationId: draft.generationId,
      createdBy: "admin-test",
      acl: readersToAcl({ kind: "everyone" }),
      idempotencyKey: `claim-${crypto.randomUUID()}`,
      files: [{ name: "open.md", size: 4 }],
    });
    expect(await claimFinalize(db(), draft.generationId, "instance-a")).toBe(false);
    await failUploadFile(db(), batch.files[0].id, "INTERNAL");
    expect(await claimFinalize(db(), draft.generationId, "instance-a")).toBe(true);
    await failDraft(db(), draft.generationId, "TEST");
    expect(await claimFinalize(db(), draft.generationId, "instance-a")).toBe(false);
  });
});

describe("undelivered files", () => {
  it("expires only files whose bytes never arrived, and refuses a late object record", async () => {
    await seedActive();
    const draft = await newDraft();
    const batch = await createUploadBatch(db(), {
      generationId: draft.generationId,
      createdBy: "admin-test",
      acl: readersToAcl({ kind: "everyone" }),
      idempotencyKey: `expire-${crypto.randomUUID()}`,
      files: [
        { name: "arrived.md", size: 4 },
        { name: "never.md", size: 4 },
      ],
    });
    expect(await recordUploadedObject(db(), batch.files[0].id, "uploads/x/arrived")).toBe(true);
    expect(await expireUndeliveredFiles(db(), batch.batchId)).toBe(1);
    const rows = await env.CORPUS_DB.prepare("SELECT id, stage, error_code FROM upload_files WHERE batch_id = ? ORDER BY rowid")
      .bind(batch.batchId)
      .all<{ id: string; stage: string; error_code: string | null }>();
    expect(rows.results).toEqual([
      { id: batch.files[0].id, stage: "parsing", error_code: null },
      { id: batch.files[1].id, stage: "failed", error_code: "NOT_RECEIVED" },
    ]);
    // A PUT that was still streaming when the file expired cannot attach its object.
    expect(await recordUploadedObject(db(), batch.files[1].id, "uploads/x/never")).toBe(false);
    expect(await expireUndeliveredFiles(db(), batch.batchId)).toBe(0);
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

describe("discard fences writers that were already in flight", () => {
  async function projectionCounts(generationId: string) {
    const out: Record<string, number> = {};
    for (const table of ["chunks", "document_catalog", "document_bodies", "document_versions"]) {
      const row = await env.CORPUS_DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE generation_id = ?`)
        .bind(generationId)
        .first<{ n: number }>();
      out[table] = row?.n ?? 0;
    }
    return out;
  }
  const empty = { chunks: 0, document_catalog: 0, document_bodies: 0, document_versions: 0 };

  it("refuses every projection write a step makes after the discard, so nothing is recreated", async () => {
    const vectors = fakeVectors();
    const ai = fakeAi();
    const active = await seedActive({ ai, vectors });
    const draft = await newDraft();
    const ctx = { db: db(), ai, vectors: vectors.port };
    const doc = deptDoc("upl-late", ["hr"]);
    await writeDocumentChunks(ctx, { generationId: draft.generationId, doc, body: "# Late\n\nEarly words.", ensureDocumentRow: true });
    // The step passed its open check, then the admin discarded the draft.
    expect(await claimDiscard(db(), draft.generationId)).toBe(true);
    await purgeDiscardedDraft(ctx, draft.generationId, { deleteVectorsNow: true });
    expect(await projectionCounts(draft.generationId)).toEqual(empty);
    // The step resumes. Every write it attempts is refused by the database.
    await expect(
      writeDocumentChunks(ctx, { generationId: draft.generationId, doc, body: "# Late\n\nLate words.", ensureDocumentRow: true }),
    ).rejects.toThrow(/DRAFT_CLOSED/);
    await expect(
      finalizeDocument(ctx, { generationId: draft.generationId, doc, body: "# Late\n\nLate words.", department: null }),
    ).rejects.toThrow(/DRAFT_CLOSED/);
    await expect(
      copyBaseDocuments(db(), { draftGenerationId: draft.generationId, baseGenerationId: active.generationId }),
    ).rejects.toThrow(/DRAFT_CLOSED/);
    const upsertsBefore = vectors.store.size;
    await expect(
      copyBaseChunkPage(ctx, { draftGenerationId: draft.generationId, baseGenerationId: active.generationId, afterId: 0 }),
    ).rejects.toThrow(/DRAFT_CLOSED/);
    expect(vectors.store.size).toBe(upsertsBefore);
    expect(await projectionCounts(draft.generationId)).toEqual(empty);
  });

  it("purges more than 100 tombstones without exceeding the D1 parameter limit", async () => {
    const vectors = fakeVectors();
    const draft = await newDraft();
    expect(await claimDiscard(db(), draft.generationId)).toBe(true);
    const ids = Array.from({ length: 150 }, (_, i) => `vec-${String(i).padStart(3, "0")}`);
    await env.CORPUS_DB.batch(
      ids.map((id) =>
        env.CORPUS_DB.prepare("INSERT INTO discarded_vectors (generation_id, vector_id) VALUES (?, ?)").bind(draft.generationId, id),
      ),
    );
    // D1 rejects statements binding more than 100 parameters; enforce that here.
    const raw = db();
    const limited = new Proxy(raw, {
      get(target, key, receiver) {
        if (key !== "prepare") {
          const value = Reflect.get(target, key, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (sql: string) => {
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(st, k, r) {
              if (k === "bind") {
                return (...values: unknown[]) => {
                  if (values.length > 100) throw new Error(`too many SQL variables: ${values.length}`);
                  return st.bind(...values);
                };
              }
              const v = Reflect.get(st, k, r);
              return typeof v === "function" ? v.bind(st) : v;
            },
          });
        };
      },
    });
    const closedAt = (await env.CORPUS_DB.prepare("SELECT closed_at FROM drafts WHERE generation_id = ?")
      .bind(draft.generationId)
      .first<{ closed_at: number }>())!.closed_at;
    const result = await purgeDiscardedDraft(
      { db: limited, ai: fakeAi(), vectors: vectors.port },
      draft.generationId,
      { now: closedAt + DISCARD_GRACE_MS + 1 },
    );
    expect(result).toEqual({ purged: true });
    const left = await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM discarded_vectors WHERE generation_id = ?")
      .bind(draft.generationId)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("deletes a vector upsert that lands after the discard once in-flight writers can no longer run", async () => {
    const vectors = fakeVectors();
    const ai = fakeAi();
    const draft = await newDraft();
    const doc = deptDoc("upl-straggler", ["hr"]);
    const plain = { db: db(), ai, vectors: vectors.port };
    const written = await writeDocumentChunks(plain, {
      generationId: draft.generationId,
      doc,
      body: "# Straggler\n\nWords embedded while the draft is discarded.",
      ensureDocumentRow: true,
    });
    const namespace = await generationNamespace(draft.generationId);
    const inDraft = () => [...vectors.store.values()].filter((vector) => vector.namespace === namespace).length;
    // The embedding step read its chunk rows before the discard; its upsert reaches the index after it.
    let discarded = false;
    const racing = {
      ...vectors.port,
      async upsert(records: Parameters<typeof vectors.port.upsert>[0]) {
        if (!discarded) {
          discarded = true;
          expect(await claimDiscard(db(), draft.generationId)).toBe(true);
          await purgeDiscardedDraft(plain, draft.generationId, { deleteVectorsNow: true });
        }
        return vectors.port.upsert(records);
      },
    };
    await embedChunkRange(
      { db: db(), ai, vectors: racing },
      { generationId: draft.generationId, documentId: doc.documentId, from: 0, to: written.chunkCount, reuseFromGenerationId: null },
    );
    expect(discarded).toBe(true);
    expect(inDraft()).toBe(written.chunkCount);
    const closedAt = (await env.CORPUS_DB.prepare("SELECT closed_at FROM drafts WHERE generation_id = ?")
      .bind(draft.generationId)
      .first<{ closed_at: number }>())!.closed_at;
    const purgedAt = async () =>
      (await env.CORPUS_DB.prepare("SELECT purged_at FROM drafts WHERE generation_id = ?")
        .bind(draft.generationId)
        .first<{ purged_at: number | null }>())?.purged_at ?? null;
    // Still inside the grace window: nothing is forgotten yet.
    expect(await purgeDiscardedDraft(plain, draft.generationId, { now: closedAt + 60_000 })).toEqual({ purged: false });
    expect(await purgedAt()).toBeNull();
    // Afterwards the straggler is deleted and the draft converges to empty.
    expect(await purgeDiscardedDraft(plain, draft.generationId, { now: closedAt + DISCARD_GRACE_MS + 1 })).toEqual({ purged: true });
    expect(inDraft()).toBe(0);
    expect(await purgedAt()).not.toBeNull();
    expect(await projectionCounts(draft.generationId)).toEqual(empty);
    const tombstones = await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM discarded_vectors WHERE generation_id = ?")
      .bind(draft.generationId)
      .first<{ n: number }>();
    expect(tombstones?.n).toBe(0);
  });

  it("never touches a generation that was not discarded", async () => {
    const vectors = fakeVectors();
    const ai = fakeAi();
    const active = await seedActive({ ai, vectors });
    const draft = await newDraft();
    const ctx = { db: db(), ai, vectors: vectors.port };
    await writeDocumentChunks(ctx, { generationId: draft.generationId, doc: deptDoc("upl-keep", ["hr"]), body: "# Keep\n\nwords", ensureDocumentRow: true });
    const before = { draft: await projectionCounts(draft.generationId), active: await projectionCounts(active.generationId) };
    const far = Date.now() + DISCARD_GRACE_MS * 10;
    expect(await purgeDiscardedDraft(ctx, draft.generationId, { now: far, deleteVectorsNow: true })).toEqual({ purged: false });
    expect(await purgeDiscardedDraft(ctx, active.generationId, { now: far, deleteVectorsNow: true })).toEqual({ purged: false });
    // A draft that failed for another reason is not a discard either.
    await failDraft(db(), draft.generationId, "INDEX_UNAVAILABLE");
    expect(await purgeDiscardedDraft(ctx, draft.generationId, { now: far, deleteVectorsNow: true })).toEqual({ purged: false });
    expect({ draft: await projectionCounts(draft.generationId), active: await projectionCounts(active.generationId) }).toEqual(before);
    expect(vectors.deleted).toEqual([]);
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

  it("a lagging watermark does not block: the per-id check decides, and the watermarks are reported", async () => {
    const { vectors, draft } = await draftWithVectors({ lag: true });
    const outcome = await reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId });
    expect(outcome).toMatchObject({ mode: "ledger_getbyids", reconciled: true, status: "complete", missing: 0 });
    expect(outcome.expected).toBe(1);
    expect(outcome.startWatermark).toBeNull();
  });

  it("lag as missing ids is still retried: pending throws until they appear", async () => {
    const { vectors, draft, doc } = await draftWithVectors({ lag: true });
    const row = await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ? AND document_id = ?")
      .bind(draft.generationId, doc.documentId)
      .first<{ vector_id: string }>();
    const stored = vectors.store.get(row!.vector_id)!;
    vectors.drop(row!.vector_id);
    const run = () => reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId, missingIsPending: true });
    await expect(run()).rejects.toBeInstanceOf(MutationPendingError);
    vectors.store.set(row!.vector_id, stored);
    expect(await run()).toMatchObject({ reconciled: true, status: "complete" });
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

  it("missingIsPending throws instead of recording while vectors are missing, then reconciles once they appear", async () => {
    const { vectors, draft, doc } = await draftWithVectors();
    const row = await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ? AND document_id = ?")
      .bind(draft.generationId, doc.documentId)
      .first<{ vector_id: string }>();
    const stored = vectors.store.get(row!.vector_id)!;
    vectors.drop(row!.vector_id);
    const run = () => reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId, missingIsPending: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(run()).rejects.toBeInstanceOf(MutationPendingError);
    }
    const audits = () => env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM reconciliation_audits WHERE id = ?").bind(draft.generationId).first<{ n: number }>();
    expect((await audits())!.n).toBe(0);
    vectors.store.set(row!.vector_id, stored);
    expect(await run()).toMatchObject({ reconciled: true, status: "complete", missing: 0 });
  });

  it("a watermark that moves during the scan (other generations mutating the shared index) does not fail a healthy draft", async () => {
    const { vectors, draft } = await draftWithVectors();
    let calls = 0;
    const moving = {
      ...vectors.port,
      describe: async () => (++calls === 1 ? vectors.port.describe() : { processedUpToMutation: "m-999" }),
    };
    const outcome = await reconcileDraft({ db: db(), vectors: moving, generationId: draft.generationId, missingIsPending: true });
    expect(outcome).toMatchObject({ reconciled: true, status: "complete", missing: 0 });
    expect(outcome.startWatermark).not.toBe(outcome.endWatermark);
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

  it("fails when the index returns a vector without its namespace or ACL metadata", async () => {
    const { vectors, draft, doc } = await draftWithVectors();
    const row = await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ? AND document_id = ?")
      .bind(draft.generationId, doc.documentId)
      .first<{ vector_id: string }>();
    const stored = vectors.store.get(row!.vector_id)!;
    // Namespace absent: isolation between generations cannot be verified.
    vectors.store.set(row!.vector_id, { ...stored, namespace: undefined } as never);
    const noNamespace = await reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId });
    expect(noNamespace.reconciled).toBe(false);
    expect(noNamespace.missing).toBe(1);
    // ACL metadata absent: the filter field is unverifiable.
    vectors.store.set(row!.vector_id, { ...stored, metadata: undefined } as never);
    expect((await reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId })).reconciled).toBe(false);
    vectors.store.set(row!.vector_id, { ...stored, metadata: {} });
    expect((await reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId })).reconciled).toBe(false);
    vectors.store.set(row!.vector_id, stored);
    expect((await reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId })).reconciled).toBe(true);
  });

  it("later mutations from another generation never make the gate unreachable", async () => {
    const { vectors, draft } = await draftWithVectors();
    // Another draft, or a purge, mutates the shared index after ours.
    await vectors.port.upsert([]);
    await vectors.port.deleteByIds(["someone-elses-vector"]);
    const outcome = await reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId });
    expect(outcome).toMatchObject({ reconciled: true, status: "complete", missing: 0 });
  });

  it("a watermark that is never reported still reconciles when every vector verifies", async () => {
    const { vectors, draft } = await draftWithVectors();
    const silent = { ...vectors.port, describe: async () => ({ processedUpToMutation: undefined }) };
    const outcome = await reconcileDraft({ db: db(), vectors: silent as never, generationId: draft.generationId });
    expect(outcome).toMatchObject({ reconciled: true, status: "complete" });
  });

  it("a watermark read that throws after a verified scan keeps the verified inventory", async () => {
    const { vectors, draft } = await draftWithVectors();
    let calls = 0;
    const flaky = {
      ...vectors.port,
      describe: async () => {
        calls += 1;
        if (calls === 2) throw new Error("describe down");
        return vectors.port.describe();
      },
    };
    for (const missingIsPending of [true, false]) {
      calls = 0;
      const outcome = await reconcileDraft({ db: db(), vectors: flaky as never, generationId: draft.generationId, missingIsPending });
      expect(outcome).toMatchObject({ reconciled: true, status: "complete", missing: 0 });
    }
  });

  it("final attempt with an unreadable index records a partial audit with the real count and never throws", async () => {
    const { vectors, draft } = await draftWithVectors();
    const broken = { ...vectors.port, getByIds: async () => { throw new Error("index down"); } };
    const outcome = await reconcileDraft({ db: db(), vectors: broken as never, generationId: draft.generationId });
    expect(outcome).toMatchObject({ mode: "ledger_getbyids", reconciled: false, status: "partial", expected: 1 });
    expect(outcome.reason).toMatch(/index scan failed/);
    const audit = await env.CORPUS_DB.prepare("SELECT status, missing_count FROM reconciliation_audits WHERE id = ?")
      .bind(draft.generationId)
      .first<Record<string, unknown>>();
    expect(audit).toEqual({ status: "partial", missing_count: 1 });
  });

  it("a scan failure while pending rethrows so the step retries and records nothing", async () => {
    const { vectors, draft } = await draftWithVectors();
    const broken = { ...vectors.port, getByIds: async () => { throw new Error("boom"); } };
    await expect(
      reconcileDraft({ db: db(), vectors: broken as never, generationId: draft.generationId, missingIsPending: true }),
    ).rejects.toThrow("boom");
    const n = await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM reconciliation_audits WHERE id = ?").bind(draft.generationId).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  describe("with a full Vectorize inventory (D20)", () => {
    function listing(store: Map<string, unknown>): VectorInventory {
      return { listAll: async () => ({ ids: [...store.keys()], totalCount: store.size }) };
    }

    function addOrphan(vectors: ReturnType<typeof fakeVectors>, id: string, namespace: string) {
      vectors.store.set(id, { id, values: [], namespace, metadata: { acl_group: "a".repeat(32) } });
    }

    const auditRow = (generationId: string) =>
      env.CORPUS_DB.prepare("SELECT status, missing_count, orphan_count FROM reconciliation_audits WHERE id = ?")
        .bind(generationId)
        .first<Record<string, unknown>>();

    it("with no inventory configured the outcome is binding-only and says so", async () => {
      const { vectors, draft } = await draftWithVectors();
      addOrphan(vectors, "unlisted-orphan", await generationNamespace(draft.generationId));
      const outcome = await reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId });
      expect(outcome).toMatchObject({
        mode: "ledger_getbyids",
        reconciled: true,
        status: "complete",
        missing: 0,
        inventoryChecked: false,
        orphanVectors: null,
        orphanVectorsInDraft: null,
      });
      expect(await auditRow(draft.generationId)).toEqual({ status: "complete", missing_count: 0, orphan_count: 0 });
    });

    it("a keyword-only draft ignores an inventory: there is no index to list", async () => {
      const draft = await newDraft();
      let listed = 0;
      const inventory: VectorInventory = { listAll: async () => { listed += 1; return { ids: [], totalCount: 0 }; } };
      const outcome = await reconcileDraft({ db: db(), vectors: null, inventory, generationId: draft.generationId });
      expect(outcome).toMatchObject({ mode: "keyword_only", reconciled: true, inventoryChecked: false });
      expect(listed).toBe(0);
    });

    it("an index that holds exactly the ledger reconciles with zero orphans", async () => {
      const { vectors, draft } = await draftWithVectors();
      const outcome = await reconcileDraft({ db: db(), vectors: vectors.port, inventory: listing(vectors.store), generationId: draft.generationId });
      expect(outcome).toMatchObject({
        mode: "ledger_getbyids",
        reconciled: true,
        status: "complete",
        missing: 0,
        inventoryChecked: true,
        orphanVectors: 0,
        orphanVectorsInDraft: 0,
      });
      expect(await auditRow(draft.generationId)).toEqual({ status: "complete", missing_count: 0, orphan_count: 0 });
    });

    it("an orphan in the draft namespace fails the draft; the reason counts it and never names an id", async () => {
      const { vectors, draft } = await draftWithVectors();
      addOrphan(vectors, "stray-draft-vector-1", await generationNamespace(draft.generationId));
      addOrphan(vectors, "stray-draft-vector-2", await generationNamespace(draft.generationId));
      const outcome = await reconcileDraft({ db: db(), vectors: vectors.port, inventory: listing(vectors.store), generationId: draft.generationId });
      expect(outcome).toMatchObject({ reconciled: false, status: "complete", missing: 0, inventoryChecked: true, orphanVectors: 2, orphanVectorsInDraft: 2 });
      expect(outcome.reason).toMatch(/2 /);
      expect(outcome.reason).not.toMatch(/stray-draft/);
      expect(await auditRow(draft.generationId)).toEqual({ status: "complete", missing_count: 0, orphan_count: 2 });
    });

    it("an orphan in another namespace is counted but does not block", async () => {
      const { vectors, draft } = await draftWithVectors();
      addOrphan(vectors, "stray-elsewhere", "some-other-namespace");
      const outcome = await reconcileDraft({ db: db(), vectors: vectors.port, inventory: listing(vectors.store), generationId: draft.generationId });
      expect(outcome).toMatchObject({ reconciled: true, status: "complete", inventoryChecked: true, orphanVectors: 1, orphanVectorsInDraft: 0 });
      expect(await auditRow(draft.generationId)).toEqual({ status: "complete", missing_count: 0, orphan_count: 0 });
    });

    it("a listed id the binding no longer returns is retried while pending, and on the final attempt is no orphan but is counted in the reason", async () => {
      const { vectors, draft } = await draftWithVectors();
      const gone: VectorInventory = {
        listAll: async () => ({ ids: [...vectors.store.keys(), "deleted-after-listing"], totalCount: vectors.store.size + 1 }),
      };
      await expect(
        reconcileDraft({ db: db(), vectors: vectors.port, inventory: gone, generationId: draft.generationId, missingIsPending: true }),
      ).rejects.toBeInstanceOf(MutationPendingError);
      expect(await auditRow(draft.generationId)).toBeNull();
      const outcome = await reconcileDraft({ db: db(), vectors: vectors.port, inventory: gone, generationId: draft.generationId });
      expect(outcome).toMatchObject({ reconciled: true, orphanVectors: 0, orphanVectorsInDraft: 0 });
      expect(outcome.reason).toBe("1 listed vectors could not be resolved");
      expect(outcome.reason).not.toMatch(/deleted-after-listing/);
    });

    it("an in-draft orphan from a delete the index has not processed yet is retried while pending, then clears", async () => {
      const { vectors, draft } = await draftWithVectors();
      const namespace = await generationNamespace(draft.generationId);
      addOrphan(vectors, "removed-document-chunk", namespace);
      // Asynchronous delete: accepted now, applied later (removeDocumentFromDraft behaves this way).
      const pendingDeletes: string[] = [];
      const lagging = {
        ...vectors.port,
        deleteByIds: async (ids: string[]) => {
          pendingDeletes.push(...ids);
        },
      };
      await lagging.deleteByIds(["removed-document-chunk"]);
      const run = (missingIsPending: boolean) =>
        reconcileDraft({ db: db(), vectors: lagging, inventory: listing(vectors.store), generationId: draft.generationId, missingIsPending });
      await expect(run(true)).rejects.toBeInstanceOf(MutationPendingError);
      expect(await auditRow(draft.generationId)).toBeNull();
      // The final attempt still fails closed while the vector is there.
      expect(await run(false)).toMatchObject({ reconciled: false, orphanVectorsInDraft: 1 });
      for (const id of pendingDeletes) vectors.store.delete(id);
      expect(await run(true)).toMatchObject({ reconciled: true, orphanVectors: 0, orphanVectorsInDraft: 0 });
    });

    it("more unknown ids than the cap is retried while pending, and fails closed on the final attempt without resolving any", async () => {
      const { vectors, draft } = await draftWithVectors();
      for (let index = 0; index < 5; index += 1) addOrphan(vectors, `junk-${index}`, "some-other-namespace");
      const calls: string[][] = [];
      const counting = { ...vectors.port, getByIds: async (ids: string[]) => { calls.push(ids); return vectors.port.getByIds(ids); } };
      const run = (missingIsPending: boolean) =>
        reconcileDraft({ db: db(), vectors: counting, inventory: listing(vectors.store), generationId: draft.generationId, orphanResolveCap: 4, missingIsPending });
      // Pending: purge deletes may still be landing, so nothing is decided or recorded.
      await expect(run(true)).rejects.toBeInstanceOf(MutationPendingError);
      expect(await auditRow(draft.generationId)).toBeNull();
      const final = await run(false);
      expect(final).toMatchObject({ reconciled: false, status: "partial", inventoryChecked: true, orphanVectors: 5, orphanVectorsInDraft: null });
      expect(final.reason).toBe("5 unknown vectors exceed the check limit of 4");
      expect(calls).toHaveLength(2); // the ledger fetch of each run only; no unknown id was resolved
      expect(await auditRow(draft.generationId)).toMatchObject({ status: "partial" });
      // Once the surplus clears (deletes processed) the pending run reconciles; at the cap exactly it resolves.
      vectors.store.delete("junk-0");
      expect(await run(true)).toMatchObject({ reconciled: true, orphanVectors: 4 });
    });

    it("the deployed settings shape (index name var only, no secrets) reconciles binding-only", async () => {
      const { vectors, draft } = await draftWithVectors();
      addOrphan(vectors, "ignored-without-a-listing", await generationNamespace(draft.generationId));
      const settings = inventoryFromSettings({ VECTORIZE_INDEX_NAME: "useful-brain-staging" });
      for (const missingIsPending of [true, false]) {
        const outcome = await reconcileDraft({
          db: db(),
          vectors: vectors.port,
          inventory: settings.inventory,
          inventoryPartlyConfigured: settings.partlyConfigured,
          generationId: draft.generationId,
          missingIsPending,
        });
        expect(outcome).toMatchObject({ mode: "ledger_getbyids", reconciled: true, status: "complete", inventoryChecked: false, orphanVectors: null });
      }
    });

    it("resolves more than 20 unknown ids in batches of 20", async () => {
      const { vectors, draft } = await draftWithVectors();
      for (let index = 0; index < 45; index += 1) addOrphan(vectors, `junk-${index}`, "some-other-namespace");
      const batches: number[] = [];
      const counting = {
        ...vectors.port,
        getByIds: async (ids: string[]) => {
          batches.push(ids.length);
          return vectors.port.getByIds(ids);
        },
      };
      const outcome = await reconcileDraft({ db: db(), vectors: counting, inventory: listing(vectors.store), generationId: draft.generationId });
      expect(outcome).toMatchObject({ reconciled: true, orphanVectors: 45, orphanVectorsInDraft: 0 });
      expect(batches).toEqual([1, 20, 20, 5]);
    });

    it("partly configured inventory fails closed at once without listing or fetching, even while pending", async () => {
      const { vectors, draft } = await draftWithVectors();
      let touched = 0;
      const spy = { ...vectors.port, getByIds: async (ids: string[]) => { touched += 1; return vectors.port.getByIds(ids); } };
      for (const missingIsPending of [true, false]) {
        const outcome = await reconcileDraft({
          db: db(),
          vectors: spy,
          inventory: null,
          inventoryPartlyConfigured: true,
          generationId: draft.generationId,
          missingIsPending,
        });
        expect(outcome).toMatchObject({ mode: "ledger_getbyids", reconciled: false, status: "partial", reason: "inventory partly configured", inventoryChecked: false });
      }
      expect(touched).toBe(0);
      expect(await auditRow(draft.generationId)).toMatchObject({ status: "partial" });
    });

    it("fails when the listing lacks a ledger id the binding can still fetch", async () => {
      const { vectors, draft, doc } = await draftWithVectors();
      const row = await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ? AND document_id = ?")
        .bind(draft.generationId, doc.documentId)
        .first<{ vector_id: string }>();
      const lagging: VectorInventory = {
        listAll: async () => ({ ids: [...vectors.store.keys()].filter((id) => id !== row!.vector_id), totalCount: 0 }),
      };
      const outcome = await reconcileDraft({ db: db(), vectors: vectors.port, inventory: lagging, generationId: draft.generationId });
      expect(outcome).toMatchObject({ reconciled: false, missing: 1 });
      expect(await auditRow(draft.generationId)).toEqual({ status: "complete", missing_count: 1, orphan_count: 0 });
    });

    it("a ledger id missing from the listing is retried while pending, so index lag is absorbed", async () => {
      const { vectors, draft, doc } = await draftWithVectors();
      const row = await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ? AND document_id = ?")
        .bind(draft.generationId, doc.documentId)
        .first<{ vector_id: string }>();
      let visible = false;
      const eventually: VectorInventory = {
        listAll: async () => {
          const ids = [...vectors.store.keys()].filter((id) => visible || id !== row!.vector_id);
          return { ids, totalCount: ids.length };
        },
      };
      const run = () => reconcileDraft({ db: db(), vectors: vectors.port, inventory: eventually, generationId: draft.generationId, missingIsPending: true });
      await expect(run()).rejects.toBeInstanceOf(MutationPendingError);
      expect((await auditRow(draft.generationId)) ?? null).toBeNull();
      visible = true;
      expect(await run()).toMatchObject({ reconciled: true, inventoryChecked: true });
    });

    it("does not list the index while ledger vectors are still missing from getByIds", async () => {
      const { vectors, draft, doc } = await draftWithVectors();
      const row = await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ? AND document_id = ?")
        .bind(draft.generationId, doc.documentId)
        .first<{ vector_id: string }>();
      vectors.drop(row!.vector_id);
      let listed = 0;
      const inventory: VectorInventory = { listAll: async () => { listed += 1; return { ids: [], totalCount: 0 }; } };
      await expect(
        reconcileDraft({ db: db(), vectors: vectors.port, inventory, generationId: draft.generationId, missingIsPending: true }),
      ).rejects.toBeInstanceOf(MutationPendingError);
      const final = await reconcileDraft({ db: db(), vectors: vectors.port, inventory, generationId: draft.generationId });
      expect(final).toMatchObject({ reconciled: false, missing: 1, inventoryChecked: false });
      expect(listed).toBe(0);
    });

    it("vectors held by discarded drafts and by other generations are known, read in keyset pages", async () => {
      const { vectors, draft } = await draftWithVectors();
      const namespace = await generationNamespace(draft.generationId);
      // Another generation with its own chunks, seeded here so the test owns its data.
      const active = await seedActive();
      const others = (
        await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ?").bind(active.generationId).all<{ vector_id: string }>()
      ).results;
      expect(others.length).toBeGreaterThan(2);
      for (const row of others) addOrphan(vectors, row.vector_id, "some-other-namespace");
      for (let index = 0; index < 5; index += 1) {
        const id = `tombstoned-${index}`;
        addOrphan(vectors, id, namespace);
        await env.CORPUS_DB.prepare("INSERT INTO discarded_vectors (generation_id, vector_id) VALUES (?, ?)")
          .bind("some-discarded-generation", id)
          .run();
      }
      const batches: number[] = [];
      const counting = { ...vectors.port, getByIds: async (ids: string[]) => { batches.push(ids.length); return vectors.port.getByIds(ids); } };
      // Page size 2 forces several keyset pages over both tables.
      const outcome = await reconcileDraft({ db: db(), vectors: counting, inventory: listing(vectors.store), generationId: draft.generationId, knownPageSize: 2 });
      expect(outcome).toMatchObject({ reconciled: true, inventoryChecked: true, orphanVectors: 0, orphanVectorsInDraft: 0 });
      expect(batches).toEqual([1]); // only the ledger fetch: nothing known was treated as unknown
    });

    it("a listing error rethrows while pending so the step retries, and records nothing", async () => {
      const { vectors, draft } = await draftWithVectors();
      const broken: VectorInventory = { listAll: async () => { throw new VectorInventoryError("list request failed: HTTP 503"); } };
      await expect(
        reconcileDraft({ db: db(), vectors: vectors.port, inventory: broken, generationId: draft.generationId, missingIsPending: true }),
      ).rejects.toBeInstanceOf(VectorInventoryError);
      expect(await auditRow(draft.generationId)).toBeNull();
    });

    it("on the final attempt a listing error records a partial audit and is not reconciled", async () => {
      const { vectors, draft } = await draftWithVectors();
      const broken: VectorInventory = { listAll: async () => { throw new VectorInventoryError("list request failed: HTTP 503"); } };
      const outcome = await reconcileDraft({ db: db(), vectors: vectors.port, inventory: broken, generationId: draft.generationId });
      expect(outcome).toMatchObject({ mode: "ledger_getbyids", reconciled: false, status: "partial", expected: 1, inventoryChecked: false, orphanVectors: null });
      expect(outcome.reason).toMatch(/index scan failed: VectorInventoryError/);
      expect(await auditRow(draft.generationId)).toEqual({ status: "partial", missing_count: 1, orphan_count: 0 });
    });

    it("records the inventory columns on the draft check and leaves reconcile_mode alone", async () => {
      const { vectors, draft } = await draftWithVectors();
      addOrphan(vectors, "stray-elsewhere", "some-other-namespace");
      await reserveCheckRun(db(), draft.generationId);
      const outcome = await reconcileDraft({ db: db(), vectors: vectors.port, inventory: listing(vectors.store), generationId: draft.generationId });
      await finishCheckRun(db(), draft.generationId, {
        status: "passed",
        reconciled: outcome.reconciled,
        mode: outcome.mode,
        inventoryChecked: outcome.inventoryChecked,
        orphanVectors: outcome.orphanVectors,
        orphanVectorsInDraft: outcome.orphanVectorsInDraft,
        aclLeaks: 0,
        liveRecall: 1,
        questionsRun: 1,
        errorCode: null,
      });
      const row = await env.CORPUS_DB.prepare(
        "SELECT reconcile_mode, inventory_checked, orphan_vectors, orphan_vectors_in_draft FROM draft_checks WHERE generation_id = ?",
      )
        .bind(draft.generationId)
        .first<Record<string, unknown>>();
      expect(row).toEqual({ reconcile_mode: "ledger_getbyids", inventory_checked: 1, orphan_vectors: 1, orphan_vectors_in_draft: 0 });
      // Binding-only: the columns stay NULL, not zero.
      await finishCheckRun(db(), draft.generationId, {
        status: "passed",
        reconciled: true,
        mode: "ledger_getbyids",
        inventoryChecked: false,
        orphanVectors: null,
        orphanVectorsInDraft: null,
        aclLeaks: 0,
        liveRecall: 1,
        questionsRun: 1,
        errorCode: null,
      });
      const bare = await env.CORPUS_DB.prepare(
        "SELECT inventory_checked, orphan_vectors, orphan_vectors_in_draft FROM draft_checks WHERE generation_id = ?",
      )
        .bind(draft.generationId)
        .first<Record<string, unknown>>();
      expect(bare).toEqual({ inventory_checked: 0, orphan_vectors: null, orphan_vectors_in_draft: null });
    });
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

describe("reconcileWithFinalRecord", () => {
  // Fake step: retries the callback like RECONCILE_CONFIG would, up to `limit` attempts.
  function fakeStep(limit: number) {
    const names: string[] = [];
    return {
      names,
      step: {
        do: async (name: string, _config: unknown, fn: () => Promise<unknown>) => {
          names.push(name);
          let last: unknown;
          for (let attempt = 0; attempt < limit; attempt += 1) {
            try {
              return await fn();
            } catch (error) {
              last = error;
            }
          }
          throw last;
        },
      } as never,
    };
  }

  it("absorbs lag: vectors that appear after N attempts reconcile with no failure recorded", async () => {
    const vectors = fakeVectors();
    const ai = fakeAi();
    const draft = await newDraft();
    const ctx = { db: db(), ai, vectors: vectors.port };
    const doc = deptDoc(`upl-lag-${crypto.randomUUID().slice(0, 8)}`, ["hr"]);
    const written = await writeDocumentChunks(ctx, { generationId: draft.generationId, doc, body: "# L\n\nlagging", ensureDocumentRow: true });
    await embedChunkRange(ctx, { generationId: draft.generationId, documentId: doc.documentId, from: 0, to: written.chunkCount, reuseFromGenerationId: null });
    const row = await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ?").bind(draft.generationId).first<{ vector_id: string }>();
    const stored = vectors.store.get(row!.vector_id)!;
    vectors.drop(row!.vector_id);
    let attempts = 0;
    const { step, names } = fakeStep(12);
    const outcome = await reconcileWithFinalRecord(step, (pending) => {
      attempts += 1;
      if (attempts === 4) {
        vectors.store.set(row!.vector_id, stored);
      }
      return reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId, missingIsPending: pending });
    });
    expect(attempts).toBe(4);
    expect(names).toEqual(["reconcile"]);
    expect(outcome).toMatchObject({ reconciled: true, status: "complete" });
  });

  it("vectors that never appear end in a recorded failed audit via reconcile-final", async () => {
    const vectors = fakeVectors();
    const ai = fakeAi();
    const draft = await newDraft();
    const ctx = { db: db(), ai, vectors: vectors.port };
    const doc = deptDoc(`upl-gap-${crypto.randomUUID().slice(0, 8)}`, ["hr"]);
    const written = await writeDocumentChunks(ctx, { generationId: draft.generationId, doc, body: "# G\n\nnever", ensureDocumentRow: true });
    await embedChunkRange(ctx, { generationId: draft.generationId, documentId: doc.documentId, from: 0, to: written.chunkCount, reuseFromGenerationId: null });
    const row = await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ?").bind(draft.generationId).first<{ vector_id: string }>();
    vectors.drop(row!.vector_id);
    const { step, names } = fakeStep(3);
    const outcome = await reconcileWithFinalRecord(step, (pending) =>
      reconcileDraft({ db: db(), vectors: vectors.port, generationId: draft.generationId, missingIsPending: pending }),
    "ledger_getbyids");
    expect(names).toEqual(["reconcile", "reconcile-final"]);
    expect(outcome).toMatchObject({ reconciled: false, missing: 1 });
    const audit = await env.CORPUS_DB.prepare("SELECT missing_count FROM reconciliation_audits WHERE id = ?").bind(draft.generationId).first<{ missing_count: number }>();
    expect(audit?.missing_count).toBe(1);
    expect(decideChecks({ reconciled: outcome.reconciled, aclLeaks: 0, parityErrors: 0, liveRecall: 1, retrievalAvailable: true, documentsAdded: 1 }).errorCode).toBe("RECONCILIATION_FAILED");
  });

  it("an unexpected error in both steps still yields a failed outcome, never a thrown workflow", async () => {
    const { step, names } = fakeStep(2);
    const outcome = await reconcileWithFinalRecord(
      step,
      async () => {
        throw new Error("D1 down");
      },
      "keyword_only",
    );
    expect(names).toEqual(["reconcile", "reconcile-final"]);
    expect(outcome).toMatchObject({
      reconciled: false,
      mode: "keyword_only",
      expected: null,
      inventoryChecked: false,
      orphanVectors: null,
      orphanVectorsInDraft: null,
    });
  });
});
