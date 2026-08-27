import { DurableObject } from "cloudflare:workers";

import { BoundedIdError, parseBoundedId } from "../../../src/lib/cf/bounded-id";
import {
  serializeConversationEvent,
  type ConversationEvent,
} from "../../../src/lib/cf/conversation-events";
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
      const columns = this.ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(run_lock)")
        .toArray()
        .map((row) => row.name);
      if (!columns.includes("cancelled")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE run_lock ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0",
        );
      }
    });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
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
        `INSERT INTO run_lock (id, run_id, acquired_at, cancelled) VALUES (1, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, acquired_at = excluded.acquired_at, cancelled = 0`,
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

  async cancelled(): Promise<boolean> {
    const row = this.ctx.storage.sql
      .exec<{ cancelled: number }>("SELECT cancelled FROM run_lock WHERE id = 1")
      .toArray()[0];
    return row?.cancelled === 1;
  }

  async cancel(runId: string): Promise<ConversationLockResult> {
    let requested: string;
    try {
      requested = parseBoundedId(runId, "run id");
    } catch (error) {
      if (error instanceof BoundedIdError) {
        return { ok: false, status: 400 };
      }
      throw error;
    }
    const current = this.currentRunId();
    if (!current || current !== requested) {
      return { ok: false, status: 409 };
    }
    this.ctx.storage.sql.exec(
      "UPDATE run_lock SET cancelled = 1 WHERE id = 1 AND run_id = ?",
      requested,
    );
    this.fanOut({ type: "cancelled", runId: requested });
    return { ok: true, runId: requested };
  }

  async broadcast(event: ConversationEvent): Promise<void> {
    this.fanOut(event);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    const url = new URL(request.url);
    const runId = (await request.text()).trim();
    try {
      if (url.pathname === "/lock" && request.method === "POST") {
        return jsonLock(await this.acquire(runId));
      }
      if (url.pathname === "/unlock" && request.method === "POST") {
        return jsonLock(await this.release(runId));
      }
      if (url.pathname === "/cancel" && request.method === "POST") {
        return jsonLock(await this.cancel(runId));
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

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      ws.send(serializeConversationEvent({ type: "error", code: "INVALID_EVENT" }));
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      ws.send(serializeConversationEvent({ type: "error", code: "INVALID_EVENT" }));
      return;
    }
    const record = parsed as { type?: unknown; runId?: unknown };
    if (record.type === "cancel" && typeof record.runId === "string") {
      const result = await this.cancel(record.runId);
      if (!result.ok) {
        ws.send(serializeConversationEvent({ type: "error", code: "CANCEL_FAILED" }));
      }
      return;
    }
    ws.send(serializeConversationEvent({ type: "error", code: "INVALID_EVENT" }));
  }

  async webSocketClose(_ws: WebSocket, _code: number, _reason: string): Promise<void> {
    // Close handshake is completed by the runtime (web_socket_auto_reply_to_close).
  }

  private fanOut(event: ConversationEvent): void {
    const payload = serializeConversationEvent(event);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }
}

function jsonLock(result: ConversationLockResult): Response {
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
