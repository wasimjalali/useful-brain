import { describe, expect, it } from "vitest";

import {
  UnsignedPrincipalError,
  assertionForBrain,
  createBrainBoundRequest,
} from "./service-binding-identity";

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

  it("forwards only the original Access assertion to Brain", () => {
    const forwarded = createBrainBoundRequest(
      new Request("https://web.example/whoami", {
        headers: {
          "cf-access-jwt-assertion": "signed.jwt.token",
          "x-useful-brain-principal": "alice@karkoai.com",
          "cf-access-authenticated-user-email": "alice@karkoai.com",
          cookie: "CF_Authorization=browser-cookie",
          authorization: "Bearer spoofed",
          "x-request-id": "11111111-1111-4111-8111-111111111111",
        },
      }),
    );
    expect(forwarded.headers.get("cf-access-jwt-assertion")).toBe("signed.jwt.token");
    expect(forwarded.headers.get("x-request-id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(forwarded.headers.get("x-useful-brain-principal")).toBeNull();
    expect(forwarded.headers.get("cf-access-authenticated-user-email")).toBeNull();
    expect(forwarded.headers.get("cookie")).toBeNull();
    expect(forwarded.headers.get("authorization")).toBeNull();
  });
});
