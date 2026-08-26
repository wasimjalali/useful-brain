import { describe, expect, it } from "vitest";

import { UnsignedPrincipalError, assertionForBrain } from "./service-binding-identity";

describe("service-binding identity", () => {
  it("forwards only the Access assertion and rejects an unsigned principal", () => {
    expect(
      assertionForBrain(new Headers({ "cf-access-jwt-assertion": "signed.jwt.token" })),
    ).toBe("signed.jwt.token");
    expect(() =>
      assertionForBrain(
        new Headers({
          "cf-access-jwt-assertion": "signed.jwt.token",
          "x-useful-brain-principal": "alice@karkoai.com",
        }),
      ),
    ).toThrow(UnsignedPrincipalError);
    expect(() =>
      assertionForBrain(
        new Headers({ "cf-access-authenticated-user-email": "alice@karkoai.com" }),
      ),
    ).toThrow(/unsigned principal/);
  });
});
