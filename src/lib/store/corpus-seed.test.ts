import { describe, expect, it } from "vitest";

import type { SqlExecutor } from "./corpus-d1";
import {
  loadSeedDocumentsFromGeneration,
  mergeSeedDocuments,
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
