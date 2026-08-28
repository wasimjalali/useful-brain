import { aclGroupKey, ownerOf, type AccessScope, type AclShape } from "./acl-group";
import type { ChunkRecord } from "../retrieve/types";
import { VECTORIZE_FILTER_MAX_BYTES } from "../store/vectorize-projection";

export const MAX_FILTER_TERMS = 40;

export class AclTooWide extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AclTooWide";
  }
}

export type Principal = {
  userId: string;
  roles: string[];
  departments: string[];
};

export type AclFilter = {
  userId: string;
  roles: string[];
  departments: string[];
};

export type AccessControlled = {
  accessScope: AccessScope | string;
  allowedRoles: string[];
  allowedDepartments: string[];
  ownerUserId?: string;
  metadata?: Record<string, unknown>;
};

export function aclFilterFor(principal: Principal): AclFilter {
  const roles = [...new Set(principal.roles)];
  const departments = [...new Set(principal.departments)];
  if (roles.length > MAX_FILTER_TERMS || departments.length > MAX_FILTER_TERMS) {
    throw new AclTooWide(
      `principal has ${roles.length} roles and ${departments.length} departments; the store-side filter carries at most ${MAX_FILTER_TERMS} of each`,
    );
  }
  return { userId: principal.userId, roles, departments };
}

export function ownerFromControlled(item: AccessControlled): string {
  if (item.metadata && Object.prototype.hasOwnProperty.call(item.metadata, "owner_user_id")) {
    return ownerOf(item.metadata);
  }
  return typeof item.ownerUserId === "string" && item.ownerUserId.length > 0 ? item.ownerUserId : "";
}

export function canAccessChunk(
  principal: Principal,
  chunk: AccessControlled,
): { allowed: boolean; reason: string | null } {
  const scope = String(chunk.accessScope);
  if (scope === "public") {
    return { allowed: true, reason: null };
  }
  if (scope === "department") {
    if (!chunk.allowedDepartments.length) {
      return { allowed: false, reason: "department_scope_empty" };
    }
    if (chunk.allowedDepartments.some((department) => principal.departments.includes(department))) {
      return { allowed: true, reason: null };
    }
    return { allowed: false, reason: "department_denied" };
  }
  if (scope === "role") {
    if (!chunk.allowedRoles.length) {
      return { allowed: false, reason: "role_scope_empty" };
    }
    if (chunk.allowedRoles.some((role) => principal.roles.includes(role))) {
      return { allowed: true, reason: null };
    }
    return { allowed: false, reason: "role_denied" };
  }
  if (scope === "private") {
    const owner = ownerFromControlled(chunk);
    if (owner && owner === principal.userId) {
      return { allowed: true, reason: null };
    }
    return { allowed: false, reason: "private_denied" };
  }
  return { allowed: false, reason: "unknown_scope" };
}

export function chunkMatchesFilter(acl: AclFilter, chunk: AccessControlled): boolean {
  return canAccessChunk(
    { userId: acl.userId, roles: acl.roles, departments: acl.departments },
    chunk,
  ).allowed;
}

export function groupMatchesFilter(
  acl: AclFilter,
  group: { accessScope: string; allowedRoles: string[]; allowedDepartments: string[]; ownerUserId: string },
): boolean {
  return chunkMatchesFilter(acl, {
    accessScope: group.accessScope,
    allowedRoles: group.allowedRoles,
    allowedDepartments: group.allowedDepartments,
    ownerUserId: group.ownerUserId,
  });
}

export function filterChunks(
  principal: Principal,
  chunks: ChunkRecord[],
): { allowed: ChunkRecord[]; removals: Array<{ chunkId: string; reason: string }> } {
  const allowed: ChunkRecord[] = [];
  const removals: Array<{ chunkId: string; reason: string }> = [];
  for (const chunk of chunks) {
    const result = canAccessChunk(principal, chunk);
    if (result.allowed) {
      allowed.push(chunk);
    } else {
      removals.push({ chunkId: chunk.chunkId, reason: result.reason ?? "denied" });
    }
  }
  return { allowed, removals };
}

export async function aclShapeFor(chunk: AccessControlled): Promise<AclShape> {
  const accessScope = String(chunk.accessScope);
  if (!(["public", "department", "role", "private"] as string[]).includes(accessScope)) {
    throw new Error("chunk access scope is missing or invalid");
  }
  return {
    accessScope: accessScope as AccessScope,
    allowedRoles: [...chunk.allowedRoles].sort(),
    allowedDepartments: [...chunk.allowedDepartments].sort(),
    ownerUserId: ownerFromControlled(chunk),
  };
}

export async function enumerateAllowedAclGroups(
  acl: AclFilter,
  shapes: AclShape[],
): Promise<string[]> {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const shape of shapes) {
    if (!groupMatchesFilter(acl, {
      accessScope: shape.accessScope,
      allowedRoles: shape.allowedRoles,
      allowedDepartments: shape.allowedDepartments,
      ownerUserId: shape.ownerUserId,
    })) {
      continue;
    }
    const key = await aclGroupKey(shape);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys.sort();
}

export function serializeAclGroupFilter(keys: string[]): string {
  return JSON.stringify({ acl_group: { $in: keys } });
}

export function assertSerializedFilterSize(serialized: string): void {
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes >= VECTORIZE_FILTER_MAX_BYTES) {
    throw new AclTooWide(`serialized Vectorize filter is ${bytes} bytes; refuse at ${VECTORIZE_FILTER_MAX_BYTES}`);
  }
}

export function aclSqlAndParams(acl: AclFilter): { sql: string; params: string[] } {
  const branches = ["c.access_scope = 'public'"];
  const params: string[] = [];
  if (acl.departments.length) {
    const placeholders = acl.departments.map(() => "?").join(",");
    branches.push(
      `(c.access_scope = 'department' AND EXISTS (SELECT 1 FROM json_each(c.allowed_departments) AS d WHERE d.value IN (${placeholders})))`,
    );
    params.push(...acl.departments);
  }
  if (acl.roles.length) {
    const placeholders = acl.roles.map(() => "?").join(",");
    branches.push(
      `(c.access_scope = 'role' AND EXISTS (SELECT 1 FROM json_each(c.allowed_roles) AS r WHERE r.value IN (${placeholders})))`,
    );
    params.push(...acl.roles);
  }
  branches.push(
    "(c.access_scope = 'private' AND json_type(c.metadata, '$.owner_user_id') = 'text' AND json_extract(c.metadata, '$.owner_user_id') <> '' AND json_extract(c.metadata, '$.owner_user_id') = ?)",
  );
  params.push(acl.userId);
  return { sql: `(${branches.join(" OR ")})`, params };
}

export function keywordSearchSql(aclSql: string): string {
  return `SELECT c.chunk_id AS chunk_id, 0.0 AS rank FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid WHERE chunks_fts MATCH ? AND c.generation_id = ? AND ${aclSql} ORDER BY c.chunk_id LIMIT ?`;
}

export function fts5MatchQuery(raw: string): string {
  const terms = raw.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (terms.length === 0) {
    throw new Error("FTS query contains no searchable terms");
  }
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
}

export function principalHasFullDocumentAccess(principal: Principal, chunks: ChunkRecord[]): boolean {
  return chunks.length > 0 && chunks.every((chunk) => canAccessChunk(principal, chunk).allowed);
}
