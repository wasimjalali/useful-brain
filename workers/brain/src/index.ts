import { AccessJwtUnavailable, AccessJwtVerifier } from "../../../src/lib/auth/access-jwt";
import { authenticateWorkerRequest } from "../../../src/lib/auth/worker-identity";
import { resolveRequestId, withRequestId } from "../../../src/lib/cf/request-id";
import { assertWorkerStartup } from "../../../src/lib/cf/startup";
import { workerErrorResponse } from "../../../src/lib/cf/worker-errors";
import { ConversationRunLock } from "./conversation-lock";

export { ConversationRunLock };

type BrainEnv = {
  RUNTIME_ENV?: string;
  IDENTITY_MODE?: string;
  RESOURCES_PROVISIONED?: string;
  WRANGLER_ACCESS_DEV?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  LOOPBACK_SUBJECT?: string;
  OPERATIONS_DB: {
    prepare(query: string): {
      bind(...values: string[]): { first<T>(): Promise<T | null> };
    };
  };
};

let accessVerifier: AccessJwtVerifier | undefined;

function clientAddress(request: Request): string | undefined {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? undefined;
}

async function loadDirectory(
  env: BrainEnv,
  subject: string,
  kind: "user" | "service_token",
) {
  const row = await env.OPERATIONS_DB.prepare(
    `SELECT p.subject AS subject, p.kind AS kind,
            COALESCE((
              SELECT json_group_array(role) FROM roles WHERE user_id = p.user_id
            ), '[]') AS roles,
            COALESCE((
              SELECT json_group_array(department) FROM departments WHERE user_id = p.user_id
            ), '[]') AS departments
     FROM principals p
     WHERE p.subject = ? AND p.kind = ?`,
  )
    .bind(subject, kind)
    .first<{ subject: string; kind: "user" | "service_token"; roles: string; departments: string }>();
  if (!row) {
    return null;
  }
  return {
    subject: row.subject,
    kind: row.kind,
    roles: JSON.parse(row.roles) as string[],
    departments: JSON.parse(row.departments) as string[],
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

const brainWorker = {
  async fetch(request: Request, env: BrainEnv): Promise<Response> {
    const requestId = resolveRequestId(request.headers);
    try {
      const { identityMode } = assertWorkerStartup(env);
      const path = new URL(request.url).pathname;
      const publicHealth = request.method === "GET" && path === "/health";
      if (!publicHealth) {
        await authenticateWorkerRequest({
          identityMode,
          headers: request.headers,
          clientAddress: clientAddress(request),
          loopbackSubject: env.LOOPBACK_SUBJECT,
          requirePrincipal: true,
          verifyAccess: (token) => verifyAccess(env, token),
          loadDirectory: (subject, kind) => loadDirectory(env, subject, kind),
        });
      }

      if (path === "/health") {
        return new Response("ok", { headers: withRequestId(new Headers(), requestId) });
      }

      return new Response("not found", {
        status: 404,
        headers: withRequestId(new Headers(), requestId),
      });
    } catch (error) {
      return workerErrorResponse(error, requestId);
    }
  },
};

export default brainWorker;
