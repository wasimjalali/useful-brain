import type { SeedDocumentInput } from "./corpus-seed";

export function seedDocumentOwnerId(document: SeedDocumentInput): string {
  return typeof document.metadata?.owner_user_id === "string" ? document.metadata.owner_user_id : "";
}

export function stampPrivateOwner(
  principalId: string,
  document: SeedDocumentInput,
): SeedDocumentInput {
  const prefix = `upl-${principalId}-`;
  const documentId = document.documentId.startsWith(prefix)
    ? document.documentId
    : `${prefix}${document.documentId}`.slice(0, 128);
  return {
    ...document,
    documentId,
    sourcePath: document.sourcePath.startsWith("users/")
      ? document.sourcePath
      : `users/${principalId}/${document.sourcePath.split("/").pop() ?? document.documentId}.md`,
    accessScope: "private",
    allowedRoles: [],
    allowedDepartments: [],
    metadata: {
      ...(document.metadata ?? {}),
      owner_user_id: principalId,
      access_scope: "private",
      allowed_roles: [],
      allowed_departments: [],
    },
  };
}
