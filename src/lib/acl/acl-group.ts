import { sha256Hex } from "../ingest/digests";

export const ACL_GROUP_WIDTH = 32;

export type AccessScope = "public" | "role" | "department" | "private";

export type AclShape = {
  accessScope: AccessScope;
  allowedRoles: string[];
  allowedDepartments: string[];
  ownerUserId: string;
};

export function ownerOf(metadata: Record<string, unknown>): string {
  const owner = metadata.owner_user_id;
  if (typeof owner === "string" && owner.length > 0) {
    return owner;
  }
  return "";
}

function encode(parts: string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("");
}

export async function aclGroupKey(shape: AclShape): Promise<string> {
  const canonical = encode([
    shape.accessScope,
    encode([...shape.allowedRoles].sort()),
    encode([...shape.allowedDepartments].sort()),
    shape.ownerUserId,
  ]);
  return (await sha256Hex(canonical)).slice(0, ACL_GROUP_WIDTH);
}
