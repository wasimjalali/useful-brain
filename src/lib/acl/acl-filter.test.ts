import { describe, expect, it } from "vitest";

import {
  AclTooWide,
  MAX_FILTER_TERMS,
  aclFilterFor,
  aclShapeFor,
  canAccessChunk,
  chunkMatchesFilter,
  enumerateAllowedAclGroups,
  groupMatchesFilter,
  serializeAclGroupFilter,
  assertSerializedFilterSize,
} from "./access";
import { aclGroupKey } from "./acl-group";
import type { AccessScope } from "./acl-group";

const SCOPES = ["public", "department", "role", "private", "not_a_scope"] as const;
const ROLE_SETS = [[], ["finance"], ["hr", "legal"], ["hr,legal"], ["3:abc"]];
const DEPARTMENT_SETS = [[], ["finance"], ["engineering", "hr"], ["engineering,hr"]];
const OWNERS = ["", "123", "kim@example.com"];

describe("ACL predicate equivalence", () => {
  it("keeps canAccess, filter, and group form in agreement", async () => {
    const principal = { userId: "kim@example.com", roles: ["finance", "hr"], departments: ["engineering", "hr"] };
    const acl = aclFilterFor(principal);
    for (const scope of SCOPES) {
      for (const roles of ROLE_SETS) {
        for (const departments of DEPARTMENT_SETS) {
          for (const owner of OWNERS) {
            const chunk = {
              accessScope: scope as AccessScope,
              allowedRoles: roles,
              allowedDepartments: departments,
              ownerUserId: owner,
              metadata: { owner_user_id: owner },
            };
            const access = canAccessChunk(principal, chunk).allowed;
            expect(chunkMatchesFilter(acl, chunk)).toBe(access);
            expect(
              groupMatchesFilter(acl, {
                accessScope: scope,
                allowedRoles: roles,
                allowedDepartments: departments,
                ownerUserId: owner,
              }),
            ).toBe(access);
          }
        }
      }
    }
    const one = await aclGroupKey({
      accessScope: "role",
      allowedRoles: ["a,b"],
      allowedDepartments: [],
      ownerUserId: "",
    });
    const two = await aclGroupKey({
      accessScope: "role",
      allowedRoles: ["a", "b"],
      allowedDepartments: [],
      ownerUserId: "",
    });
    expect(one).not.toBe(two);
  });

  it("raises AclTooWide instead of truncating grants", () => {
    expect(() =>
      aclFilterFor({
        userId: "wide",
        roles: Array.from({ length: MAX_FILTER_TERMS + 1 }, (_, i) => `r${i}`),
        departments: ["engineering"],
      }),
    ).toThrow(AclTooWide);
  });

  it("rejects an empty or unknown ACL scope instead of projecting it as public", async () => {
    for (const accessScope of ["", "unknown"]) {
      await expect(
        aclShapeFor({
          accessScope,
          allowedRoles: [],
          allowedDepartments: [],
          ownerUserId: "",
        }),
      ).rejects.toThrow(/access scope/);
    }
  });

  it("enumerates only allowed acl_group keys and refuses a 2048-byte filter", async () => {
    const acl = aclFilterFor({ userId: "eng_ic", roles: ["standard"], departments: ["engineering"] });
    const keys = await enumerateAllowedAclGroups(acl, [
      { accessScope: "public", allowedRoles: [], allowedDepartments: [], ownerUserId: "" },
      { accessScope: "department", allowedRoles: [], allowedDepartments: ["hr"], ownerUserId: "" },
      { accessScope: "department", allowedRoles: [], allowedDepartments: ["engineering"], ownerUserId: "" },
    ]);
    expect(keys).toHaveLength(2);
    const serialized = serializeAclGroupFilter(keys);
    expect(serialized).toMatch(/acl_group/);
    expect(() => assertSerializedFilterSize(serialized)).not.toThrow();
    expect(() => assertSerializedFilterSize("x".repeat(2048))).toThrow(/2048/);
  });
});
