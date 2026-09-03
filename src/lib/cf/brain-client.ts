import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";

import { AppError } from "@/lib/rag/app-errors";
import {
  createBrainServiceRequest,
  type BrainService,
} from "@/lib/cf/service-binding-identity";

type CloudflareEnv = {
  BRAIN?: BrainService;
};

export async function brainFetch(
  path: string,
  init: { method?: string; json?: unknown } = {},
): Promise<Response> {
  let brain: BrainService | undefined;
  try {
    const { env } = await getCloudflareContext({ async: true });
    brain = (env as CloudflareEnv).BRAIN;
  } catch {
    brain = undefined;
  }
  if (!brain) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Brain is not bound to this web worker.",
      true,
    );
  }
  const incoming = await headers();
  const incomingHeaders = new Headers();
  const assertion = incoming.get("cf-access-jwt-assertion");
  if (assertion) {
    incomingHeaders.set("cf-access-jwt-assertion", assertion);
  }
  const cookie = incoming.get("cookie");
  if (cookie) {
    incomingHeaders.set("cookie", cookie);
  }
  const requestId = incoming.get("x-request-id");
  if (requestId) {
    incomingHeaders.set("x-request-id", requestId);
  }
  const body = init.json === undefined ? null : JSON.stringify(init.json);
  return brain.fetch(
    createBrainServiceRequest({
      incomingHeaders,
      path,
      method: init.method ?? (body ? "POST" : "GET"),
      body,
    }),
  );
}

export async function brainJson<T>(
  path: string,
  init: { method?: string; json?: unknown } = {},
): Promise<T> {
  const response = await brainFetch(path, init);
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? (payload as { code?: string; message?: string }) : {};
    const code = record.code === "RATE_LIMITED"
      ? "RATE_LIMITED"
      : record.code === "CANCELLED"
        ? "CANCELLED"
      : record.code === "VALIDATION_FAILED"
        ? "VALIDATION_FAILED"
        : record.code === "FORBIDDEN"
          ? "FORBIDDEN"
          : record.code === "AUTH_REQUIRED"
            ? "AUTH_REQUIRED"
            : record.code === "UNAVAILABLE"
              ? "PROVIDER_TEMPORARY"
              : "INTERNAL_ERROR";
    throw new AppError(
      code,
      typeof record.message === "string" ? record.message : "The request could not be completed.",
      response.status >= 500 || code === "RATE_LIMITED" || code === "PROVIDER_TEMPORARY",
    );
  }
  return payload as T;
}
