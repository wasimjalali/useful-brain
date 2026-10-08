import { CircleCheckIcon, CircleXIcon, ClockIcon, LoaderCircleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status";
import type { ActiveGenerationView, DraftGenerationView } from "@/lib/contracts/admin-manage-view";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-faint-text">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

function Progress({ percent }: { percent: number }) {
  return (
    <>
      <span
        aria-label="Embedding progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="h-1 w-40 shrink-0 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
      >
        <span className="block h-full rounded-full bg-ink" style={{ width: `${percent}%` }} />
      </span>
      <span className="w-9 text-right text-xs text-ink-faint-text">{percent}%</span>
    </>
  );
}

function DraftRow({
  draft,
  busy,
  onPromote,
  onDiscard,
}: {
  draft: DraftGenerationView;
  busy: boolean;
  onPromote: () => void;
  onDiscard: () => void;
}) {
  const id = <span className="font-mono text-xs text-ink-muted">{draft.id}</span>;
  const canPromote = draft.state === "checks_passed" && !busy;
  const promote = (
    <Button
      disabled={!canPromote}
      onClick={onPromote}
      size={32}
      variant={draft.state === "checks_passed" ? "primary" : "secondary"}
    >
      Promote draft
    </Button>
  );
  const discard = (
    <Button disabled={busy} onClick={onDiscard} size={32} variant="ghost">
      Discard
    </Button>
  );

  let lead: React.ReactNode;
  let detail: string;
  let tail: React.ReactNode;

  if (draft.state === "building") {
    const percent =
      draft.totalChunks > 0
        ? Math.min(100, Math.round((draft.embeddedChunks / draft.totalChunks) * 100))
        : 0;
    lead = (
      <>
        <LoaderCircleIcon className="ub-spin size-4 text-ink-muted" />
        <span className="text-[13px] font-medium">Draft</span>
      </>
    );
    detail = `Embedding ${draft.embeddedChunks} of ${draft.totalChunks} chunks · ${draft.documents} documents · ${draft.failed} failed`;
    tail = (
      <>
        <Progress percent={percent} />
        {discard}
        {promote}
      </>
    );
  } else {
    const [icon, title] =
      draft.state === "checks_passed"
        ? [<CircleCheckIcon className="size-4 text-success" key="i" />, "Checks passed"]
        : draft.state === "checks_failed"
          ? [<CircleXIcon className="size-4 text-danger" key="i" />, "Checks failed"]
          : [<ClockIcon className="size-4 text-warning" key="i" />, "Checks paused"];
    lead = (
      <>
        {icon}
        <span className="text-[13px] font-medium">{title}</span>
      </>
    );
    detail = draft.summary;
    tail = (
      <>
        {discard}
        {promote}
      </>
    );
  }

  return (
    <div className="flex items-center gap-3 border-t border-border py-3 pr-4 pl-5">
      {lead}
      {id}
      <span className="min-w-0 truncate text-[13px] text-ink-muted" title={detail}>
        {detail}
      </span>
      <span className="flex-1" />
      {tail}
    </div>
  );
}

export function GenerationCard({
  active,
  draft,
  busy = false,
  onPromote,
  onDiscard,
}: {
  active: ActiveGenerationView;
  draft: DraftGenerationView | null;
  /** True while a promote or discard request is in flight. */
  busy?: boolean;
  onPromote: () => void;
  onDiscard: () => void;
}) {
  return (
    <section
      aria-label="Generations"
      className="rounded-2xl bg-bubble"
      style={{ boxShadow: "0 0 0 1px var(--edge), var(--lift)" }}
    >
      <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] items-center px-5 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-faint-text">Active generation</span>
          <span className="inline-flex items-center gap-2 font-mono text-sm font-medium">
            <StatusDot tone="success" />
            {active.id}
          </span>
        </div>
        <Fact label="Promoted">{active.promotedLabel}</Fact>
        <Fact label="Documents">{active.documents}</Fact>
        <Fact label="Chunks">{active.chunks}</Fact>
        <Fact label="Retrieval">{active.retrieval}</Fact>
      </div>
      {draft ? (
        <DraftRow busy={busy} draft={draft} onDiscard={onDiscard} onPromote={onPromote} />
      ) : null}
    </section>
  );
}
