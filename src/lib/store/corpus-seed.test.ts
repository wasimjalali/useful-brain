import { describe, expect, it } from "vitest";

import type { SqlExecutor } from "./corpus-d1";
import {
  loadSeedDocumentsFromGeneration,
  mergeSeedDocuments,
  seedNorthwindCorpus,
  type SeedDocumentInput,
} from "./corpus-seed";

const publicDoc = (id: string, body: string): SeedDocumentInput => ({
  documentId: id,
  title: id,
  sourceName: id,
  sourcePath: `northwind/${id}.md`,
  accessScope: "public",
  allowedRoles: [],
  allowedDepartments: [],
  body,
});

describe("corpus seed merge", () => {
  it("keeps existing documents and lets incoming ids replace", () => {
    const merged = mergeSeedDocuments(
      [publicDoc("nw_a", "A"), publicDoc("nw_b", "B")],
      [publicDoc("nw_b", "B2"), publicDoc("nw_c", "C")],
    );
    expect(merged.map((document) => document.documentId).sort()).toEqual(["nw_a", "nw_b", "nw_c"]);
    expect(merged.find((document) => document.documentId === "nw_b")?.body).toBe("B2");
  });

  it("does not call Workers AI when Vectorize upsert is unavailable", async () => {
    const states = new Map<string, string>();
    const db = {
      prepare(sql: string) {
        const statement = {
          values: [] as unknown[],
          bind(...values: unknown[]) {
            statement.values = values;
            return statement;
          },
          async run() {
            if (sql.includes("INSERT INTO corpus_generations")) {
              states.set(String(statement.values[0]), "draft");
            }
            if (sql.includes("UPDATE corpus_generations SET state")) {
              const next = statement.values[0];
              const id = statement.values[statement.values.length - 1];
              if (typeof next === "string" && typeof id === "string") {
                states.set(id, next);
              }
            }
            return { meta: { changes: 1 } };
          },
          async first() {
            if (sql.includes("SELECT id, state FROM corpus_generations")) {
              const id = String(statement.values[0]);
              return { id, state: states.get(id) ?? "draft" };
            }
            return null;
          },
          async all() {
            return { results: [] };
          },
        };
        return statement;
      },
      async batch() {
        return [];
      },
    } as unknown as SqlExecutor;

    const result = await seedNorthwindCorpus({
      db,
      documents: [publicDoc("nw_a", "# Hello\n\nWorld.")],
      ai: {
        run: async () => {
          throw new Error("Workers AI should not run without Vectorize");
        },
      },
      now: 1,
    });
    expect(result.vectorize).toBe("skipped");
    expect(result.chunkCount).toBeGreaterThan(0);
  });

  it("reconstructs seed documents from stored chunks and ACL columns", async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                return {
                  results: [
                    {
                      document_id: "nw_a",
                      path: "northwind/a.md",
                      content: "First.",
                      chunk_index: 0,
                      access_scope: "department",
                      allowed_roles: "[]",
                      allowed_departments: '["finance"]',
                      metadata: '{"title":"Finance note","source_name":"Finance"}',
                    },
                    {
                      document_id: "nw_a",
                      path: "northwind/a.md",
                      content: "Second.",
                      chunk_index: 1,
                      access_scope: "department",
                      allowed_roles: "[]",
                      allowed_departments: '["finance"]',
                      metadata: '{"title":"Finance note","source_name":"Finance"}',
                    },
                  ],
                };
              },
            };
          },
        };
      },
    } as unknown as SqlExecutor;

    const documents = await loadSeedDocumentsFromGeneration(db, "g-1");
    expect(documents).toEqual([
      {
        documentId: "nw_a",
        title: "Finance note",
        sourceName: "Finance",
        sourcePath: "northwind/a.md",
        accessScope: "department",
        allowedRoles: [],
        allowedDepartments: ["finance"],
        body: "First.\n\nSecond.",
        metadata: { title: "Finance note", source_name: "Finance" },
      },
    ]);
  });
});
