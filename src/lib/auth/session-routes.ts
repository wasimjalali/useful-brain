import {
  authenticateAccount,
  createAccount,
  revokeSession,
} from "./session-account";
import { readSessionToken } from "./session-cookie";
import type { IdentityMode } from "./identity-mode";
import type { OperationsDatabase } from "../store/conversations";
import { withRequestId } from "../cf/request-id";
import { workerErrorResponse } from "../cf/worker-errors";

function json(body: unknown, requestId: string, status = 200): Response {
  return Response.json(body, {
    status,
    headers: withRequestId(new Headers(), requestId),
  });
}

export function isPublicAuthPath(method: string, path: string): boolean {
  if (path === "/auth/signup" && method === "POST") {
    return true;
  }
  if (path === "/auth/login" && method === "POST") {
    return true;
  }
  if (path === "/auth/logout" && method === "POST") {
    return true;
  }
  return false;
}

export async function handlePublicAuthRoute(input: {
  request: Request;
  path: string;
  identityMode: IdentityMode;
  db: OperationsDatabase;
  requestId: string;
}): Promise<Response | null> {
  if (!isPublicAuthPath(input.request.method, input.path)) {
    return null;
  }
  if (input.identityMode !== "session" && input.identityMode !== "loopback") {
    return workerErrorResponse(new Error("auth is not enabled"), input.requestId);
  }
  try {
    await input.db.prepare("PRAGMA foreign_keys = ON").run();
    if (input.path === "/auth/logout") {
      await revokeSession(input.db, readSessionToken(input.request.headers));
      return json({ ok: true }, input.requestId);
    }
    let body: { email?: unknown; password?: unknown; name?: unknown };
    try {
      body = (await input.request.json()) as {
        email?: unknown;
        password?: unknown;
        name?: unknown;
      };
    } catch {
      return json(
        { code: "VALIDATION_FAILED", message: "The request is invalid." },
        input.requestId,
        400,
      );
    }
    const result =
      input.path === "/auth/signup"
        ? await createAccount(input.db, {
            email: body.email,
            password: body.password,
            name: body.name,
          })
        : await authenticateAccount(input.db, {
            email: body.email,
            password: body.password,
          });
    return json(
      {
        user: result.user,
        sessionToken: result.sessionToken,
      },
      input.requestId,
      input.path === "/auth/signup" ? 201 : 200,
    );
  } catch (error) {
    return workerErrorResponse(error, input.requestId);
  }
}
