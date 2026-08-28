export class BoundedIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundedIdError";
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MUTATING_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$/;

export function parseBoundedId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new BoundedIdError(`${label} is required`);
  }
  const trimmed = value.trim();
  if (!ID_PATTERN.test(trimmed)) {
    throw new BoundedIdError(`${label} is invalid`);
  }
  return trimmed;
}

export function parseMutatingIdempotencyKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new BoundedIdError("idempotency key is required");
  }
  const trimmed = value.trim();
  if (!MUTATING_IDEMPOTENCY_KEY_PATTERN.test(trimmed)) {
    throw new BoundedIdError("idempotency key is invalid");
  }
  return trimmed;
}
