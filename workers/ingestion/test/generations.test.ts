import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  activeGenerationId,
  ensureDraftGeneration,
  promoteGeneration,
  rollbackGeneration,
  setGenerationState,
} from "../../../src/lib/store/corpus-d1";

describe("corpus generation pointer", () => {
  it("promotes, rolls back, and leaves the active pointer unchanged when a draft fails", async () => {
    await env.CORPUS_DB.prepare("PRAGMA foreign_keys = ON").run();
    await ensureDraftGeneration(env.CORPUS_DB, "gen-active", 1);
    await setGenerationState(env.CORPUS_DB, "gen-active", "ready", 2);
    await promoteGeneration(env.CORPUS_DB, "gen-active");
    expect(await activeGenerationId(env.CORPUS_DB)).toBe("gen-active");

    await ensureDraftGeneration(env.CORPUS_DB, "gen-fail", 3);
    await setGenerationState(env.CORPUS_DB, "gen-fail", "failed", 4);
    expect(await activeGenerationId(env.CORPUS_DB)).toBe("gen-active");

    await ensureDraftGeneration(env.CORPUS_DB, "gen-next", 5);
    await setGenerationState(env.CORPUS_DB, "gen-next", "ready", 6);
    await promoteGeneration(env.CORPUS_DB, "gen-next");
    expect(await activeGenerationId(env.CORPUS_DB)).toBe("gen-next");
    await rollbackGeneration(env.CORPUS_DB, "gen-active");
    expect(await activeGenerationId(env.CORPUS_DB)).toBe("gen-active");
  });
});
