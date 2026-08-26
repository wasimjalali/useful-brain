import { AccessJwtUnavailable, AccessJwtVerifier } from "../../../src/lib/auth/access-jwt";
import { authenticateWorkerRequest } from "../../../src/lib/auth/worker-identity";
import { resolveRequestId, withRequestId } from "../../../src/lib/cf/request-id";
import { assertWorkerStartup } from "../../../src/lib/cf/startup";
import { workerErrorResponse } from "../../../src/lib/cf/worker-errors";
import { IngestionWorkflow } from "./workflow";

export { IngestionWorkflow };

type IngestionEnv = {
  RUNTIME_ENV?: string;
  IDENTITY_MODE?: string;
  RESOURCES_PROVISIONED?: string;
  WRANGLER_ACCESS_DEV?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};

let accessVerifier: AccessJwtVerifier | undefined;

function clientAddress(request: Request): string | undefined {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? undefined;
}

function verifyAccess(env: IngestionEnv, token: string) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return Promise.reject(new AccessJwtUnavailable("Access is not configured"));
  }
  accessVerifier ??= new AccessJwtVerifier({
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    audience: env.ACCESS_AUD,
  });
  return accessVerifier.verify(token);
}

const ingestionWorker = {
  async fetch(request: Request, env: IngestionEnv): Promise<Response> {
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
          requirePrincipal: false,
          verifyAccess: (token) => verifyAccess(env, token),
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
  async queue(_batch: unknown, env: IngestionEnv): Promise<void> {
    assertWorkerStartup(env);
    throw new Error("ingestion queue consumer is not implemented");
  },
};

export default ingestionWorker;
