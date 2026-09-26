import { beforeEach, describe, expect, it, vi } from "vitest";

const getCloudflareContext = vi.fn();
const forwardIdentityToBrain = vi.fn();

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: (...args: unknown[]) =>
    getCloudflareContext(...args),
}));

vi.mock("@/lib/cf/service-binding-identity", () => ({
  forwardIdentityToBrain: (...args: unknown[]) =>
    forwardIdentityToBrain(...args),
}));

import { GET } from "./route";

type BrainResponseInit = {
  status: number;
  headers?: Headers;
  body?: string;
};

function brainResponse(init: BrainResponseInit): Response {
  return new Response(init.body ?? "", {
    status: init.status,
    headers: init.headers,
  });
}

const upstreamRequest = new Request("http://web.test/api/turns/req-abc/progress");

describe("GET /api/turns/[requestId]", () => {
  beforeEach(() => {
    getCloudflareContext.mockReset();
    forwardIdentityToBrain.mockReset();
    getCloudflareContext.mockResolvedValue({
      env: { BRAIN: { fetch: vi.fn() } },
    });
  });

  it("forwards identity and path upstream and passes status, body and content type through", async () => {
    forwardIdentityToBrain.mockResolvedValue(
      brainResponse({
        status: 200,
        headers: new Headers({
          "content-type": "application/json",
          "x-request-id": "req-test-1",
        }),
        body: JSON.stringify({ stage: "searching" }),
      }),
    );
    const response = await GET(upstreamRequest, {
      params: Promise.resolve({ requestId: "req-abc" }),
    });
    expect(forwardIdentityToBrain).toHaveBeenCalledTimes(1);
    const [binding, original, forwardedPath] = forwardIdentityToBrain.mock
      .calls[0] as unknown as [
      { fetch: unknown },
      Request,
      string,
    ];
    expect(binding).toEqual({ fetch: expect.any(Function) });
    expect(original).toBe(upstreamRequest);
    expect(forwardedPath).toBe("/turns/req-abc/progress");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(JSON.stringify({ stage: "searching" }));
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-request-id")).toBe("req-test-1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 503 without touching upstream when the Brain binding is missing", async () => {
    getCloudflareContext.mockResolvedValue({ env: {} });
    const response = await GET(upstreamRequest, {
      params: Promise.resolve({ requestId: "req-abc" }),
    });
    expect(forwardIdentityToBrain).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBeNull();
  });

  it("passes upstream 404 through with no-store despite no upstream cache header", async () => {
    forwardIdentityToBrain.mockResolvedValue(
      brainResponse({ status: 404, body: "not found" }),
    );
    const response = await GET(upstreamRequest, {
      params: Promise.resolve({ requestId: "req-xyz" }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("not found");
  });

  it("keeps upstream 401 identity failures untouched and uncached", async () => {
    forwardIdentityToBrain.mockResolvedValue(
      brainResponse({
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        body: JSON.stringify({ code: "AUTH_REQUIRED" }),
      }),
    );
    const response = await GET(upstreamRequest, {
      params: Promise.resolve({ requestId: "req-abc" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("AUTH_REQUIRED");
  });
});
