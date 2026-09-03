import { brainFetch } from "@/lib/cf/brain-client";
import { AppError } from "@/lib/rag/app-errors";
import {
  clearSessionCookie,
  requestIsSecure,
  serializeSessionCookie,
} from "@/lib/auth/session-cookie";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

export async function proxyAuthRequest(path: "/auth/signup" | "/auth/login", request: Request): Promise<Response> {
  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  let response: Response;
  try {
    response = await brainFetch(path, { method: "POST", json: payload });
  } catch (error) {
    const message =
      error instanceof AppError ? error.message : "The request could not be completed.";
    return Response.json({ code: "INTERNAL_ERROR", message }, { status: 503 });
  }
  const data = await readJson(response);
  if (!response.ok) {
    return Response.json(
      {
        code: typeof data.code === "string" ? data.code : "INTERNAL_ERROR",
        message: typeof data.message === "string" ? data.message : "The request could not be completed.",
      },
      { status: response.status },
    );
  }
  const sessionToken = typeof data.sessionToken === "string" ? data.sessionToken : null;
  const out = Response.json(
    { user: data.user ?? null },
    { status: path === "/auth/signup" ? 201 : 200 },
  );
  if (sessionToken) {
    out.headers.append(
      "Set-Cookie",
      serializeSessionCookie(sessionToken, { secure: requestIsSecure(request) }),
    );
  }
  return out;
}

export async function proxyLogoutRequest(request: Request): Promise<Response> {
  try {
    await brainFetch("/auth/logout", { method: "POST", json: {} });
  } catch {
    // Cookie is still cleared so the browser session cannot linger.
  }
  const out = Response.json({ ok: true });
  out.headers.append("Set-Cookie", clearSessionCookie({ secure: requestIsSecure(request) }));
  return out;
}
