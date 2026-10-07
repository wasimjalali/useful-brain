/**
 * Turn progress is host-controlled: a payload carries only a stage enum (or
 * a terminal snapshot) and has no field that could hold model text, tool
 * arguments, evidence text or the question itself. The stage set is a
 * closed union; unknown stages are rejected rather than defaulted.
 */

export const TURN_STAGES = ["searching", "reading", "writing"] as const;

export type TurnStage = (typeof TURN_STAGES)[number];

/**
 * Stage names written by earlier Brain builds. They are accepted so a run
 * that started before a deploy keeps reporting, and map onto "writing".
 */
const LEGACY_STAGE_TO_STAGE: Readonly<Record<string, TurnStage>> = {
  drafting: "writing",
  checking_citations: "writing",
  saving: "writing",
};

/** Inclusive upper bound for a progress count. */
export const TURN_PROGRESS_MAX_COUNT = 100_000;

/**
 * Stored turn failure codes surfaced by the progress endpoint. These are the
 * only error_code values failTurn writes today; the set stays closed so a
 * stored value outside it can never reach the client raw.
 */
export const TURN_FAILURE_CODES = [
  "CANCELLED",
  "RATE_LIMITED",
  "PROVIDER_TEMPORARY",
  "VALIDATION_FAILED",
  "INTERNAL_ERROR",
] as const;

export type TurnFailureCode = (typeof TURN_FAILURE_CODES)[number];

/**
 * Closed progress union. Counts are integers only and no variant has a field
 * that could hold text, so the payload cannot carry model output.
 */
export type TurnProgress =
  | { stage: "searching"; readableDocuments: number }
  | { stage: "reading"; passages: number }
  | { stage: "writing" }
  | { stage: "done" }
  | { stage: "failed"; errorCode: TurnFailureCode };

/** Stages that must carry a count, and the payload field that holds it. */
export const COUNTED_STAGE_FIELD = {
  searching: "readableDocuments",
  reading: "passages",
} as const;

export function isTurnStage(value: unknown): value is TurnStage {
  return (
    typeof value === "string" &&
    (TURN_STAGES as readonly string[]).includes(value)
  );
}

/** Maps a stored or incoming stage name onto the closed set, or null. */
export function normalizeTurnStage(value: unknown): TurnStage | null {
  if (isTurnStage(value)) {
    return value;
  }
  if (typeof value === "string" && Object.hasOwn(LEGACY_STAGE_TO_STAGE, value)) {
    return LEGACY_STAGE_TO_STAGE[value];
  }
  return null;
}

export function isTurnProgressCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= TURN_PROGRESS_MAX_COUNT
  );
}

/**
 * A counted stage requires a valid count; writing carries none. Returns the
 * count to store (null for writing) or undefined when the pair is invalid.
 */
export function turnStageCount(
  stage: TurnStage,
  count: unknown,
): number | null | undefined {
  if (stage === "writing") {
    return count === undefined || count === null ? null : undefined;
  }
  return isTurnProgressCount(count) ? count : undefined;
}

/**
 * Stage writes are monotonic: a run may repeat its current stage (idempotent
 * write) or advance, but never move backwards. Backward movement means the
 * writer is stale and is rejected by the lock.
 */
export function canAdvanceTurnStage(
  from: TurnStage | null | undefined,
  to: TurnStage,
): boolean {
  if (!isTurnStage(to)) {
    return false;
  }
  if (from == null) {
    return true;
  }
  return TURN_STAGES.indexOf(to) >= TURN_STAGES.indexOf(from);
}

/**
 * Return the stored failure code only when it is a known public value; any
 * missing or unrecognized value collapses to INTERNAL_ERROR so no internal
 * detail leaks through the progress payload.
 */
export function turnFailureCode(value: unknown): TurnFailureCode {
  return (TURN_FAILURE_CODES as readonly string[]).includes(value as string)
    ? (value as TurnFailureCode)
    : "INTERNAL_ERROR";
}
