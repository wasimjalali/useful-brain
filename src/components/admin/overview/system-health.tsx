import { StatusDot } from "@/components/ui/status";
import type { SystemRowView } from "@/lib/contracts/admin-insights-view";

import { SectionHeader } from "./section-header";

const DOT = { ok: "success", warning: "warning", error: "danger" } as const;
const TEXT = { ok: "text-ink-muted", warning: "text-warning", error: "text-danger" } as const;

export function SystemHealth({ rows }: { rows: SystemRowView[] }) {
  const warnings = rows.filter((r) => r.status !== "ok").length;
  return (
    <section className="flex flex-col">
      <SectionHeader
        right={warnings ? <span className="text-warning">{`${warnings} ${warnings === 1 ? "warning" : "warnings"}`}</span> : null}
        title="System"
      />
      <ul className="m-0 list-none p-0">
        {rows.map((r) => (
          <li className="flex h-10 items-center gap-2.5 border-b border-border" key={r.id}>
            <StatusDot tone={DOT[r.status]} />
            <span className="flex-1 text-[13px] text-ink">{r.name}</span>
            <span className={`text-xs ${TEXT[r.status]}`}>
              <Detail row={r} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Detail({ row }: { row: SystemRowView }) {
  const synced = row.mono ? /^Synced to (.+)$/.exec(row.detail ?? "") : null;
  if (synced) {
    return (
      <>
        Synced · <span className="font-mono" title={row.title}>{synced[1]}</span>
      </>
    );
  }
  const text = row.detail ?? (row.status === "ok" ? "Healthy" : "");
  return row.mono || row.title ? (
    <span className={row.mono ? "font-mono" : ""} title={row.title}>
      {text}
    </span>
  ) : (
    text
  );
}
