import { DurableObject } from "cloudflare:workers";

import { BoundedIdError, parseBoundedId } from "../../../src/lib/cf/bounded-id";
import { acquireRunLock, releaseRunLock } from "../../../src/lib/cf/run-lock";

export type ConversationLockResult =
  | { ok: true; runId: string }
  | { ok: false; status: 400 | 409 };

const SCHEMA = `CREATE TABLE IF NOT EXISTS run_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  run_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL
)`;

export class ConversationRunLock extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(SCHEMA);
    });
  }

  private currentRunId(): string | undefined {
    const row = this.ctx.storage.sql
      .exec<{ run_id: string }>("SELECT run_id FROM run_lock WHERE id = 1")
      .toArray()[0];
    return row?.run_id;
  }

  async acquire(runId: string): Promise<ConversationLockResult> {
    let requested: string;
    try {
      requested = parseBoundedId(runId, "run id");
    } catch (error) {
      if (error instanceof BoundedIdError) {
        return { ok: false, status: 400 };
      }
      throw error;
    }
    return this.ctx.storage.transactionSync(() => {
      const result = acquireRunLock(this.currentRunId(), requested);
      if (!result.ok) {
        return result;
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO run_lock (id, run_id, acquired_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, acquired_at = excluded.acquired_at`,
        result.runId,
        Date.now(),
      );
      return result;
    });
  }

  async release(runId: string): Promise<ConversationLockResult> {
    let requested: string;
    try {
      requested = parseBoundedId(runId, "run id");
    } catch (error) {
      if (error instanceof BoundedIdError) {
        return { ok: false, status: 400 };
      }
      throw error;
    }
    return this.ctx.storage.transactionSync(() => {
      const result = releaseRunLock(this.currentRunId(), requested);
      if (!result.ok) {
        return { ok: false, status: 409 };
      }
      this.ctx.storage.sql.exec("DELETE FROM run_lock WHERE id = 1");
      return { ok: true, runId: requested };
    });
  }

  async status(): Promise<{ runId: string | null }> {
    return { runId: this.currentRunId() ?? null };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const runId = (await request.text()).trim();
    try {
      if (url.pathname === "/lock" && request.method === "POST") {
        return jsonLock(await this.acquire(runId));
      }
      if (url.pathname === "/unlock" && request.method === "POST") {
        return jsonLock(await this.release(runId));
      }
      if (url.pathname === "/status" && request.method === "GET") {
        return Response.json(await this.status());
      }
      return new Response("not found", { status: 404 });
    } catch (error) {
      if (error instanceof BoundedIdError) {
        return Response.json({ ok: false, status: 400 }, { status: 400 });
      }
      throw error;
    }
  }
}

function jsonLock(result: ConversationLockResult): Response {
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
