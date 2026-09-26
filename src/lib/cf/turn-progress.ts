/**
 * Turn progress is host-controlled: a payload carries only a stage enum (or
 * a terminal snapshot) and has no field that could hold model text, tool
 * arguments, evidence text or the question itself. The stage set is a
 * closed union; unknown stages are rejected rather than defaulted.
 */

export const TURN_STAGES = [
  "searching",
  "drafting",
  "checking_citations",
  "saving",
] as const;

export type TurnStage = (typeof TURN_STAGES)[number];

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

export type TurnProgress =
  | { stage: TurnStage }
  | { stage: "done" }
  | { stage: "failed"; errorCode: TurnFailureCode };

export function isTurnStage(value: unknown): value is TurnStage {
  return (
    typeof value === "string" &&
    (TURN_STAGES as readonly string[]).includes(value)
  );
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
