import { describe, expect, it } from "vitest";

import { canAccessChunk, filterChunks } from "./access";
import type { ChunkRecord } from "../retrieve/types";

function chunk(chunkId: string, accessScope: ChunkRecord["accessScope"], extra: Partial<ChunkRecord> = {}): ChunkRecord {
  return {
    chunkId,
    documentId: chunkId,
    title: chunkId,
    sourceName: chunkId,
    sourcePath: `${chunkId}.md`,
    sectionHeading: "Sec",
    content: "hello",
    chunkIndex: 0,
    charStart: 0,
    charEnd: 5,
    accessScope,
    allowedRoles: [],
    allowedDepartments: [],
    ownerUserId: "",
    embedding: null,
    ...extra,
  };
}

describe("ACL permissions", () => {
  it("allows public content and denies a department miss", () => {
    const intern = { userId: "u1", roles: [], departments: ["support"] };
    expect(canAccessChunk(intern, chunk("public", "public")).allowed).toBe(true);
    const denied = canAccessChunk(
      intern,
      chunk("mgr", "department", { allowedDepartments: ["management"] }),
    );
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe("department_denied");
  });

  it("filters forbidden chunks out of the candidate list", () => {
    const { allowed, removals } = filterChunks(
      { userId: "agent", roles: [], departments: ["support"] },
      [chunk("public", "public"), chunk("mgr", "department", { allowedDepartments: ["management"] })],
    );
    expect(allowed.map((item) => item.chunkId)).toEqual(["public"]);
    expect(removals[0]?.chunkId).toBe("mgr");
  });

  it("denies a non-string or empty private owner", () => {
    const principal = { userId: "123", roles: [], departments: [] };
    expect(canAccessChunk(principal, chunk("p", "private", { ownerUserId: "", metadata: { owner_user_id: 123 } })).allowed).toBe(
      false,
    );
    expect(canAccessChunk(principal, chunk("p2", "private", { ownerUserId: "123", metadata: { owner_user_id: "123" } })).allowed).toBe(
      true,
    );
  });
});
