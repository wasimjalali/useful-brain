import { brainFetch } from "@/lib/cf/brain-client";
import { requestIsSecure, serializeSessionCookie } from "@/lib/auth/session-cookie";

export const dynamic = "force-dynamic";

const INVALID = "This invite link is no longer valid.";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  let response: Response;
  try {
    response = await brainFetch("/auth/invite/accept", { method: "POST", json: payload });
  } catch {
    return Response.json({ code: "INTERNAL_ERROR", message: "The request could not be completed." }, { status: 503 });
  }
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = {};
  }
  if (!response.ok) {
    return Response.json(
      {
        code: typeof data.code === "string" ? data.code : "INTERNAL_ERROR",
        message: typeof data.message === "string" ? data.message : INVALID,
      },
      { status: response.status },
    );
  }
  const out = Response.json({ user: data.user ?? null }, { status: 201 });
  if (typeof data.sessionToken === "string") {
    out.headers.append(
      "Set-Cookie",
      serializeSessionCookie(data.sessionToken, { secure: requestIsSecure(request) }),
    );
  }
  return out;
}
