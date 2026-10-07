"use server";

import { brainJson } from "@/lib/cf/brain-client";
import type { ActivityFilterValue, ActivityRowView, TraceStepView } from "@/lib/contracts/admin-insights-view";
import type { ActivityResponse, ActivityTraceResponse } from "@/lib/contracts/admin-metrics";
import { mapRows, mapFilters, mapTrace } from "@/app/(app)/admin/activity/mappers";
import { actionSuccess, toPublicAppError, type ActionResult } from "@/lib/rag/app-errors";

export type ActivityPage = {
  rows: ActivityRowView[];
  filters: ReturnType<typeof mapFilters>;
  nextCursor: string | null;
};

const FALLBACK = {
  code: "INTERNAL_ERROR",
  message: "The activity could not be loaded.",
  retryable: true,
} as const;

/** One page of activity. Pass the cursor from the previous page to continue. */
export async function loadActivityAction(input: {
  outcome: ActivityFilterValue;
  cursor?: string | null;
}): Promise<ActionResult<ActivityPage>> {
  try {
    const query = new URLSearchParams({ range: "7d" });
    if (input.outcome !== "all") query.set("outcome", input.outcome);
    if (input.cursor) query.set("cursor", input.cursor);
    const response = await brainJson<ActivityResponse>(`/admin/activity?${query.toString()}`);
    return actionSuccess({
      rows: mapRows(response.rows),
      filters: mapFilters(response.total, response.counts),
      nextCursor: response.nextCursor,
    });
  } catch (error) {
    return { ok: false, error: toPublicAppError(error, FALLBACK) };
  }
}

export async function loadActivityTraceAction(
  messageId: string,
): Promise<ActionResult<TraceStepView[]>> {
  try {
    const response = await brainJson<ActivityTraceResponse>(
      `/admin/activity/${encodeURIComponent(messageId)}`,
    );
    return actionSuccess(mapTrace(response.steps));
  } catch (error) {
    return {
      ok: false,
      error: toPublicAppError(error, { ...FALLBACK, message: "The trace could not be loaded." }),
    };
  }
}
