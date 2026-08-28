import { AccessJwtUnavailable, AccessJwtVerifier } from "../../../src/lib/auth/access-jwt";
import { authenticateWorkerRequest } from "../../../src/lib/auth/worker-identity";
import { parseBoundedId } from "../../../src/lib/cf/bounded-id";
import { writeOperationalLog } from "../../../src/lib/cf/operational-log";
import { resolveRequestId, withRequestId } from "../../../src/lib/cf/request-id";
import { assertWorkerStartup } from "../../../src/lib/cf/startup";
import { toPublicWorkerError, WorkerForbiddenError, WorkerValidationError, workerErrorResponse } from "../../../src/lib/cf/worker-errors";
import { isWorkflowAlreadyExists, workflowInstanceId } from "../../../src/lib/ingest/workflow-id";
import {
  clientApprovalMatchesServer,
  loadAgentReplay,
  serverOwnedApprovalBinding,
  upsertApproval,
} from "../../../src/lib/store/agent-runs";
import { assertConversationOwner, ConversationStoreError, type OperationsDatabase } from "../../../src/lib/store/conversations";
import {
  LOAD_PRINCIPAL_SQL,
  type PrincipalDirectoryRow,
} from "../../../src/lib/store/principal-directory";
import type { ApprovalBinding } from "../../../src/lib/agent/policy";
import { ConversationRunLock } from "./conversation-lock";
import { ApprovalWorkflow } from "./approval-workflow";
import {
  enqueueRecoverableApprovalResumes,
  parseApprovalResumeMessage,
  resumeApprovedAgentRun,
} from "./approval-resume";

export { ConversationRunLock, ApprovalWorkflow };

export type BrainEnv = {
  RUNTIME_ENV?: string;
  IDENTITY_MODE?: string;
  RESOURCES_PROVISIONED?: string;
  WRANGLER_ACCESS_DEV?: string;
  LOOPBACK_RUNTIME?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  LOOPBACK_SUBJECT?: string;
  OPERATIONS_DB: {
    prepare(query: string): {
      bind(...values: unknown[]): {
        first<T>(): Promise<T | null>;
        run(): Promise<{ meta?: { changes?: number } }>;
        all<T>(): Promise<{ results: T[] }>;
      };
    };
    batch(statements: unknown[]): Promise<unknown>;
  };
  CONVERSATION: {
    idFromName(name: string): unknown;
    get(id: unknown): ConversationRunLock;
    getByName(name: string): ConversationRunLock;
  };
  APPROVAL_WORKFLOW?: {
    create(options: {
      id?: string;
      params: { runId: string; binding: ApprovalBinding };
    }): Promise<{ id: string }>;
    get(id: string): Promise<{
      sendEvent(event: { type: string; payload: unknown }): Promise<void>;
    }>;
  };
  APPROVAL_RESUME_QUEUE?: Queue<{ runId: string; idempotencyKey: string }>;
};

let accessVerifier: AccessJwtVerifier | undefined;

function parseJsonList(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  return JSON.parse(value) as string[];
}

async function loadDirectory(
  env: BrainEnv,
  subject: string,
  kind: "user" | "service_token",
) {
  const row = await env.OPERATIONS_DB.prepare(LOAD_PRINCIPAL_SQL)
    .bind(subject, kind)
    .first<PrincipalDirectoryRow>();
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    subject: row.subject,
    kind: row.kind,
    roles: parseJsonList(row.roles),
    departments: parseJsonList(row.departments),
  };
}

function verifyAccess(env: BrainEnv, token: string) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return Promise.reject(new AccessJwtUnavailable("Access is not configured"));
  }
  accessVerifier ??= new AccessJwtVerifier({
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    audience: env.ACCESS_AUD,
  });
  return accessVerifier.verify(token);
}

function json(body: unknown, requestId: string, status = 200): Response {
  return Response.json(body, {
    status,
    headers: withRequestId(new Headers(), requestId),
  });
}

