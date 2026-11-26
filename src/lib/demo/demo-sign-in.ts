import { readSessionToken, requestIsSecure, serializeSessionCookie } from "../auth/session-cookie";
import { createBrainServiceRequest, type BrainService } from "../cf/service-binding-identity";
import { isDemoMode } from "./demo-mode";

/** In the demo these pages have nothing to show: a visitor is always signed in. */
const SIGN_IN_PAGES = new Set(["/login", "/signup"]);

/**
 * Demo only: a page visit without a session (or to a sign-in page) gets a new
 * demo admin from Brain and comes straight back with its cookie set. Returns
 * null when the request needs nothing.
 */
export async function demoSignInRedirect(
  request: Request,
  env: { DEMO_MODE?: string; BRAIN?: BrainService },
): Promise<Response | null> {
  if (!isDemoMode(env) || request.method !== "GET") {
    return null;
  }
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return null;
  }
  // Only a browser page load signs in; assets and data fetches never do.
  if (!(request.headers.get("accept") ?? "").includes("text/html")) {
    return null;
  }
  const signInPage = SIGN_IN_PAGES.has(url.pathname);
  if (readSessionToken(request.headers) && !signInPage) {
    return null;
  }
  if (!env.BRAIN) {
    throw new Error("Brain is not bound to this web worker");
  }
  const response = await env.BRAIN.fetch(
    createBrainServiceRequest({
      incomingHeaders: new Headers(),
      path: "/auth/demo",
      method: "POST",
      body: "{}",
    }),
  );
  if (!response.ok) {
    throw new Error(`demo sign-in failed with ${response.status}`);
  }
  const { sessionToken } = (await response.json()) as { sessionToken?: unknown };
  if (typeof sessionToken !== "string" || !sessionToken) {
    throw new Error("demo sign-in returned no session");
  }
  const target = signInPage ? new URL("/", url) : url;
  return new Response(null, {
    status: 303,
    headers: {
      location: target.toString(),
      "cache-control": "no-store",
      "set-cookie": serializeSessionCookie(sessionToken, { secure: requestIsSecure(request) }),
    },
  });
}
