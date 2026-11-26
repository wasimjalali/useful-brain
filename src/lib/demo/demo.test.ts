import { describe, expect, it, vi } from "vitest";

import { normalizeForEvidenceMatch } from "../answer/sentence-match";
import { northwindSeedDocuments } from "../eval/northwind-seed";
import { CURATED_SUGGESTIONS } from "../store/suggestions";
import { assertDemoConfiguration, demoRequestAllowed, isDemoMode } from "./demo-mode";
import { scriptedAnswer } from "./demo-runtime";
import { DEMO_QUESTIONS, matchDemoQuestion } from "./demo-script";
import { demoLandedResponse, demoSignInRedirect } from "./demo-sign-in";

describe("demo script", () => {
  const documents = new Map(northwindSeedDocuments().map((doc) => [doc.documentId, doc]));

  it.each(DEMO_QUESTIONS.map((item) => [item.question, item] as const))(
    "quotes %s verbatim from its own Northwind document",
    (_question, item) => {
      const body = documents.get(item.documentId)?.body;
      expect(body).toBeDefined();
      for (const quote of item.quotes) {
        expect(normalizeForEvidenceMatch(body!)).toContain(normalizeForEvidenceMatch(quote));
      }
    },
  );

  it("uses six of the curated starter questions", () => {
    expect(DEMO_QUESTIONS).toHaveLength(6);
    const curated = new Map(CURATED_SUGGESTIONS.map((item) => [item.text, item.documentId]));
    for (const item of DEMO_QUESTIONS) {
      expect(curated.get(item.question)).toBe(item.documentId);
    }
  });

  it("matches a question regardless of case, spacing and closing punctuation", () => {
    expect(matchDemoQuestion("  how long are SYSTEM logs   kept ")?.documentId).toBe("nw_engineering_log_retention");
    expect(matchDemoQuestion("Can I keep my laptop when I leave Northwind!")?.documentId).toBe(
      "nw_operations_equipment_return",
    );
    expect(matchDemoQuestion("How long are system logs kept for audits?")).toBeNull();
  });
});

describe("scriptedAnswer", () => {
  const quotes = ["Raw logs are kept for 90 days.", "Aggregated logs are kept for 1 year."];

  it("cites each quote with the label of the hit that contains it", () => {
    const hits = [
      { label: "[1]", content: "Intro.\nRaw logs are kept\nfor 90 days. More." },
      { label: "[2]", content: "Aggregated logs are kept for 1 year." },
    ];
    expect(scriptedAnswer(quotes, hits)).toBe(
      "Raw logs are kept for 90 days. [1]\n\nAggregated logs are kept for 1 year. [2]",
    );
  });

  it("returns null when search did not return a quote", () => {
    expect(scriptedAnswer(quotes, [{ label: "[1]", content: "Raw logs are kept for 90 days." }])).toBeNull();
  });
});

describe("demo mode guard", () => {
  it("is on only for the exact value true", () => {
    expect(isDemoMode({ DEMO_MODE: "true" })).toBe(true);
    expect(isDemoMode({ DEMO_MODE: "TRUE" })).toBe(false);
    expect(isDemoMode({})).toBe(false);
  });

  it("refuses a demo with a model binding or without session identity", () => {
    expect(() => assertDemoConfiguration({ DEMO_MODE: "true", IDENTITY_MODE: "session", AI: {} })).toThrow(/Workers AI/);
    expect(() => assertDemoConfiguration({ DEMO_MODE: "true", IDENTITY_MODE: "loopback" })).toThrow(/session/);
    expect(() => assertDemoConfiguration({ DEMO_MODE: "yes", IDENTITY_MODE: "session" })).toThrow(/DEMO_MODE/);
    expect(() => assertDemoConfiguration({ DEMO_MODE: "true", IDENTITY_MODE: "session", VECTORIZE: {} })).toThrow(/Vectorize/);
    expect(() =>
      assertDemoConfiguration({ DEMO_MODE: "true", IDENTITY_MODE: "session", RUNTIME_ENV: "production" }),
    ).toThrow(/production/);
    expect(() => assertDemoConfiguration({ DEMO_MODE: "true", IDENTITY_MODE: "session" })).not.toThrow();
    expect(() => assertDemoConfiguration({ IDENTITY_MODE: "loopback", AI: {} })).not.toThrow();
  });

  it("lets reads and a visitor's own chat writes through, and nothing else", () => {
    expect(demoRequestAllowed("GET", "/admin/people")).toBe(true);
    expect(demoRequestAllowed("POST", "/turns")).toBe(true);
    expect(demoRequestAllowed("DELETE", "/conversations/c-1")).toBe(true);
    expect(demoRequestAllowed("POST", "/messages/m-1/feedback")).toBe(true);
    expect(demoRequestAllowed("POST", "/knowledge/seed")).toBe(false);
    expect(demoRequestAllowed("POST", "/admin/invites")).toBe(false);
    expect(demoRequestAllowed("PATCH", "/admin/people/p-1")).toBe(false);
    expect(demoRequestAllowed("DELETE", "/knowledge/documents/d-1")).toBe(false);
    expect(demoRequestAllowed("POST", "/turns/extra")).toBe(false);
  });
});

