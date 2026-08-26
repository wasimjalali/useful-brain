import {
  AccessJwtUnavailable,
  type AccessIdentity,
} from "./access-jwt";
import {
  IdentityConfigError,
  type IdentityMode,
} from "./identity-mode";
import { resolvePrincipal, type DirectoryRecord } from "./principal";
import { assertionForBrain, rejectSpoofedPrincipal } from "../cf/service-binding-identity";

export type WorkerDirectoryLookup = (
  subject: string,
  kind: AccessIdentity["kind"],
) => Promise<DirectoryRecord | null>;

export type AuthenticateWorkerRequestInput = {
  identityMode: IdentityMode;
  headers: Headers;
  loopbackSubject?: string;
  requirePrincipal: boolean;
  verifyAccess?: (token: string) => Promise<AccessIdentity>;
  loadDirectory?: WorkerDirectoryLookup;
};

export async function authenticateWorkerRequest(
  input: AuthenticateWorkerRequestInput,
): Promise<DirectoryRecord | null> {
  if (input.identityMode === "disabled") {
    throw new IdentityConfigError("disabled identity cannot serve authenticated routes");
  }

  rejectSpoofedPrincipal(input.headers);

  if (input.identityMode === "loopback") {
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
