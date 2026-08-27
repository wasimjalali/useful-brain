import { parseBoundedId } from "../cf/bounded-id";

export function workflowInstanceId(idempotencyKey: string): string {
  return parseBoundedId(idempotencyKey, "idempotency key");
}

export function isWorkflowAlreadyExists(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|already running|unique/i.test(message);
}
