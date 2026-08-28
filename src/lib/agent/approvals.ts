import { parseMutatingIdempotencyKey } from "../cf/bounded-id";
import { sha256Hex } from "../ingest/digests";
import type { OperationsDatabase } from "../store/conversations";
import { approvalsMatch, argumentFingerprint, type ApprovalBinding } from "./policy";

export type SideEffect = { key: string; result: unknown };

type IdempotencyRecord =
  | { status: "in_progress" }
  | { status: "completed"; result: unknown };

export type IdempotencyStore = {
  claim(idempotencyKey: string, now: number): Promise<boolean>;
  load(idempotencyKey: string): Promise<IdempotencyRecord | null>;
  complete(idempotencyKey: string, result: unknown, now: number): Promise<void>;
};

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async claim(idempotencyKey: string): Promise<boolean> {
    if (this.records.has(idempotencyKey)) {
      return false;
    }
    this.records.set(idempotencyKey, { status: "in_progress" });
    return true;
  }

  async load(idempotencyKey: string): Promise<IdempotencyRecord | null> {
    return this.records.get(idempotencyKey) ?? null;
  }

  async complete(idempotencyKey: string, result: unknown): Promise<void> {
    this.records.set(idempotencyKey, { status: "completed", result });
  }
}

export class D1IdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: OperationsDatabase) {}

  async claim(idempotencyKey: string, now: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT INTO idempotent_effects (
           idempotency_key, status, result_json, created_at, updated_at
         ) VALUES (?, 'in_progress', NULL, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .bind(parseMutatingIdempotencyKey(idempotencyKey), now, now)
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async load(idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT status, result_json FROM idempotent_effects WHERE idempotency_key = ?`,
      )
      .bind(parseMutatingIdempotencyKey(idempotencyKey))
      .first<{ status: "in_progress" | "completed"; result_json: string | null }>();
    if (!row) {
      return null;
    }
    if (row.status === "in_progress") {
      return { status: "in_progress" };
    }
    return { status: "completed", result: JSON.parse(row.result_json ?? "null") as unknown };
  }

  async complete(idempotencyKey: string, result: unknown, now: number): Promise<void> {
    const updated = await this.db
      .prepare(
        `UPDATE idempotent_effects
         SET status = 'completed', result_json = ?, updated_at = ?
         WHERE idempotency_key = ? AND status = 'in_progress'`,
      )
      .bind(
        JSON.stringify(result) ?? "null",
        now,
        parseMutatingIdempotencyKey(idempotencyKey),
      )
      .run();
    if ((updated.meta?.changes ?? 0) !== 1) {
      throw new Error("idempotent effect claim was lost");
    }
  }
}

export class IdempotentExecutor {
  constructor(private readonly store: IdempotencyStore) {}

  async run<T>(idempotencyKey: string, effect: () => Promise<T> | T): Promise<T> {
    const existing = await this.store.load(idempotencyKey);
    if (existing?.status === "completed") {
      return existing.result as T;
    }
    if (!(await this.store.claim(idempotencyKey, Date.now()))) {
      const claimed = await this.store.load(idempotencyKey);
      if (claimed?.status === "completed") {
        return claimed.result as T;
      }
      throw new Error("idempotent effect is already in progress or needs reconciliation");
    }
    const result = await effect();
    await this.store.complete(idempotencyKey, result, Date.now());
    return result;
  }

  async has(idempotencyKey: string): Promise<boolean> {
    return (await this.store.load(idempotencyKey))?.status === "completed";
  }
}

export async function mutatingIdempotencyKey(
  toolSlug: string,
  args: unknown,
  attemptScope: string,
): Promise<string> {
  const slug = toolSlug
    .replace(/[^A-Za-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const digest = await sha256Hex(argumentFingerprint([attemptScope, args]));
  return parseMutatingIdempotencyKey(`${slug || "tool"}-${digest.slice(0, 48)}`);
}

export function approvalFromAttempt(input: {
  principalId: string;
  conversationId: string;
  tool: string;
  args: unknown;
  idempotencyKey: string;
  expiresAt: number;
}): ApprovalBinding {
  return {
    principalId: input.principalId,
    conversationId: input.conversationId,
    tool: input.tool,
    argumentFingerprint: argumentFingerprint(input.args),
    idempotencyKey: parseMutatingIdempotencyKey(input.idempotencyKey),
    expiresAt: input.expiresAt,
  };
}

export async function resumeAfterApproval<T>(input: {
  stored: ApprovalBinding;
  incoming: ApprovalBinding;
  now: number;
  effect: () => Promise<T> | T;
}): Promise<{ resumed: true; result: T } | { resumed: false; reason: string }> {
  if (!approvalsMatch(input.stored, input.incoming, input.now)) {
    return { resumed: false, reason: "approval does not match stored binding" };
  }
  const result = await input.effect();
  return { resumed: true, result };
}
