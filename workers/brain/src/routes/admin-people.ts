import { writeOperationalLog } from "../../../../src/lib/cf/operational-log";
import { withRequestId } from "../../../../src/lib/cf/request-id";
import { WorkerValidationError } from "../../../../src/lib/cf/worker-errors";
import { requireAdmin } from "../../../../src/lib/auth/admin";
import type { DirectoryRecord } from "../../../../src/lib/auth/principal";
import type {
  CreateInviteResponse,
  GroupsResponse,
  PeopleResponse,
} from "../../../../src/lib/contracts/people";
import { activeGenerationId, type SqlExecutor } from "../../../../src/lib/store/corpus-d1";
import type { OperationsDatabase } from "../../../../src/lib/store/conversations";
import { createInvite, InviteRequestError } from "../../../../src/lib/store/invites";
import { countActiveDocuments, listGroups, listPeople } from "../../../../src/lib/store/people";

type PeopleEnv = { CORPUS_DB?: unknown; OPERATIONS_DB: unknown };

function json(body: unknown, requestId: string, status = 200): Response {
  const response = Response.json(body, { status, headers: withRequestId(new Headers(), requestId) });
  response.headers.set("cache-control", "no-store");
  return response;
}

/** People, groups and invites. Admin only; returns null for paths it does not own. */
export async function handleAdminPeopleRoute(input: {
  request: Request;
  path: string;
  env: PeopleEnv;
  principal: DirectoryRecord;
  requestId: string;
  started: number;
}): Promise<Response | null> {
  const { request, path, env, principal, requestId, started } = input;
  const owned =
    (request.method === "GET" && (path === "/admin/people" || path === "/admin/groups")) ||
    (request.method === "POST" && path === "/admin/invites");
  if (!owned) {
    return null;
  }
  requireAdmin(principal);
  const operations = env.OPERATIONS_DB as OperationsDatabase;
  const corpus = env.CORPUS_DB as SqlExecutor | undefined;
  const done = (operation: string) =>
    writeOperationalLog({
      requestId,
      principalKind: principal.kind,
      operation,
      status: "ok",
      durationMs: Date.now() - started,
    });

  if (path === "/admin/invites") {
    let body: { email?: unknown; role?: unknown; department?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new WorkerValidationError();
    }
    if (typeof body !== "object" || body === null) {
      throw new WorkerValidationError();
    }
    try {
      const invite: CreateInviteResponse = await createInvite(operations, {
        email: body.email,
        role: body.role,
        department: body.department,
        createdBy: principal.id,
      });
      done("admin-invite-create");
      return json(invite, requestId, 201);
    } catch (error) {
      if (error instanceof InviteRequestError) {
        return json(
          {
            code: "VALIDATION_FAILED",
            message: error.message,
            retryable: false,
            reason: error.reason,
            requestId,
          },
          requestId,
          400,
        );
      }
      throw error;
    }
  }

  const generationId = corpus ? await activeGenerationId(corpus) : null;
  if (path === "/admin/people") {
    const { people, total } = await listPeople(operations, corpus, generationId);
    const activeDocuments = corpus && generationId ? await countActiveDocuments(corpus, generationId) : 0;
    done("admin-people");
    return json({ people, total, activeDocuments } satisfies PeopleResponse, requestId);
  }
  const groups = await listGroups(operations, corpus, generationId);
  done("admin-groups");
  return json({ groups } satisfies GroupsResponse, requestId);
}
