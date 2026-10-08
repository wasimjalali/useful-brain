import type { EvalsPageView } from "@/app/(app)/admin/evals/mappers";

import { CategoryBars } from "./category-bars";
import { EvalsFooter } from "./evals-footer";
import { FailuresList } from "./failures-list";
import { RetrievalMetrics } from "./retrieval-metrics";
import { RunsChart } from "./runs-chart";

const HEADING = "m-0 border-b border-border pb-2.5 text-xs font-medium text-ink-faint-text";

export function EvalsView({ view }: { view: EvalsPageView }) {
  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Pass rate by run">
          <RunsChart runs={view.runs} />
        </section>
        <section aria-label="Latest run by category" className="flex flex-col">
          <h2 className={HEADING}>Latest run by category</h2>
          <CategoryBars categories={view.categories} />
          <RetrievalMetrics metrics={view.metrics} />
        </section>
      </div>
      <section aria-label="Remaining failures">
        <h2 className={HEADING}>{`Remaining failures ${view.failureCount} of ${view.total}`}</h2>
        <FailuresList
          failures={view.failures}
          initiallyOpenId={view.failures.find((f) => f.id === "q093")?.id}
        />
      </section>
      <EvalsFooter />
    </div>
  );
}
