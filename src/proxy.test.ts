import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let vars: Record<string, string> = {};

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: vars }),
}));

function request(host: string) {
  return new NextRequest("http://internal.invalid/chat", { headers: { host } });
}

describe("loopback Host guard", () => {
  beforeEach(() => {
    vars = {};
  });

  it.each(["127.0.0.1:8787", "localhost:3000", "[::1]:8787", "LOCALHOST:8787", "127.0.0.1"])(
    "serves %s in loopback mode",
    async (host) => {
      vars = { LOOPBACK_RUNTIME: "true" };
      const { proxy } = await import("./proxy");
      const response = await proxy(request(host));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it.each([
    "attacker.example:8787",
    "attacker.example",
    "127.0.0.1.attacker.example:8787",
    "localhost.attacker.example",
    "127.0.0.2:8787",
    "127.0.0.1:99999",
    "[::2]:8787",
    "127.0.0.1:8787@evil.example",
    "",
  ])("rejects %j in loopback mode", async (host) => {
    vars = { LOOPBACK_RUNTIME: "true" };
    const { proxy } = await import("./proxy");
    const response = await proxy(request(host));
    expect(response.status).toBe(403);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it("leaves session mode alone, whatever the Host", async () => {
    vars = { LOOPBACK_RUNTIME: "false" };
    const { proxy } = await import("./proxy");
    const response = await proxy(request("app.workers.dev"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
