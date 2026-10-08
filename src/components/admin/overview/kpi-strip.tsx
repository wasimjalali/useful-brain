import type { KpiView } from "@/lib/contracts/admin-insights-view";

const W = 120;
const H = 28;

export function sparklinePoints(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const step = values.length > 1 ? W / (values.length - 1) : 0;
  return values
    .map((v, i) => `${(i * step).toFixed(1)},${(H - 2 - ((v - min) / range) * (H - 4)).toFixed(1)}`)
    .join(" ");
}

export function KpiStrip({ kpis }: { kpis: KpiView[] }) {
  return (
    <div
      aria-label="Key numbers"
      className="grid grid-cols-2 rounded-2xl bg-bubble shadow-[0_0_0_1px_var(--edge),var(--lift)] lg:grid-cols-4"
      role="group"
    >
      {kpis.map((k, i) => (
        <div
          className="flex min-w-0 flex-col gap-1 px-5 pb-4 pt-[18px]"
          key={k.id}
          style={{ boxShadow: i ? "inset 1px 0 0 var(--border)" : "none" }}
        >
          <span className="text-xs font-medium text-ink-faint-text">{k.label}</span>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[28px] font-semibold leading-9 tracking-[-0.02em] text-ink">
              {k.value}
            </span>
            <span className="text-xs text-ink-muted">{k.delta}</span>
          </div>
          <svg
            aria-hidden="true"
            className="mt-1.5 h-7 w-full overflow-visible"
            preserveAspectRatio="none"
            viewBox={`0 0 ${W} ${H}`}
          >
            <polyline
              fill="none"
              points={sparklinePoints(k.points)}
              stroke="var(--ink)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="flex justify-between text-[11px] text-ink-faint-text">
            <span>{k.startLabel}</span>
            <span>{k.endLabel}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
