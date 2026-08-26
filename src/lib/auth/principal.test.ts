import { describe, expect, it } from "vitest";

import { PrincipalResolutionError, resolvePrincipal } from "./principal";

describe("principal directory resolution", () => {
  it("loads roles and departments only from the operations directory", () => {
    const principal = resolvePrincipal(
      { subject: "alice@karkoai.com", kind: "user" },
      {
        subject: "alice@karkoai.com",
        kind: "user",
        roles: ["operator"],
        departments: ["support"],
      },
    );
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
          subject: "alice@karkoai.com",
          kind: "service_token",
          roles: [],
          departments: [],
        },
      ),
    ).toThrow(/does not match/);
  });
});