describe("demoSignInRedirect", () => {
  const page = (path: string, headers: Record<string, string> = {}) =>
    new Request(`https://brain.usefulbuild.com${path}`, {
      headers: { accept: "text/html", "sec-fetch-mode": "navigate", "cf-connecting-ip": "203.0.113.7", ...headers },
    });

  function brainReturning(status = 201) {
    return {
      fetch: vi.fn(async () =>
        Response.json({ user: { id: "demo-visitor-1" }, sessionToken: "token-1" }, { status }),
      ),
    };
  }
  function limiter(success = true) {
    return { limit: vi.fn(async () => ({ success })) };
  }
  const demoEnv = (brain = brainReturning(), limit = limiter()) => ({
    DEMO_MODE: "true",
    BRAIN: brain,
    DEMO_SIGN_IN_LIMIT: limit,
  });

  it("does nothing outside the demo", async () => {
    const brain = brainReturning();
    expect(await demoSignInRedirect(page("/chat"), { ...demoEnv(brain), DEMO_MODE: "false" })).toBeNull();
    expect(brain.fetch).not.toHaveBeenCalled();
  });

  it("signs a visitor without a session in and sends them back to the page", async () => {
    const limit = limiter();
    const response = await demoSignInRedirect(page("/admin/people?x=1"), demoEnv(brainReturning(), limit));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe(
      `https://brain.usefulbuild.com/api/demo/landed?to=${encodeURIComponent("/admin/people?x=1")}`,
    );
    expect(response?.headers.get("set-cookie")).toContain("usefulbrain.session=token-1");
    expect(response?.headers.get("set-cookie")).toContain("Secure");
    expect(limit.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("replaces the sign-in pages with a fresh visitor and the home page", async () => {
    const response = await demoSignInRedirect(page("/login?fresh=1", { cookie: "usefulbrain.session=old" }), demoEnv());
    expect(response?.headers.get("location")).toBe("https://brain.usefulbuild.com/api/demo/landed?to=%2F");
  });

  it("leaves signed-in visitors, API calls, crawlers and data fetches alone", async () => {
    const brain = brainReturning();
    const env = demoEnv(brain);
    expect(await demoSignInRedirect(page("/chat", { cookie: "usefulbrain.session=abc" }), env)).toBeNull();
    expect(await demoSignInRedirect(page("/api/turns/1"), env)).toBeNull();
    expect(await demoSignInRedirect(new Request("https://brain.usefulbuild.com/chat"), env)).toBeNull();
    // A link preview or crawler asks for HTML but is not a browser navigation.
    expect(
      await demoSignInRedirect(new Request("https://brain.usefulbuild.com/chat", { headers: { accept: "text/html" } }), env),
    ).toBeNull();
    // A client-side (RSC) request to the login page is handled by the page's reload, not here.
    expect(
      await demoSignInRedirect(
        new Request("https://brain.usefulbuild.com/login", { headers: { accept: "text/x-component", "sec-fetch-mode": "cors" } }),
        env,
      ),
    ).toBeNull();
    expect(brain.fetch).not.toHaveBeenCalled();
  });

  it("answers a rate-limited address with a notice and makes no visitor", async () => {
    const brain = brainReturning();
    const response = await demoSignInRedirect(page("/chat"), demoEnv(brain, limiter(false)));
    expect(response?.status).toBe(429);
    expect(await response?.text()).toContain("Too many new demo sessions");
    expect(brain.fetch).not.toHaveBeenCalled();
  });

  it("shows a busy notice when Brain is at its visitor ceiling", async () => {
    const response = await demoSignInRedirect(page("/chat"), demoEnv(brainReturning(503)));
    expect(response?.status).toBe(503);
    expect(await response?.text()).toContain("The demo is busy");
  });

  it("fails loudly when Brain refuses or a binding is missing", async () => {
    await expect(demoSignInRedirect(page("/chat"), demoEnv(brainReturning(500)))).rejects.toThrow(/500/);
    await expect(
      demoSignInRedirect(page("/chat"), { DEMO_MODE: "true", BRAIN: brainReturning() }),
    ).rejects.toThrow(/DEMO_SIGN_IN_LIMIT/);
  });
});

describe("demoLandedResponse", () => {
  const landed = (to: string, cookie?: string) =>
    new Request(`https://brain.usefulbuild.com/api/demo/landed?to=${encodeURIComponent(to)}`, {
      headers: cookie ? { cookie } : {},
    });
  const env = { DEMO_MODE: "true" };

  it("forwards a visitor whose cookie stuck to the page they asked for", () => {
    const response = demoLandedResponse(landed("/chat?c=1", "usefulbrain.session=abc"), env);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://brain.usefulbuild.com/chat?c=1");
  });

  it("shows a cookie notice, not another sign-in, when the cookie was dropped", async () => {
    const response = demoLandedResponse(landed("/chat"), env);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("needs cookies");
  });

  it.each(["//evil.example/x", "/\\evil.example", "/\t/evil.example", "https://evil.example", "/api/demo/landed?to=/x"])(
    "never forwards %s off the site or back into itself",
    (to) => {
      const location = demoLandedResponse(landed(to, "usefulbrain.session=abc"), env).headers.get("location");
      expect(new URL(location!).origin).toBe("https://brain.usefulbuild.com");
      expect(new URL(location!).pathname.startsWith("/api/demo/landed")).toBe(false);
    },
  );

  it("is not found outside the demo", () => {
    expect(demoLandedResponse(landed("/chat", "usefulbrain.session=abc"), {}).status).toBe(404);
  });
});
