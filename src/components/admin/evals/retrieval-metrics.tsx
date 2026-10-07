import type { RetrievalMetricView } from "@/lib/contracts/admin-insights-view";

export function RetrievalMetrics({ metrics }: { metrics: RetrievalMetricView[] }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-y-5 pt-4">
      {metrics.map((m) => (
        <div className="flex flex-col-reverse gap-0.5" key={m.id}>
          <dt className="text-xs text-ink-muted">{m.label}</dt>
          <dd
            className={`m-0 font-mono text-xl font-medium leading-7 ${
              m.tone === "success" ? "text-success" : "text-ink"
            }`}
          >
            {m.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
