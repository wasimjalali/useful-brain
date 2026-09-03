import { describe, expect, it } from "vitest";

import type { SeedDocumentInput } from "./corpus-seed";
import { mayPromoteGeneration } from "./promote-auth";
import { stampPrivateOwner } from "./owned-seed";

const doc = (overrides: Partial<SeedDocumentInput> = {}): SeedDocumentInput => ({
  documentId: "doc",
  title: "doc",
  sourceName: "doc",
  sourcePath: "northwind/doc.md",
  accessScope: "public",
  allowedRoles: [],
  allowedDepartments: [],
  body: "body",
  metadata: {},
  ...overrides,
});

describe("mayPromoteGeneration", () => {
  it("always allows the operator", () => {
    expect(
      mayPromoteGeneration([stampPrivateOwner("p-other", doc())], {
        id: "p-op",
        roles: ["operator"],
      }),
    ).toBe(true);
  });

  it("denies an empty generation", () => {
    expect(mayPromoteGeneration([], { id: "p-a", roles: [] })).toBe(false);
  });

  it("allows a user to promote a generation of public docs plus their own uploads", () => {
    const documents = [doc(), stampPrivateOwner("p-a", doc())];
    expect(mayPromoteGeneration(documents, { id: "p-a", roles: [] })).toBe(true);
  });

  it("denies a user when another principal owns a document in the generation", () => {
    const documents = [doc(), stampPrivateOwner("p-b", doc())];
    expect(mayPromoteGeneration(documents, { id: "p-a", roles: [] })).toBe(false);
  });

  it("fails closed on a malformed non-public scope without an owner", () => {
    expect(
      mayPromoteGeneration([doc({ accessScope: "role", allowedRoles: ["hr_manager"] })], {
        id: "p-a",
        roles: [],
      }),
    ).toBe(false);
  });
});
