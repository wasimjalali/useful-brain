import { describe, expect, it } from "vitest";

import { PrincipalResolutionError, resolvePrincipal } from "./principal";

describe("principal directory resolution", () => {
  it("loads roles and departments from the principal id, not a user foreign key", () => {
    const principal = resolvePrincipal(
      { subject: "alice@karkoai.com", kind: "user" },
      {
        id: "principal-alice",
        subject: "alice@karkoai.com",
        kind: "user",
        roles: ["operator"],
        departments: ["support"],
      },
    );
    expect(principal.id).toBe("principal-alice");
    expect(principal.roles).toEqual(["operator"]);
    expect(principal.departments).toEqual(["support"]);
  });

  it("fails closed when the verified subject is missing", () => {
    expect(() =>
      resolvePrincipal({ subject: "alice@karkoai.com", kind: "user" }, null),
    ).toThrow(PrincipalResolutionError);
  });

  it("keeps employee and service-token namespaces disjoint", () => {
    expect(() =>
      resolvePrincipal(
        { subject: "alice@karkoai.com", kind: "user" },
        {
          id: "principal-collision",
          subject: "alice@karkoai.com",
          kind: "service_token",
          roles: ["admin"],
          departments: [],
        },
      ),
    ).toThrow(/does not match/);
  });

  it("does not let a service token inherit user grants", () => {
    const token = resolvePrincipal(
      { subject: "ci-bot.access", kind: "service_token" },
      {
        id: "principal-bot",
        subject: "ci-bot.access",
        kind: "service_token",
        roles: ["ingest"],
        departments: [],
      },
    );
    expect(token.id).toBe("principal-bot");
    expect(token.roles).toEqual(["ingest"]);
    expect(() =>
      resolvePrincipal(
        { subject: "ci-bot.access", kind: "service_token" },
        {
          id: "principal-alice",
          subject: "alice@karkoai.com",
          kind: "user",
          roles: ["operator"],
          departments: ["support"],
        },
      ),
    ).toThrow(/does not match/);
  });
});
