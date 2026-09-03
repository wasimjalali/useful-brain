import { describe, expect, it } from "vitest";

import type { SqlExecutor } from "./corpus-d1";
import type { SeedDocumentInput } from "./corpus-seed";
import { loadKnowledgeInventory } from "./knowledge-inventory";
import { seedDocumentOwnerId, stampPrivateOwner } from "./owned-seed";

const upload = (id: string): SeedDocumentInput => ({
  documentId: id,
  title: id,
  sourceName: id,
  sourcePath: `northwind/uploads/${id}.md`,
  accessScope: "public",
  allowedRoles: [],
  allowedDepartments: [],
  body: "Hello.",
  metadata: {},
});

function inventoryDb(): SqlExecutor {
  const chunk = (
    documentId: string,
    owner: string,
    accessScope: string,
  ) => ({
    chunk_id: `${documentId}--c0`,
    document_id: documentId,
    heading: "h",
    content: "body",
    created_at: 1,
    access_scope: accessScope,
    allowed_roles: "[]",
    allowed_departments: "[]",
    metadata: JSON.stringify({ owner_user_id: owner }),
  });
  return {
    prepare(sql: string) {
      const statement = {
        bind() {
          return statement;
        },
        async first() {
          if (sql.includes("corpus_state")) {
            return { active_generation_id: "g1" };
          }
          if (sql.includes("state = 'ready'")) {
            return { id: "g1" };
          }
          if (sql.includes("FROM corpus_generations")) {
            return { id: "g1", state: "active" };
          }
          if (sql.includes("COUNT(DISTINCT")) {
            return { n: 2 };
          }
          if (sql.includes("COUNT(*)")) {
            return { n: 2 };
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM documents d")) {
            return {
              results: [
                { id: "doc-public", path: "northwind/public.md" },
                { id: "doc-alice", path: "users/p-alice/notes.md" },
              ],
            };
          }
          return {
            results: [
              chunk("doc-public", "", "public"),
              chunk("doc-alice", "p-alice", "private"),
            ],
          };
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch() {
      return [];
    },
  } as unknown as SqlExecutor;
}

describe("per-user upload isolation", () => {
  it("stamps a non-operator upload as private to that principal", () => {
    const stamped = stampPrivateOwner("p-alice", upload("nw_upload_notes"));

    expect(stamped.accessScope).toBe("private");
    expect(seedDocumentOwnerId(stamped)).toBe("p-alice");
    expect(stamped.documentId.startsWith("upl-p-alice-")).toBe(true);
    expect(stamped.sourcePath.startsWith("users/p-alice/")).toBe(true);
  });

  it("shows each user only their own private documents plus public ones", async () => {
    const db = inventoryDb();
    const alice = { userId: "p-alice", roles: [], departments: [] };
    const bob = { userId: "p-bob", roles: [], departments: [] };

    const forAlice = await loadKnowledgeInventory(db, "keyword", alice);
    const forBob = await loadKnowledgeInventory(db, "keyword", bob);

    expect(forAlice.documents.map((doc) => doc.id).sort()).toEqual([
      "doc-alice",
      "doc-public",
    ]);
    expect(forBob.documents.map((doc) => doc.id)).toEqual(["doc-public"]);
  });
});
