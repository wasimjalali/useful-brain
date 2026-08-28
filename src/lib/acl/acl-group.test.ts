import { describe, expect, it } from "vitest";

import { ACL_GROUP_WIDTH, aclGroupKey, ownerOf } from "./acl-group";

describe("acl_group canonical form", () => {
  it("is length-prefixed, injective, and 32 hex wide", async () => {
    const oneRole = await aclGroupKey({
      accessScope: "role",
      allowedRoles: ["a,b"],
      allowedDepartments: [],
      ownerUserId: "",
    });
    const twoRoles = await aclGroupKey({
      accessScope: "role",
      allowedRoles: ["a", "b"],
      allowedDepartments: [],
      ownerUserId: "",
    });
    expect(oneRole).toHaveLength(ACL_GROUP_WIDTH);
    expect(oneRole).toMatch(/^[a-f0-9]{32}$/);
    expect(oneRole).not.toBe(twoRoles);
  });

  it("treats a non-string private owner as no owner", () => {
    expect(ownerOf({ owner_user_id: "alice" })).toBe("alice");
    expect(ownerOf({ owner_user_id: 123 })).toBe("");
    expect(ownerOf({ owner_user_id: "" })).toBe("");
  });
});
