import type { AccessIdentity } from "./access-jwt";

export type DirectoryRecord = {
  subject: string;
  kind: "user" | "service_token";
  roles: string[];
  departments: string[];
};

export class PrincipalResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrincipalResolutionError";
  }
}

export function resolvePrincipal(
  identity: AccessIdentity,
  record: DirectoryRecord | null,
): DirectoryRecord {
  if (!record) {
    throw new PrincipalResolutionError("Verified subject is not in the operations directory");
  }
  if (record.subject !== identity.subject || record.kind !== identity.kind) {
    throw new PrincipalResolutionError("Directory record does not match the verified subject");
  }
  if (identity.kind === "user" && !identity.subject.includes("@")) {
    throw new PrincipalResolutionError("Employee subjects must occupy the email namespace");
  }
  if (identity.kind === "service_token" && identity.subject.includes("@")) {
    throw new PrincipalResolutionError("Service-token subjects must not occupy the email namespace");
  }
  return {
    subject: record.subject,
    kind: record.kind,
    roles: [...record.roles],
    departments: [...record.departments],
  };
}

export function rolesFromDirectoryOnly(record: DirectoryRecord): string[] {
  return [...record.roles];
}
