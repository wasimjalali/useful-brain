import { ArrowRightIcon } from "@/components/icons";
import type { EvalsSummaryView } from "@/lib/contracts/admin-insights-view";

import { SectionHeader } from "./section-header";

export function EvalsSummary({
  summary,
  onOpenEvals,
}: {
  summary: EvalsSummaryView;
  onOpenEvals: () => void;
}) {
  return (
    <section className="flex flex-col">
      <SectionHeader
        right={<span className="text-ink-faint-text">{`Latest run ${summary.latestRunLabel}`}</span>}
        title="Evals"
      />
      <div className="grid grid-cols-2 pb-3 pt-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[22px] font-semibold leading-7 tracking-[-0.02em]">
            {summary.passed}
            <span className="font-medium text-ink-faint-text">{`/${summary.total}`}</span>
          </span>
          <span className="text-xs text-ink-muted">Questions passed</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span
            className={`text-[22px] font-semibold leading-7 tracking-[-0.02em] ${
              summary.aclLeaks === 0 ? "text-success" : "text-danger"
            }`}
          >
            {summary.aclLeaks}
          </span>
          <span className="text-xs text-ink-muted">ACL leaks</span>
        </div>
      </div>
      <button
        className="ub-ring inline-flex w-max items-center gap-1 rounded-md text-xs font-medium text-ink-muted transition-colors duration-[120ms] hover:text-ink"
        onClick={onOpenEvals}
        type="button"
      >
        Open evals
        <ArrowRightIcon className="size-[13px]" />
      </button>
    </section>
  );
}
