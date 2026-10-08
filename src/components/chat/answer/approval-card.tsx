import { CircleCheckIcon, CircleXIcon, LockIcon, TicketIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status";
import type { ApprovalView } from "@/lib/contracts/chat-view";

export function ApprovalCard({
  approval,
  busy = false,
  onApprove,
  onDeny,
  onOpenTicket,
}: {
  approval: ApprovalView;
  busy?: boolean;
  onApprove?: () => void;
  onDeny?: () => void;
  onOpenTicket?: () => void;
}) {
  if (approval.status === "pending") {
    return (
      <section
        aria-label="Approval needed"
        className="max-w-[640px] rounded-2xl bg-bubble shadow-[0_0_0_1px_var(--edge),var(--lift)]"
      >
        <header className="flex items-center gap-2 px-4 pt-3.5">
          <TicketIcon className="size-4 text-ink-muted" />
          <h3 className="m-0 flex-1 text-sm font-semibold text-ink">Needs your approval</h3>
          <span className="text-xs text-ink-muted">Create ticket</span>
        </header>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-4 py-3 font-mono text-[13px] leading-5">
          {approval.args.map(([key, value]) => (
            <div className="contents" key={key}>
              <dt className="text-ink-faint-text">{key}</dt>
              <dd className="m-0 break-words text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <span className="flex flex-1 items-center gap-1.5 text-xs text-ink-faint-text">
            <LockIcon className="size-3.5" />
            Approves these exact arguments only
          </span>
          <Button disabled={busy} onClick={onDeny} size={32} variant="secondary">
            Deny
          </Button>
          <Button disabled={busy} onClick={onApprove} size={32} variant="primary">
            Approve and run
          </Button>
        </footer>
      </section>
    );
  }

  if (approval.status === "done") {
    const created = new Date(approval.createdAt);
    const time = `${String(created.getHours()).padStart(2, "0")}:${String(created.getMinutes()).padStart(2, "0")}`;
    return (
      <section
        aria-label="Ticket created"
        className="flex max-w-[640px] flex-col gap-2.5 rounded-xl bg-bubble px-3.5 py-3 shadow-[0_0_0_1px_var(--edge),var(--lift)]"
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="active">
            <CircleCheckIcon className="size-3.5" />
            Created
          </StatusPill>
          <b className="font-mono text-[13.5px] font-semibold text-ink">{approval.ticketId}</b>
          <span className="rounded-md bg-sunken px-1.5 py-0.5 text-xs font-medium text-ink-muted">
            {approval.priority}
          </span>
          <span className="flex-1" />
          {onOpenTicket ? (
            <Button onClick={onOpenTicket} size={32} variant="ghost">
              Open ticket ↗
            </Button>
          ) : null}
        </div>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1 text-[13px]">
          <dt className="text-ink-faint-text">Customer</dt>
          <dd className="m-0 break-words text-ink">{approval.customer}</dd>
          <dt className="text-ink-faint-text">Subject</dt>
          <dd className="m-0 break-words text-ink">{approval.subject}</dd>
          <dt className="text-ink-faint-text">Created</dt>
          <dd className="m-0 text-ink">{time}</dd>
        </dl>
      </section>
    );
  }

  return (
    <div className="flex max-w-[640px] items-center gap-3 rounded-[14px] bg-sunken px-4 py-3 text-sm text-ink-muted">
      <CircleXIcon className="size-4 shrink-0" />
      {approval.status === "denied"
        ? "Denied. Nothing was run."
        : "This approval expired. Ask again to get a fresh one."}
    </div>
  );
}
