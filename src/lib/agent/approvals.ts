import { parseBoundedId } from "../cf/bounded-id";
import { approvalsMatch, argumentFingerprint, type ApprovalBinding } from "./policy";

export type SideEffect = { key: string; result: unknown };

export class IdempotentExecutor {
  private readonly done = new Map<string, unknown>();

  async run<T>(idempotencyKey: string, effect: () => Promise<T> | T): Promise<T> {
    if (this.done.has(idempotencyKey)) {
      return this.done.get(idempotencyKey) as T;
    }
    const result = await effect();
    this.done.set(idempotencyKey, result);
    return result;
  }

  has(idempotencyKey: string): boolean {
    return this.done.has(idempotencyKey);
  }
}

export function mutatingIdempotencyKey(toolSlug: string, value: string): string {
  const slug = value.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return parseBoundedId(`${toolSlug}-${slug || "item"}`, "idempotency key");
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
    idempotencyKey: parseBoundedId(input.idempotencyKey, "idempotency key"),
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
