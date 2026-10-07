import { redactJsonSecrets } from "../agent/redact-tool-result";
import { parseBoundedId } from "../cf/bounded-id";
import {
  TURN_STEP_NAMES,
  type TurnStep,
  type TurnStepDetail,
  type TurnStepName,
} from "../contracts/admin-metrics";
import type { OperationsDatabase } from "./conversations";

const MAX_STEPS = 20;
const MAX_KEYS = 12;
const KEY_PATTERN = /^[a-z][A-Za-z0-9_]{0,31}$/;
/** Ids, model names and short codes. No whitespace, so a sentence of evidence cannot fit. */
const TEXT_VALUE_PATTERN = /^[A-Za-z0-9@:._/-]{1,64}$/;

export type TurnStepInput = {
  step: TurnStepName;
  detail: TurnStepDetail;
  durationMs?: number | null;
};

function validDetail(detail: TurnStepDetail): TurnStepDetail {
  const entries = Object.entries(detail);
  if (entries.length > MAX_KEYS) {
    throw new Error("turn step detail has too many fields");
  }
  for (const [key, value] of entries) {
    if (!KEY_PATTERN.test(key)) {
      throw new Error("turn step detail key is invalid");
    }
    if (value === null || typeof value === "boolean") {
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      continue;
    }
    if (typeof value === "string" && TEXT_VALUE_PATTERN.test(value)) {
      continue;
    }
    throw new Error("turn step detail may hold only ids, counts, scores and model names");
  }
  return redactJsonSecrets(detail) as TurnStepDetail;
}

/**
 * Persist the redacted trace of one assistant message. Idempotent: a repeat of the
 * same (message, position) changes nothing. Positions are 1-based, in array order.
 */
export async function recordTurnSteps(
  db: OperationsDatabase,
  messageId: string,
  steps: TurnStepInput[],
): Promise<void> {
  const id = parseBoundedId(messageId, "message id");
  if (steps.length === 0) {
    return;
  }
  if (steps.length > MAX_STEPS) {
    throw new Error("turn trace has too many steps");
  }
  const prepared = steps.map((item, index) => {
    if (!(TURN_STEP_NAMES as readonly string[]).includes(item.step)) {
      throw new Error("turn step name is not allowed");
    }
    const duration = item.durationMs ?? null;
    if (duration !== null && (!Number.isInteger(duration) || duration < 0)) {
      throw new Error("turn step duration is invalid");
    }
    return db
      .prepare(
        `INSERT INTO turn_steps (message_id, seq, step, detail_json, duration_ms)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(message_id, seq) DO NOTHING`,
      )
      .bind(id, index + 1, item.step, JSON.stringify(validDetail(item.detail)), duration);
  });
  await db.batch(prepared);
}

type StepRow = { seq: number; step: TurnStepName; detail_json: string; duration_ms: number | null };

export async function loadTurnSteps(db: OperationsDatabase, messageId: string): Promise<TurnStep[]> {
  const { results } = await db
    .prepare(
      `SELECT seq, step, detail_json, duration_ms FROM turn_steps WHERE message_id = ? ORDER BY seq ASC`,
    )
    .bind(messageId)
    .all<StepRow>();
  return results.map((row) => ({
    seq: row.seq,
    step: row.step,
    detail: JSON.parse(row.detail_json) as TurnStepDetail,
    durationMs: row.duration_ms,
  }));
}
