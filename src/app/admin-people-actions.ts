"use server";

import { brainFetch } from "@/lib/cf/brain-client";
import {
  INVITE_REASONS,
  type CreateInviteRequest,
  type CreateInviteResponse,
  type CreateInviteResult,
  type InviteReason,
} from "@/lib/contracts/people";
import { AppError, toPublicAppError } from "@/lib/rag/app-errors";

type BrainErrorBody = { code?: string; message?: string; reason?: string };

export async function createInviteAction(input: CreateInviteRequest): Promise<CreateInviteResult> {
  try {
    const response = await brainFetch("/admin/invites", {
      method: "POST",
      json: { email: input.email, role: input.role, department: input.department },
    });
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) {
      return { ok: true, data: payload as CreateInviteResponse };
    }
    const body: BrainErrorBody = payload && typeof payload === "object" ? payload : {};
    if (response.status === 400 && body.code === "VALIDATION_FAILED") {
      const reason = (INVITE_REASONS as readonly string[]).includes(body.reason ?? "")
        ? (body.reason as InviteReason)
        : undefined;
      return {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "Couldn't create the invite.", retryable: false, reason },
      };
    }
    // Same code mapping as brainJson for every other failure.
    const code =
      body.code === "RATE_LIMITED"
        ? "RATE_LIMITED"
        : body.code === "FORBIDDEN"
          ? "FORBIDDEN"
          : body.code === "AUTH_REQUIRED"
            ? "AUTH_REQUIRED"
            : body.code === "NOT_FOUND"
              ? "NOT_FOUND"
              : "INTERNAL_ERROR";
    throw new AppError(code, typeof body.message === "string" ? body.message : "The request could not be completed.", response.status >= 500 || code === "RATE_LIMITED");
  } catch (error) {
    return {
      ok: false,
      error: toPublicAppError(error, {
        code: "INTERNAL_ERROR",
        message: "Couldn't create the invite.",
        retryable: true,
      }),
    };
  }
}
