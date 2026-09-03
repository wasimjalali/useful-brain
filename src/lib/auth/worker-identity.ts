import {
  AccessJwtUnavailable,
  type AccessIdentity,
} from "./access-jwt";
import {
  IdentityConfigError,
  type IdentityMode,
} from "./identity-mode";
import { resolvePrincipal, type DirectoryRecord } from "./principal";
import { MAX_FILTER_TERMS, type Principal } from "../acl/access";
import { assertionForBrain, rejectSpoofedPrincipal } from "../cf/service-binding-identity";
import { readSessionToken } from "./session-cookie";
import { SessionRequiredError } from "./session-errors";

export class AssumedPrincipalForbidden extends Error {
  constructor() {
    super("assumed principals are accepted only in loopback identity mode");
    this.name = "AssumedPrincipalForbidden";
  }
}

export class AssumedPrincipalInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssumedPrincipalInvalid";
  }
}

const MAX_SUBJECT_LENGTH = 128;
const MAX_GRANT_LENGTH = 64;

/**
 * Parse an optional caller-supplied retrieval principal for ACL demos and
 * evals. Fails closed: any presence outside loopback identity mode is
 * forbidden, and a malformed shape (missing userId, missing grant arrays,
 * non-string or oversized values) is rejected rather than defaulted.
 *
 * In loopback mode the assumed principal may be any synthetic principal,
 * including a private-document owner: the local operator loaded the corpus
 * and the demo must be able to show owner-scoped retrieval. This is why
 * the field is confined to the loopback trust boundary.
 */
export function parseAssumedPrincipal(
  identityMode: IdentityMode,
  raw: unknown,
): Principal | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (identityMode !== "loopback") {
    throw new AssumedPrincipalForbidden();
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new AssumedPrincipalInvalid("assumed principal must be an object");
  }
  const record = raw as { userId?: unknown; roles?: unknown; departments?: unknown };
  const userId = typeof record.userId === "string" ? record.userId.trim() : "";
  if (!userId || userId.length > MAX_SUBJECT_LENGTH) {
    throw new AssumedPrincipalInvalid("assumed principal requires a bounded userId");
  }
  return {
    userId,
    roles: parseGrantList(record.roles, "roles"),
    departments: parseGrantList(record.departments, "departments"),
  };
}

function parseGrantList(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) {
    throw new AssumedPrincipalInvalid(`assumed principal requires a ${field} array`);
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || !value.trim() || value.length > MAX_GRANT_LENGTH) {
      throw new AssumedPrincipalInvalid(`assumed principal ${field} entries must be bounded strings`);
    }
    const trimmed = value.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      values.push(trimmed);
    }
  }
  if (values.length > MAX_FILTER_TERMS) {
    throw new AssumedPrincipalInvalid(`assumed principal carries too many ${field}`);
  }
  return values;
}

export type WorkerDirectoryLookup = (
  subject: string,
  kind: AccessIdentity["kind"],
) => Promise<DirectoryRecord | null>;

export type WorkerSessionLookup = (token: string) => Promise<DirectoryRecord | null>;

export type AuthenticateWorkerRequestInput = {
  identityMode: IdentityMode;
  headers: Headers;
  loopbackSubject?: string;
  requirePrincipal: boolean;
  verifyAccess?: (token: string) => Promise<AccessIdentity>;
  loadDirectory?: WorkerDirectoryLookup;
  loadSession?: WorkerSessionLookup;
};

async function principalFromSession(
  input: AuthenticateWorkerRequestInput,
): Promise<DirectoryRecord | null> {
  const token = readSessionToken(input.headers);
  if (!token) {
    return null;
  }
  if (!input.loadSession) {
    throw new IdentityConfigError("session lookup is not configured");
  }
  return input.loadSession(token);
}

export async function authenticateWorkerRequest(
  input: AuthenticateWorkerRequestInput,
): Promise<DirectoryRecord | null> {
  if (input.identityMode === "disabled") {
    throw new IdentityConfigError("disabled identity cannot serve authenticated routes");
  }

  rejectSpoofedPrincipal(input.headers);

  if (input.identityMode === "session") {
    const sessionPrincipal = await principalFromSession(input);
    if (!sessionPrincipal) {
      throw new SessionRequiredError();
    }
    return sessionPrincipal;
  }

  if (input.identityMode === "loopback") {
    const sessionPrincipal = await principalFromSession(input);
    if (sessionPrincipal) {
      return sessionPrincipal;
    }
    if (!input.requirePrincipal) {
      return null;
    }
    const subject = input.loopbackSubject?.trim().toLowerCase();
    if (!subject) {
      throw new IdentityConfigError("LOOPBACK_SUBJECT is not configured");
    }
    if (!input.loadDirectory) {
      throw new IdentityConfigError("operations directory lookup is not configured");
    }
    return resolvePrincipal({ subject, kind: "user" }, await input.loadDirectory(subject, "user"));
  }

  const token = assertionForBrain(input.headers);
  if (!input.verifyAccess) {
    throw new AccessJwtUnavailable("Access is not configured");
  }
  const identity = await input.verifyAccess(token);
  if (!input.requirePrincipal) {
    return null;
  }
  if (!input.loadDirectory) {
    throw new IdentityConfigError("operations directory lookup is not configured");
  }
  return resolvePrincipal(identity, await input.loadDirectory(identity.subject, identity.kind));
}
