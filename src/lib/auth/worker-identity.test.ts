import { describe, expect, it } from "vitest";

import { AccessJwtError, AccessJwtUnavailable } from "./access-jwt";
import { IdentityConfigError } from "./identity-mode";
import { PrincipalResolutionError } from "./principal";
import { UnsignedPrincipalError } from "../cf/service-binding-identity";
import { authenticateWorkerRequest } from "./worker-identity";
import { SessionRequiredError } from "./session-errors";

const directory = {
  id: "principal-dev",
  subject: "dev@localhost",
  kind: "user" as const,
  roles: ["operator"],
  departments: ["engineering"],
};

describe("worker inbound identity", () => {
  it("resolves loopback identity from the operations directory", async () => {
    const principal = await authenticateWorkerRequest({
      identityMode: "loopback",
      headers: new Headers({
        "x-forwarded-for": "203.0.113.8",
        "cf-connecting-ip": "203.0.113.8",
      }),
      loopbackSubject: "dev@localhost",
      requirePrincipal: true,
      loadDirectory: async () => directory,
    });
    expect(principal).toEqual(directory);
  });

  it("does not treat caller-controlled headers as Access identity", async () => {
    await expect(
      authenticateWorkerRequest({
        identityMode: "access",
        headers: new Headers({
          "x-forwarded-for": "127.0.0.1",
          "cf-connecting-ip": "127.0.0.1",
        }),
        requirePrincipal: false,
      }),
    ).rejects.toBeInstanceOf(UnsignedPrincipalError);
  });

  it("fails closed when the loopback subject is missing from the directory", async () => {
    await expect(
      authenticateWorkerRequest({
        identityMode: "loopback",
        headers: new Headers(),
        loopbackSubject: "dev@localhost",
        requirePrincipal: true,
        loadDirectory: async () => null,
      }),
    ).rejects.toBeInstanceOf(PrincipalResolutionError);
  });

  it("resolves an Access identity from the operations directory", async () => {
    const principal = await authenticateWorkerRequest({
      identityMode: "access",
      headers: new Headers({ "cf-access-jwt-assertion": "signed.jwt.token" }),
      requirePrincipal: true,
      verifyAccess: async (token) => {
        expect(token).toBe("signed.jwt.token");
        return { subject: "dev@localhost", kind: "user" };
      },
      loadDirectory: async (subject, kind) => {
        expect(subject).toBe("dev@localhost");
        expect(kind).toBe("user");
        return directory;
      },
    });
    expect(principal).toEqual(directory);
  });

  it("rejects an unsigned principal header even when an Access assertion is present", async () => {
    await expect(
      authenticateWorkerRequest({
        identityMode: "access",
        headers: new Headers({
          "cf-access-jwt-assertion": "signed.jwt.token",
          "x-useful-brain-principal": "alice@karkoai.com",
        }),
        requirePrincipal: true,
        verifyAccess: async () => ({ subject: "dev@localhost", kind: "user" }),
        loadDirectory: async () => directory,
      }),
    ).rejects.toBeInstanceOf(UnsignedPrincipalError);
  });

  it("treats missing Access configuration as unavailable", async () => {
    await expect(
      authenticateWorkerRequest({
        identityMode: "access",
        headers: new Headers({ "cf-access-jwt-assertion": "signed.jwt.token" }),
        requirePrincipal: true,
        loadDirectory: async () => directory,
      }),
    ).rejects.toBeInstanceOf(AccessJwtUnavailable);
  });

  it("refuses disabled identity on authenticated routes", async () => {
    await expect(
      authenticateWorkerRequest({
        identityMode: "disabled",
        headers: new Headers(),
        requirePrincipal: false,
      }),
    ).rejects.toBeInstanceOf(IdentityConfigError);
  });

  it("allows loopback ingestion checks without a directory when principal is not required", async () => {
    await expect(
      authenticateWorkerRequest({
        identityMode: "loopback",
        headers: new Headers(),
        requirePrincipal: false,
      }),
    ).resolves.toBeNull();
  });

  it("still requires a verified assertion in access mode when principal lookup is skipped", async () => {
    await expect(
      authenticateWorkerRequest({
        identityMode: "access",
        headers: new Headers(),
        requirePrincipal: false,
      }),
    ).rejects.toBeInstanceOf(UnsignedPrincipalError);
  });

  it("maps a rejected token through the supplied verifier", async () => {
    await expect(
      authenticateWorkerRequest({
        identityMode: "access",
        headers: new Headers({ "cf-access-jwt-assertion": "bad.token" }),
        requirePrincipal: false,
        verifyAccess: async () => {
          throw new AccessJwtError("invalid");
        },
      }),
    ).rejects.toBeInstanceOf(AccessJwtError);
  });

  it("resolves a session principal and fails closed without a session cookie", async () => {
    const principal = await authenticateWorkerRequest({
      identityMode: "session",
      headers: new Headers({ cookie: "usefulbrain.session=tok_live" }),
      requirePrincipal: true,
      loadSession: async (token) => {
        expect(token).toBe("tok_live");
        return directory;
      },
    });
    expect(principal).toEqual(directory);
    await expect(
      authenticateWorkerRequest({
        identityMode: "session",
        headers: new Headers(),
        requirePrincipal: true,
        loadSession: async () => directory,
      }),
    ).rejects.toBeInstanceOf(SessionRequiredError);
  });

  it("prefers a valid session cookie over the loopback operator", async () => {
    const sessionUser = { ...directory, id: "principal-user", subject: "user@example.com" };
    const principal = await authenticateWorkerRequest({
      identityMode: "loopback",
      headers: new Headers({ cookie: "usefulbrain.session=tok_live" }),
      loopbackSubject: "dev@localhost",
      requirePrincipal: true,
      loadDirectory: async () => directory,
      loadSession: async () => sessionUser,
    });
    expect(principal).toEqual(sessionUser);
  });
});
