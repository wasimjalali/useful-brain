import type { Model } from "@earendil-works/pi-ai";

import type { IdentityMode } from "../auth/identity-mode";
import { glm53FlashModel } from "./glm-5-3-flash";
import { CHAT_MODEL_ID } from "./selection";

export class EvalModelOverrideForbidden extends Error {
  constructor() {
    super("eval model overrides are accepted only in loopback identity mode");
    this.name = "EvalModelOverrideForbidden";
  }
}

export class EvalModelOverrideInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalModelOverrideInvalid";
  }
}

/**
 * Cloudflare-hosted chat candidates approved for eval-only comparison runs.
 * This list gates the loopback `evalModel` turn field; the locked production
 * selection stays `CHAT_MODEL_ID` in `selection.ts` and is not changed here.
 */
export const EVAL_CHAT_MODELS = [
  CHAT_MODEL_ID,
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/zai-org/glm-5.3",
  "@cf/deepseek-ai/deepseek-v4-pro-0813",
  "@cf/moonshotai/kimi-k2.6",
] as const;

/** Models whose Workers AI schema does not accept `chat_template_kwargs`. */
export const MODELS_WITHOUT_THINKING_TOGGLE: ReadonlySet<string> = new Set([
  "@cf/meta/llama-4-scout-17b-16e-instruct",
]);

/**
 * Parse an optional caller-supplied eval-only chat model. Fails closed the
 * same way as `parseAssumedPrincipal`: any presence outside loopback
 * identity mode is forbidden, and anything but an approved Cloudflare-hosted
 * candidate id is rejected rather than defaulted.
 */
export function parseEvalModelOverride(
  identityMode: IdentityMode,
  raw: unknown,
): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (identityMode !== "loopback") {
    throw new EvalModelOverrideForbidden();
  }
  if (
    typeof raw !== "string" ||
    !(EVAL_CHAT_MODELS as readonly string[]).includes(raw)
  ) {
    throw new EvalModelOverrideInvalid(
      "evalModel must be an approved Cloudflare-hosted chat model",
    );
  }
  return raw;
}

/**
 * The runtime model descriptor for an eval override. Identity fields switch
 * to the candidate; transport and API shape stay those of the locked chat
 * model, which every approved candidate shares (OpenAI-compatible chat
 * completions on Workers AI).
 */
export function evalChatModel(id: string): Model<"openai-completions"> {
  // The HTTP edge validates too; this re-assertion keeps a future caller
  // from routing an unapproved model id into Workers AI.
  if (!(EVAL_CHAT_MODELS as readonly string[]).includes(id)) {
    throw new EvalModelOverrideInvalid(
      "evalModel must be an approved Cloudflare-hosted chat model",
    );
  }
  const base = glm53FlashModel();
  if (id === base.id) {
    return base;
  }
  return { ...base, id, name: id };
}
