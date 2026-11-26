import { readSessionToken, requestIsSecure, serializeSessionCookie } from "../auth/session-cookie";
import { createBrainServiceRequest, type BrainService } from "../cf/service-binding-identity";
import { isDemoMode } from "./demo-mode";

/** The route the sign-in redirect lands on (src/app/api/demo/landed/route.ts). */
export const DEMO_LANDED_PATH = "/api/demo/landed";

/** In the demo these pages have nothing to show: a visitor is always signed in. */
const SIGN_IN_PAGES = new Set(["/login", "/signup"]);

export type DemoSignInEnv = {
  DEMO_MODE?: string;
  BRAIN?: BrainService;
  DEMO_SIGN_IN_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
};

function notice(status: number, message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Useful Brain demo</title><p style="font:15px/1.5 system-ui,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1rem">${message}</p>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "60" },
    },
  );
}

/**
 * Demo only: a browser page load without a session (or of a sign-in page)
 * gets a new demo admin from Brain and comes straight back with its cookie
 * set. Only real navigations sign in (crawlers and link previews send no
 * `Sec-Fetch-Mode: navigate`), each address is rate-limited, and Brain caps
 * new visitors per hour. Returns null when the request needs nothing.
 */
export async function demoSignInRedirect(request: Request, env: DemoSignInEnv): Promise<Response | null> {
  if (!isDemoMode(env) || request.method !== "GET") {
    return null;
  }
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return null;
  }
  if (
    request.headers.get("sec-fetch-mode") !== "navigate" ||
    !(request.headers.get("accept") ?? "").includes("text/html")
  ) {
    return null;
  }
  const signInPage = SIGN_IN_PAGES.has(url.pathname);
  if (readSessionToken(request.headers) && !signInPage) {
    return null;
  }
  if (!env.BRAIN || !env.DEMO_SIGN_IN_LIMIT) {
    throw new Error("the demo web Worker needs its BRAIN and DEMO_SIGN_IN_LIMIT bindings");
  }
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await env.DEMO_SIGN_IN_LIMIT.limit({ key: address })).success) {
    return notice(429, "Too many new demo sessions from your network. Try again in a minute.");
  }
  const response = await env.BRAIN.fetch(
    createBrainServiceRequest({
      incomingHeaders: new Headers(),
      path: "/auth/demo",
      method: "POST",
      body: "{}",
    }),
  );
  if (response.status === 503) {
    return notice(503, "The demo is busy. Try again in a few minutes.");
  }
  if (!response.ok) {
    throw new Error(`demo sign-in failed with ${response.status}`);
  }
  const { sessionToken } = (await response.json()) as { sessionToken?: unknown };
  if (typeof sessionToken !== "string" || !sessionToken) {
    throw new Error("demo sign-in returned no session");
  }
  // Land on a check first: a browser that drops the cookie gets a notice
  // there instead of coming back here for another visitor.
  const target = signInPage ? "/" : `${url.pathname}${url.search}`;
  const landing = new URL(`${DEMO_LANDED_PATH}?to=${encodeURIComponent(target)}`, url);
  return new Response(null, {
    status: 303,
    headers: {
      location: landing.toString(),
      "cache-control": "no-store",
      "set-cookie": serializeSessionCookie(sessionToken, { secure: requestIsSecure(request) }),
    },
  });
}

/** Only a path on this site is a valid destination: anything that parses to another origin goes home. */
function safeDestination(raw: string | null, base: URL): URL {
  const home = new URL("/", base);
  if (!raw || !raw.startsWith("/")) {
    return home;
  }
  const destination = new URL(raw, base);
  if (destination.origin !== base.origin || destination.pathname.startsWith(DEMO_LANDED_PATH)) {
    return home;
  }
  return destination;
}

/**
 * After the sign-in redirect: with the session cookie, on to the page; without
 * it (cookies blocked), a notice, so no second visitor is made.
 */
export function demoLandedResponse(request: Request, env: { DEMO_MODE?: string }): Response {
  if (!isDemoMode(env)) {
    return new Response("Not found", { status: 404 });
  }
  const url = new URL(request.url);
  if (!readSessionToken(request.headers)) {
    return notice(400, "The demo needs cookies turned on for this site.");
  }
  return new Response(null, {
    status: 303,
    headers: {
      location: safeDestination(url.searchParams.get("to"), url).toString(),
      "cache-control": "no-store",
    },
  });
}
