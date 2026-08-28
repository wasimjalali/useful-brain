export const RELEASE_MODES = ["shadow", "canary", "staging_primary"] as const;
export type ReleaseMode = (typeof RELEASE_MODES)[number];

export type ReleasePlan = {
  mode: ReleaseMode;
  liveBackend: "cloudflare";
  syntheticOnly: true;
  canaryPercent: 0 | 10 | 100;
};

export class ReleasePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleasePlanError";
  }
}

export function planRelease(mode: ReleaseMode): ReleasePlan {
  if (mode === "shadow") {
    return { mode, liveBackend: "cloudflare", syntheticOnly: true, canaryPercent: 0 };
  }
  if (mode === "canary") {
    return { mode, liveBackend: "cloudflare", syntheticOnly: true, canaryPercent: 10 };
  }
  return { mode, liveBackend: "cloudflare", syntheticOnly: true, canaryPercent: 100 };
}

export function assertSyntheticRelease(plan: ReleasePlan): void {
  if (plan.syntheticOnly !== true) {
    throw new ReleasePlanError("Release cannot leave synthetic-only traffic");
  }
  if (plan.liveBackend !== "cloudflare") {
    throw new ReleasePlanError("live backend must be Cloudflare");
  }
}

export const GROSS_USAGE_CEILINGS_USD = {
  cloudflare: 25,
  models: 75,
  combined: 100,
} as const;

export function assertWithinGrossCeiling(spent: { cloudflare: number; models: number }): void {
  if (spent.cloudflare > GROSS_USAGE_CEILINGS_USD.cloudflare) {
    throw new ReleasePlanError("Cloudflare gross usage ceiling exceeded");
  }
  if (spent.models > GROSS_USAGE_CEILINGS_USD.models) {
    throw new ReleasePlanError("model gross usage ceiling exceeded");
  }
  if (spent.cloudflare + spent.models > GROSS_USAGE_CEILINGS_USD.combined) {
    throw new ReleasePlanError("combined gross usage ceiling exceeded");
  }
}

export async function measureHealthLoad(input: {
  url: string;
  n: number;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: number; failed: number; statuses: number[]; durationsMs: number[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const statuses: number[] = [];
  const durationsMs: number[] = [];
  for (let i = 0; i < input.n; i += 1) {
    const started = Date.now();
    const response = await fetchImpl(input.url);
    durationsMs.push(Date.now() - started);
    statuses.push(response.status);
  }
  return {
    ok: statuses.filter((status) => status === 200).length,
    failed: statuses.filter((status) => status !== 200).length,
    statuses,
    durationsMs,
  };
}

export const FAIL_CLOSED_INCIDENTS = [
  "missing identity",
  "missing ACL metadata",
  "missing corpus state",
  "invalid citation",
  "uncertain tool permission",
  "revoked connector",
  "partial D1/Vectorize write",
] as const;
