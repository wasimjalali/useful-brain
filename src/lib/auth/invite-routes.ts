import { acceptInvite, InviteInvalidError } from "../store/invites";
import type { OperationsDatabase } from "../store/conversations";
import { withRequestId } from "../cf/request-id";
import { workerErrorResponse } from "../cf/worker-errors";

export const INVITE_ACCEPT_PATH = "/auth/invite/accept";

/** Public: the invite token is the credential. Replay, expiry and unknown share one answer. */
export async function handleInviteAccept(input: {
  request: Request;
  db: OperationsDatabase;
  requestId: string;
}): Promise<Response> {
  try {
    await input.db.prepare("PRAGMA foreign_keys = ON").run();
    let body: { token?: unknown; name?: unknown; password?: unknown };
    try {
      body = (await input.request.json()) as typeof body;
    } catch {
      return Response.json(
        { code: "VALIDATION_FAILED", message: "The request is invalid." },
        { status: 400, headers: withRequestId(new Headers(), input.requestId) },
      );
    }
    const result = await acceptInvite(input.db, body ?? {});
    return Response.json(
      { user: result.user, sessionToken: result.sessionToken },
      { status: 201, headers: withRequestId(new Headers(), input.requestId) },
    );
  } catch (error) {
    if (error instanceof InviteInvalidError) {
      return Response.json(
        { code: "VALIDATION_FAILED", message: error.message, retryable: false },
        { status: 400, headers: withRequestId(new Headers(), input.requestId) },
      );
    }
    return workerErrorResponse(error, input.requestId);
  }
}
