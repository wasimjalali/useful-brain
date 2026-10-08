import { isAdminPrincipal } from "../../../../src/lib/auth/admin";
import type { DirectoryRecord } from "../../../../src/lib/auth/principal";
import { writeOperationalLog } from "../../../../src/lib/cf/operational-log";
import { withRequestId } from "../../../../src/lib/cf/request-id";
import { WorkerNotFoundError } from "../../../../src/lib/cf/worker-errors";
import type { OperationsDatabase } from "../../../../src/lib/store/conversations";
import { loadTicketById } from "../../../../src/lib/store/tickets";

/**
 * GET /tickets/:id. Only the principal who approved the ticket or an admin may
 * read it. Unknown, malformed and unreadable ids are the same 404.
 */
export async function handleTicketRoute(input: {
  request: Request;
  path: string;
  env: { OPERATIONS_DB: unknown };
  principal: DirectoryRecord;
  requestId: string;
  started: number;
}): Promise<Response | null> {
  const { request, path, env, principal, requestId, started } = input;
  const match = path.match(/^\/tickets\/([^/]+)$/);
  if (request.method !== "GET" || !match) {
    return null;
  }
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    throw new WorkerNotFoundError();
  }
  const ticket = await loadTicketById(env.OPERATIONS_DB as OperationsDatabase, id);
  if (!ticket || (ticket.principalId !== principal.id && !isAdminPrincipal(principal))) {
    throw new WorkerNotFoundError();
  }
  writeOperationalLog({
    requestId,
    principalKind: principal.kind,
    operation: "ticket",
    status: "ok",
    durationMs: Date.now() - started,
  });
  const response = Response.json(
    {
      id: ticket.id,
      desk: ticket.desk,
      priority: ticket.priority,
      customer: ticket.customer,
      subject: ticket.subject,
      createdAt: ticket.createdAt,
    },
    { headers: withRequestId(new Headers(), requestId) },
  );
  response.headers.set("cache-control", "no-store");
  return response;
}
