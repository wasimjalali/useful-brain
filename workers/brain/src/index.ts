import { AccessJwtUnavailable, AccessJwtVerifier } from "../../../src/lib/auth/access-jwt";
import { authenticateWorkerRequest } from "../../../src/lib/auth/worker-identity";
import { parseBoundedId } from "../../../src/lib/cf/bounded-id";
import { writeOperationalLog } from "../../../src/lib/cf/operational-log";
import { resolveRequestId, withRequestId } from "../../../src/lib/cf/request-id";
import { assertWorkerStartup } from "../../../src/lib/cf/startup";
import { toPublicWorkerError, workerErrorResponse } from "../../../src/lib/cf/worker-errors";
import {
  LOAD_PRINCIPAL_SQL,
  type PrincipalDirectoryRow,
} from "../../../src/lib/store/principal-directory";
import { ConversationRunLock } from "./conversation-lock";

export { ConversationRunLock };

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
      bind(...values: string[]): { first<T>(): Promise<T | null> };
    };
  };
  CONVERSATION: {
    idFromName(name: string): unknown;
    get(id: unknown): ConversationRunLock;
    getByName(name: string): ConversationRunLock;
  };
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

      if ((path === "/lock" || path === "/unlock") && request.method === "POST") {
        operation = path.slice(1);
        const body = (await request.json()) as { conversationId?: string; runId?: string };
        const conversationId = parseBoundedId(body.conversationId, "conversation id");
        const runId = parseBoundedId(body.runId, "run id");
        const stub = env.CONVERSATION.getByName(conversationId);
        const result = await (path === "/lock" ? stub.acquire(runId) : stub.release(runId));
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
};

export default brainWorker;
