"use client";

import { useState, useTransition } from "react";

import {
  loadActivityAction,
  loadActivityTraceAction,
  type ActivityPage,
} from "@/app/admin-insights-actions";
import { emptyMessage } from "@/app/(app)/admin/activity/mappers";
import type {
  ActivityFilterValue,
  ActivityOutcome,
  TraceStepView,
} from "@/lib/contracts/admin-insights-view";

import { ActivityEmpty } from "./activity-empty";
import { ActivityError } from "./activity-error";
import { ActivityFilters } from "./activity-filters";
import { ActivityTable } from "./activity-table";

export function ActivityView({ initial }: { initial: ActivityPage | null }) {
  const [page, setPage] = useState<ActivityPage | null>(initial);
  const [failed, setFailed] = useState(initial === null);
  const [filter, setFilter] = useState<ActivityFilterValue>("all");
  const [traces, setTraces] = useState<Record<string, TraceStepView[] | undefined>>({});
  const [pending, startTransition] = useTransition();

  function fetchPage(outcome: ActivityFilterValue, cursor: string | null) {
    startTransition(async () => {
      const result = await loadActivityAction({ outcome, cursor });
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setFilter(outcome);
      setPage((prev) =>
        cursor && prev
          ? { ...result.data, rows: [...prev.rows, ...result.data.rows] }
          : result.data,
      );
    });
  }

  function loadTrace(id: string) {
    if (traces[id]) return;
    void loadActivityTraceAction(id).then((result) =>
      setTraces((prev) => ({
        ...prev,
        [id]: result.ok
          ? result.data
          : [{ step: "error", detail: "Could not load this trace", duration: "-" }],
      })),
    );
  }

  if (failed || !page) {
    return <ActivityError onRetry={() => fetchPage(filter, null)} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <ActivityFilters
        filters={page.filters}
        onChange={(value) => fetchPage(value, null)}
        value={filter}
      />
      {page.rows.length === 0 && filter !== "all" ? (
        <ActivityEmpty
          message={emptyMessage(filter as ActivityOutcome)}
          onShowAll={() => fetchPage("all", null)}
        />
      ) : (
        <ActivityTable
          hasMore={page.nextCursor !== null}
          loadTrace={loadTrace}
          loadingMore={pending}
          onLoadMore={() => fetchPage(filter, page.nextCursor)}
          rows={page.rows}
          traces={traces}
        />
      )}
    </div>
  );
}
