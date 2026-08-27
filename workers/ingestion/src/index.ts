import { AccessJwtUnavailable, AccessJwtVerifier } from "../../../src/lib/auth/access-jwt";
import { authenticateWorkerRequest } from "../../../src/lib/auth/worker-identity";
import { writeOperationalLog } from "../../../src/lib/cf/operational-log";
import { resolveRequestId, withRequestId } from "../../../src/lib/cf/request-id";
import { assertWorkerStartup } from "../../../src/lib/cf/startup";
import { workerErrorResponse } from "../../../src/lib/cf/worker-errors";
import {
  IngestQueueMessageError,
  parseIngestQueueMessage,
} from "../../../src/lib/ingest/queue-message";
import { isWorkflowAlreadyExists, workflowInstanceId } from "../../../src/lib/ingest/workflow-id";
import { IngestionWorkflow } from "./workflow";

export { IngestionWorkflow };

export type IngestionEnv = {
  RUNTIME_ENV?: string;
  IDENTITY_MODE?: string;
  RESOURCES_PROVISIONED?: string;
  WRANGLER_ACCESS_DEV?: string;
  LOOPBACK_RUNTIME?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  INGESTION_WORKFLOW?: {
    create(options: { id?: string; params: { jobId: string; idempotencyKey: string } }): Promise<{
      id: string;
    }>;
  };
  CORPUS_DB?: {
    prepare(query: string): {
      bind(...values: Array<string | number | null>): {
        run(): Promise<unknown>;
        first<T>(): Promise<T | null>;
      };
      run(): Promise<unknown>;
    };
  };
};

let accessVerifier: AccessJwtVerifier | undefined;

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
    const started = Date.now();
    const requestId = resolveRequestId(request.headers);
    try {
      const { identityMode } = assertWorkerStartup(env);
      const path = new URL(request.url).pathname;
      const publicHealth = request.method === "GET" && path === "/health";
      if (!publicHealth) {
        await authenticateWorkerRequest({
          identityMode,
          headers: request.headers,
          requirePrincipal: false,
          verifyAccess: (token) => verifyAccess(env, token),
        });
      }
      if (path === "/health") {
        writeOperationalLog({
          requestId,
          operation: "health",
          status: "ok",
          durationMs: Date.now() - started,
        });
        return new Response("ok", { headers: withRequestId(new Headers(), requestId) });
      }
      return new Response("not found", {
        status: 404,
        headers: withRequestId(new Headers(), requestId),
      });
    } catch (error) {
      writeOperationalLog({
        requestId,
        operation: "fetch",
        status: "error",
        durationMs: Date.now() - started,
        errorCode: "INTERNAL_ERROR",
      });
      return workerErrorResponse(error, requestId);
    }
  },
  async queue(
    batch: { messages: { body: unknown; ack(): void; retry(): void }[] },
    env: IngestionEnv,
  ): Promise<void> {
    assertWorkerStartup(env);
    for (const message of batch.messages) {
      try {
        const parsed = parseIngestQueueMessage(message.body);
        if (!env.INGESTION_WORKFLOW) {
          throw new Error("INGESTION_WORKFLOW is not bound");
        }
        try {
          await env.INGESTION_WORKFLOW.create({
            id: workflowInstanceId(parsed.idempotencyKey),
            params: parsed,
          });
        } catch (error) {
          if (!isWorkflowAlreadyExists(error)) {
            throw error;
          }
        }
        message.ack();
      } catch (error) {
        if (error instanceof IngestQueueMessageError) {
          message.ack();
          continue;
        }
        message.retry();
      }
    }
  },
};

export default ingestionWorker;
