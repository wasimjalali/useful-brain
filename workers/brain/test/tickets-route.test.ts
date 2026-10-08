import {
  createExecutionContext,
  createMessageBatch,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { decideApproval } from "../../../src/lib/store/agent-runs";
import worker from "../src";
import { seedPersonas, type PersonaId } from "./seed";
import { pendingTicketRun, TICKET_ARGS } from "./ticket-helpers";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const sessionEnv = { ...env, IDENTITY_MODE: "session", LOOPBACK_RUNTIME: "false", LOOPBACK_SUBJECT: "" };

async function call(path: string, cookie?: string): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new IncomingRequest(`https://brain.internal${path}`, {
      headers: { ...(cookie ? { cookie } : {}), "x-request-id": "11111111-1111-4111-8111-111111111111" },
    }),
    sessionEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

let cookies: Record<PersonaId, string>;
let ticketId: string;

beforeAll(async () => {
  cookies = await seedPersonas();
  const run = await pendingTicketRun("route", TICKET_ARGS, { principalId: "member-maya" });
  await decideApproval(env.OPERATIONS_DB, {
    runId: run.runId,
    storedBinding: run.binding,
    eventBinding: run.binding,
    decision: "approve",
    now: Date.now(),
  });
  const batch = createMessageBatch("useful-brain-approval-resume-development", [{
    id: "tk-route",
    timestamp: new Date(),
    attempts: 1,
    body: { runId: run.runId, idempotencyKey: run.binding.idempotencyKey },
  }]);
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  await waitOnExecutionContext(ctx);
  const row = await env.OPERATIONS_DB.prepare("SELECT seq FROM tickets WHERE run_id = ?")
    .bind(run.runId)
    .first<{ seq: number }>();
  ticketId = `SUP-${row!.seq}`;
});

describe("GET /tickets/:id", () => {
  it("shows the ticket to the principal who approved it", async () => {
    const response = await call(`/tickets/${ticketId}`, cookies["member-maya"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: ticketId,
      desk: "Support",
      priority: "P1",
      customer: "Acme Logistics",
      subject: "Refund stuck after chargeback",
      createdAt: expect.any(Number),
    });
  });

  it("shows the ticket to an admin", async () => {
    expect((await call(`/tickets/${ticketId}`, cookies["member-jordan"])).status).toBe(200);
  });

  it("answers a byte-identical 404 for another member, unknown and malformed ids", async () => {
    const probes: Array<[string, PersonaId]> = [
      [ticketId, "member-priya"],
      ["SUP-9999999", "member-maya"],
      ["SUP-abc", "member-maya"],
      ["bad%20id!", "member-jordan"],
    ];
    const bodies = new Set<string>();
    for (const [id, persona] of probes) {
      const response = await call(`/tickets/${id}`, cookies[persona]);
      expect(response.status, `${id} as ${persona}`).toBe(404);
      bodies.add(await response.text());
    }
    expect(bodies.size).toBe(1);
  });

  it("needs a session", async () => {
    expect((await call(`/tickets/${ticketId}`)).status).toBe(401);
  });
});
