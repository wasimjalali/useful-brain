/**
 * A quote-extraction call (citation repair, identifier recovery, abstention
 * recheck or the coverage pass) that ran out of completion budget before it
 * wrote any content: finish_reason "length" with an empty answer. It is not
 * "no quotes": the model never answered. Callers treat it like a failed
 * call (the draft or refusal stands), never cache it, and count it so the
 * turn can report it.
 */
export class ExtractionTruncatedError extends Error {
  constructor(readonly pass: "repair" | "coverage") {
    super(`${pass} extraction ran out of completion budget before answering`);
    this.name = "ExtractionTruncatedError";
  }
}
