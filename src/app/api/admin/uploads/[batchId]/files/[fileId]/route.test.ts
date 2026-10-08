import { beforeEach, describe, expect, it, vi } from "vitest";

const brainFetch = vi.fn();
let bound = true;
let loopback = "false";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({
    env: bound ? { BRAIN: { fetch: brainFetch }, LOOPBACK_RUNTIME: loopback } : { LOOPBACK_RUNTIME: loopback },
  }),
}));

const params = (batchId = "ub-1", fileId = "uf-1") => ({ params: Promise.resolve({ batchId, fileId }) });

function putRequest(
  init: {
    origin?: string;
    length?: string | null;
    body?: BodyInit | null;
    cookie?: string;
    host?: string;
    url?: string;
    fetchSite?: string;
  } = {},
) {
  const headers = new Headers();
  if (init.origin !== undefined) headers.set("origin", init.origin);
  if (init.host !== undefined) headers.set("host", init.host);
  if (init.fetchSite !== undefined) headers.set("sec-fetch-site", init.fetchSite);
  if (init.length !== null) headers.set("content-length", init.length ?? "5");
  headers.set("cookie", init.cookie ?? "usefulbrain.session=abc; other=1");
  return new Request(init.url ?? "https://app.example/api/admin/uploads/ub-1/files/uf-1", {
    method: "PUT",
    headers,
    body: init.body === undefined ? "hello" : init.body,
  });
}

describe("PUT /api/admin/uploads/:batchId/files/:fileId", () => {
  beforeEach(() => {
    brainFetch.mockReset();
    bound = true;
    loopback = "false";
  });

  it("in loopback mode refuses a rebound host that matches its own Origin", async () => {
    loopback = "true";
    const { PUT } = await import("./route");
    const response = await PUT(
      putRequest({ origin: "http://attacker.example:8787", host: "attacker.example:8787", fetchSite: "same-origin" }),
      params(),
    );
    expect(response.status).toBe(403);
    expect(brainFetch).not.toHaveBeenCalled();
  });

  it("in loopback mode accepts 127.0.0.1, localhost and [::1] hosts", async () => {
    loopback = "true";
    brainFetch.mockResolvedValue(Response.json({ ok: true }));
    const { PUT } = await import("./route");
    for (const host of ["127.0.0.1:8787", "localhost:8787", "[::1]:8787"]) {
      const response = await PUT(
        putRequest({ origin: `http://${host}`, host, fetchSite: "same-origin" }),
        params(),
      );
      expect(response.status).toBe(200);
    }
  });

  it("refuses a cross-site origin before touching Brain", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(putRequest({ origin: "https://evil.example" }), params());
    expect(response.status).toBe(403);
    expect(brainFetch).not.toHaveBeenCalled();
  });

  it("accepts a same-origin upload when the worker sees an internal request URL", async () => {
    // Behind OpenNext and wrangler the request URL carries an internal origin;
    // the browser-set Host header is what the page was served from.
    brainFetch.mockResolvedValue(Response.json({ ok: true }));
    const { PUT } = await import("./route");
    const response = await PUT(
      putRequest({
        origin: "http://127.0.0.1:8787",
        host: "127.0.0.1:8787",
        url: "http://localhost/api/admin/uploads/ub-1/files/uf-1",
        fetchSite: "same-origin",
      }),
      params(),
    );
    expect(response.status).toBe(200);
    expect(brainFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a request the browser marks as cross-site even with a matching host", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(
      putRequest({ origin: "https://app.example", host: "app.example", fetchSite: "cross-site" }),
      params(),
    );
    expect(response.status).toBe(403);
    expect(brainFetch).not.toHaveBeenCalled();
  });

  it("refuses bad ids, a missing or oversized length and an empty body", async () => {
    const { PUT } = await import("./route");
    expect((await PUT(putRequest(), params("../x", "uf-1"))).status).toBe(404);
    expect((await PUT(putRequest({ length: null }), params())).status).toBe(400);
    expect((await PUT(putRequest({ length: "0" }), params())).status).toBe(400);
    expect((await PUT(putRequest({ length: String(25 * 1024 * 1024 + 1) }), params())).status).toBe(400);
    expect((await PUT(putRequest({ body: null }), params())).status).toBe(400);
    expect(brainFetch).not.toHaveBeenCalled();
  });

  it("answers 503 when Brain is not bound", async () => {
    bound = false;
    const { PUT } = await import("./route");
    expect((await PUT(putRequest(), params())).status).toBe(503);
  });

  it("streams the body to Brain with only the session cookie and the declared length", async () => {
    brainFetch.mockImplementation(async (forwarded: Request) => {
      expect(forwarded.method).toBe("PUT");
      expect(new URL(forwarded.url).pathname).toBe("/admin/uploads/ub-1/files/uf-1");
      expect(forwarded.headers.get("content-length")).toBe("5");
      expect(forwarded.headers.get("cookie")).toBe("usefulbrain.session=abc");
      expect(await forwarded.text()).toBe("hello");
      return Response.json({ ok: true, stage: "parsing" }, { status: 200 });
    });
    const { PUT } = await import("./route");
    const response = await PUT(putRequest({ origin: "https://app.example" }), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, stage: "parsing" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(brainFetch).toHaveBeenCalledTimes(1);
  });

  it("passes Brain's refusal through with its status", async () => {
    brainFetch.mockResolvedValue(Response.json({ code: "FORBIDDEN", message: "no" }, { status: 403 }));
    const { PUT } = await import("./route");
    const response = await PUT(putRequest(), params());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
  });
});