async function requireConversationOwner(
  env: BrainEnv,
  conversationId: string,
  principalId: string,
): Promise<void> {
  try {
    await assertConversationOwner(
      env.OPERATIONS_DB as OperationsDatabase,
      conversationId,
      principalId,
    );
  } catch (error) {
    if (error instanceof ConversationStoreError && error.message === "FORBIDDEN") {
      throw new WorkerForbiddenError();
    }
    throw error;
  }
}

const brainWorker = {
  async fetch(request: Request, env: BrainEnv, _ctx?: unknown): Promise<Response> {
    const started = Date.now();
    const requestId = resolveRequestId(request.headers);
    let operation = "fetch";
    try {
      const { identityMode } = assertWorkerStartup(env);
      const path = new URL(request.url).pathname;
      const publicHealth = request.method === "GET" && path === "/health";
      if (publicHealth) {
        operation = "health";
        writeOperationalLog({
          requestId,
          operation,
          status: "ok",
          durationMs: Date.now() - started,
        });
        return new Response("ok", { headers: withRequestId(new Headers(), requestId) });
      }

      const principal = await authenticateWorkerRequest({
        identityMode,
        headers: request.headers,
        loopbackSubject: env.LOOPBACK_SUBJECT,
        requirePrincipal: true,
        verifyAccess: (token) => verifyAccess(env, token),
        loadDirectory: (subject, kind) => loadDirectory(env, subject, kind),
      });
      if (!principal) {
        throw new AccessJwtUnavailable("Access is not configured");
      }

      if (path === "/whoami") {
        operation = "whoami";
        writeOperationalLog({
          requestId,
          principalKind: principal.kind,
          operation,
          status: "ok",
          durationMs: Date.now() - started,
        });
        return json(
          {
            id: principal.id,
            kind: principal.kind,
            roles: principal.roles,
            departments: principal.departments,
          },
          requestId,
        );
      }

      if (path === "/stream") {
        operation = "stream";
        if (request.headers.get("Upgrade") !== "websocket") {
          throw new WorkerValidationError();
        }
        const conversationId = parseBoundedId(
          new URL(request.url).searchParams.get("conversationId"),
          "conversation id",
        );
        await requireConversationOwner(env, conversationId, principal.id);
        return env.CONVERSATION.getByName(conversationId).fetch(request);
      }

      if (path === "/approvals/start" && request.method === "POST") {
        operation = "approval-start";
        if (!env.APPROVAL_WORKFLOW) {
          throw new WorkerValidationError();
        }
        let body: { runId?: string; binding?: ApprovalBinding };
        try {
          body = (await request.json()) as { runId?: string; binding?: ApprovalBinding };
        } catch {
          throw new WorkerValidationError();
        }
        const runId = parseBoundedId(body.runId, "run id");
        const run = await loadAgentReplay(env.OPERATIONS_DB as OperationsDatabase, runId);
        if (!run || run.principalId !== principal.id) {
          throw new WorkerForbiddenError();
        }
        await requireConversationOwner(env, run.conversationId, principal.id);
        const now = Date.now();
        let proposedBinding: ApprovalBinding;
        try {
          proposedBinding = await serverOwnedApprovalBinding(run, now);
        } catch {
          throw new WorkerValidationError();
        }
        if (!clientApprovalMatchesServer(body.binding, proposedBinding)) {
          throw new WorkerValidationError();
        }
        let serverBinding: ApprovalBinding;
        try {
          serverBinding = await upsertApproval(
            env.OPERATIONS_DB as OperationsDatabase,
            runId,
            proposedBinding,
            "pending",
            now,
          );
        } catch {
          throw new WorkerValidationError();
        }
        const workflowId = workflowInstanceId(serverBinding.idempotencyKey);
        try {
          await env.APPROVAL_WORKFLOW.create({
            id: workflowId,
            params: { runId, binding: serverBinding },
          });
        } catch (error) {
          if (!isWorkflowAlreadyExists(error)) {
            throw error;
          }
        }
        writeOperationalLog({
          requestId,
          principalKind: principal.kind,
          operation,
          status: "ok",
          durationMs: Date.now() - started,
        });
        return json({ pendingApproval: true, workflowId, binding: serverBinding }, requestId, 202);
      }

      if (path === "/approvals/event" && request.method === "POST") {
        operation = "approval-event";
        if (!env.APPROVAL_WORKFLOW) {
          throw new WorkerValidationError();
        }
        let body: { workflowId?: string; decision?: string; binding?: ApprovalBinding };
        try {
          body = (await request.json()) as {
            workflowId?: string;
            decision?: string;
            binding?: ApprovalBinding;
          };
        } catch {
          throw new WorkerValidationError();
        }
        const workflowId = parseBoundedId(body.workflowId, "workflow id");
        if ((body.decision !== "approve" && body.decision !== "reject") || !body.binding) {
          throw new WorkerValidationError();
        }
        if (
          body.binding.principalId !== principal.id ||
          workflowId !== workflowInstanceId(body.binding.idempotencyKey)
        ) {
          throw new WorkerForbiddenError();
        }
        await requireConversationOwner(env, body.binding.conversationId, principal.id);
        const instance = await env.APPROVAL_WORKFLOW.get(workflowId);
        await instance.sendEvent({
          type: "approval",
          payload: { decision: body.decision, binding: body.binding },
        });
        writeOperationalLog({
          requestId,
          principalKind: principal.kind,
          operation,
          status: "ok",
          durationMs: Date.now() - started,
        });
        return json({ ok: true, workflowId }, requestId);
      }

      if ((path === "/lock" || path === "/unlock" || path === "/cancel") && request.method === "POST") {
        operation = path.slice(1);
        let body: { conversationId?: string; runId?: string };
        try {
          body = (await request.json()) as { conversationId?: string; runId?: string };
        } catch {
          throw new WorkerValidationError();
        }
        const conversationId = parseBoundedId(body.conversationId, "conversation id");
        const runId = parseBoundedId(body.runId, "run id");
        await requireConversationOwner(env, conversationId, principal.id);
        const stub = env.CONVERSATION.getByName(conversationId);
        const result = await (path === "/lock"
          ? stub.acquire(runId)
          : path === "/cancel"
            ? stub.cancel(runId)
            : stub.release(runId));
        writeOperationalLog({
          requestId,
          principalKind: principal.kind,
          operation,
          status: result.ok ? "ok" : "error",
          durationMs: Date.now() - started,
          errorCode: result.ok ? undefined : "VALIDATION_FAILED",
        });
        return json(result, requestId, result.ok ? 200 : result.status);
      }

      return new Response("not found", {
        status: 404,
        headers: withRequestId(new Headers(), requestId),
      });
    } catch (error) {
      const publicError = toPublicWorkerError(error, requestId);
      writeOperationalLog({
        requestId,
        operation,
        status: "error",
        durationMs: Date.now() - started,
        errorCode: publicError.code,
      });
      return workerErrorResponse(error, requestId);
    }
  },
  async queue(
    batch: { messages: { body: unknown; ack(): void; retry(): void }[] },
    env: BrainEnv,
  ): Promise<void> {
    assertWorkerStartup(env);
    for (const message of batch.messages) {
      try {
        const payload = parseApprovalResumeMessage(message.body);
        await resumeApprovedAgentRun(
          env.OPERATIONS_DB as OperationsDatabase,
          payload,
        );
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
  async scheduled(_controller: unknown, env: BrainEnv): Promise<void> {
    assertWorkerStartup(env);
    if (!env.APPROVAL_RESUME_QUEUE) {
      return;
    }
    await enqueueRecoverableApprovalResumes(
      env.OPERATIONS_DB as OperationsDatabase,
      env.APPROVAL_RESUME_QUEUE,
    );
  },
};

export default brainWorker;
