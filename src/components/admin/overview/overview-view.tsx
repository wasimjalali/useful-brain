"use client";

import { useRouter } from "next/navigation";

import { uploadHref } from "@/app/(app)/admin/overview/mappers";
import type {
  EvalsSummaryView,
  KpiView,
  SystemRowView,
  UnansweredView,
} from "@/lib/contracts/admin-insights-view";

import { EvalsSummary } from "./evals-summary";
import { KpiStrip } from "./kpi-strip";
import { SystemHealth } from "./system-health";
import { UnansweredList } from "./unanswered-list";

export function OverviewView({
  kpis,
  unanswered,
  system,
  evals,
}: {
  kpis: KpiView[];
  unanswered: UnansweredView[];
  system: SystemRowView[];
  evals: EvalsSummaryView;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-10">
      <KpiStrip kpis={kpis} />
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_380px]">
        <UnansweredList
          items={unanswered}
          onAddDocument={() => router.push(uploadHref())}
        />
        <div className="flex flex-col gap-10">
          <SystemHealth rows={system} />
          <EvalsSummary onOpenEvals={() => router.push("/admin/evals")} summary={evals} />
        </div>
      </div>
    </div>
  );
}
