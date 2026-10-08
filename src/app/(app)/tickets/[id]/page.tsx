import { notFound } from "next/navigation";

import { PageBody } from "@/components/shell/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { brainJson } from "@/lib/cf/brain-client";
import { toPublicAppError } from "@/lib/rag/app-errors";

export const dynamic = "force-dynamic";

type TicketView = {
  id: string;
  desk: string;
  priority: string;
  customer: string;
  subject: string;
  createdAt: number;
};

const TICKET_ID = /^SUP-[1-9][0-9]{0,9}$/;

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!TICKET_ID.test(id)) {
    notFound();
  }
  let ticket: TicketView | null = null;
  let error: string | null = null;
  try {
    ticket = await brainJson<TicketView>(`/tickets/${id}`);
  } catch (cause) {
    const failure = toPublicAppError(cause);
    if (failure.code === "NOT_FOUND") {
      notFound();
    }
    error = failure.message;
  }
  const rows: Array<[string, string]> = ticket
    ? [
        ["desk", ticket.desk],
        ["priority", ticket.priority],
        ["customer", ticket.customer],
        ["subject", ticket.subject],
        ["created", new Date(ticket.createdAt).toISOString().replace("T", " ").slice(0, 16) + " UTC"],
      ]
    : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={`Ticket ${id}`} />
      <PageBody>
        {ticket ? (
          <dl className="m-0 grid max-w-[640px] grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[13px] leading-5">
            {rows.map(([key, value]) => (
              <div className="contents" key={key}>
                <dt className="text-ink-faint-text">{key}</dt>
                <dd className="m-0 break-words text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 text-[13px] text-ink-muted" role="alert">
            {error}
          </p>
        )}
      </PageBody>
    </div>
  );
}
