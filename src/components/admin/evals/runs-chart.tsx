import type { EvalRunView } from "@/lib/contracts/admin-insights-view";

const LO = 60;
const HI = 100;
const GRID = [100, 90, 80, 70, 60];
const yPct = (v: number) => 100 - ((Math.min(Math.max(v, LO), HI) - LO) / (HI - LO)) * 100;

export function RunsChart({ runs }: { runs: EvalRunView[] }) {
  const pts = runs.map((r, i) => ({
    ...r,
    x: runs.length > 1 ? (i / (runs.length - 1)) * 100 : 50,
    y: yPct((r.passed / r.total) * 100),
    last: i === runs.length - 1,
  }));
  return (
    <div className="relative mt-1 h-[262px]" role="img" aria-label={`Pass rate across ${runs.length} runs`}>
      {GRID.map((v) => (
        <div
          className="absolute inset-x-0 flex items-center gap-2.5"
          key={v}
          style={{ top: 28 + (yPct(v) / 100) * 180 - 8 }}
        >
          <span className="w-[34px] text-right text-[11px] text-ink-faint-text">{`${v}%`}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      ))}
      <div className="absolute left-11 right-6 top-7 h-[180px]">
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full overflow-visible"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <polyline
            fill="none"
            points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
            stroke="var(--ink)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {pts.map((p) => (
          <div className="absolute size-0" key={p.id} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
            <span
              className="absolute -left-[5px] -top-[5px] box-border size-2.5 rounded-full"
              data-testid="run-dot"
              data-filled={p.last ? "true" : "false"}
              style={{
                background: p.last ? "var(--ink)" : "var(--surface)",
                boxShadow: "0 0 0 2px var(--surface), inset 0 0 0 2px var(--ink)",
              }}
            />
            <span
              className="absolute -left-[60px] -top-[30px] w-[120px] whitespace-nowrap text-center text-[13px] text-ink"
              style={{ fontWeight: p.last ? 600 : 400 }}
            >
              {`${p.passed}/${p.total}`}
            </span>
          </div>
        ))}
      </div>
      <div className="absolute left-11 right-6 top-[222px] h-9">
        {pts.map((p) => (
          <div
            className="absolute -ml-[60px] flex w-[120px] flex-col items-center gap-0.5"
            key={p.id}
            style={{ left: `${p.x}%` }}
          >
            <span className="text-xs font-medium text-ink">{p.name}</span>
            <span className="text-[11px] text-ink-faint-text">{p.date}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
