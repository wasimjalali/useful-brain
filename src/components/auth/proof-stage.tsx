import { CitationChip } from "@/components/ui/citation-chip";
import { Highlight } from "@/components/ui/highlight";

export function ProofStage() {
  return (
    <div
      aria-hidden="true"
      className="m-2.5 ml-0 hidden min-w-0 flex-1 flex-col justify-center rounded-3xl bg-surface px-24 shadow-[0_0_0_1px_var(--edge),var(--stage-shadow)] lg:flex"
    >
      <div className="flex max-w-[620px] flex-col gap-7">
        <p className="text-[15px] leading-6 text-ink">
          You get sixteen weeks of fully paid parental leave per child, at 100% of base salary{" "}
          <CitationChip active n={1} tabIndex={-1} />.
        </p>
        <div className="flex flex-col gap-3 pl-5 shadow-[inset_1px_0_0_var(--border-strong)]">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-medium">Parental Leave Policy</span>
            <span className="text-ink-faint-text">Paid Leave Duration</span>
          </div>
          <p className="text-[20px] leading-[34px] tracking-[-0.01em] text-ink-muted">
            Every eligible parent receives sixteen weeks of fully paid parental leave per child.{" "}
            <Highlight active>
              The sixteen weeks are paid at 100% of base salary and are available to each parent
              individually
            </Highlight>
            : if both parents work at Northwind, both may take the full sixteen weeks.
          </p>
        </div>
      </div>
    </div>
  );
}
