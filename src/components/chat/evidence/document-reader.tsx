"use client";

import { ArrowLeftIcon, ExternalLinkIcon, GlobeIcon, XIcon } from "@/components/icons";
import { CitationChip } from "@/components/ui/citation-chip";
import { Highlight } from "@/components/ui/highlight";
import { IconButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReaderDocumentView, ReaderSegmentView } from "@/lib/contracts/chat-view";

import { useCitationBinding } from "./citation-link";
import { useScrollWhenActive } from "./use-scroll-when-active";

function Span({ segment, activeN }: { segment: ReaderSegmentView; activeN: number | null }) {
  const n = segment.citation ?? -1;
  const { active, onHover, onClick } = useCitationBinding(n);
  const ref = useScrollWhenActive<HTMLSpanElement>(segment.citation !== undefined && n === activeN);
  if (segment.citation === undefined) {
    return <>{segment.text}</>;
  }
  const strong = active || n === activeN;
  return (
    <span ref={ref}>
      <CitationChip active={strong} n={segment.display ?? n} onClick={onClick} onHover={onHover} style={{ marginRight: 4 }} />
      <Highlight active={strong}>{segment.text}</Highlight>
    </span>
  );
}

export function DocumentReader({
  doc,
  activeN,
  loading = false,
  unavailable,
  onBack,
  onClose,
  onOpenInLibrary,
}: {
  doc: ReaderDocumentView;
  /** Citation number the reader opened for; its span is strong and scrolled into view. */
  activeN: number | null;
  loading?: boolean;
  /** Quiet message shown instead of the body when the document can't be shown. */
  unavailable?: string;
  /** Omitted when there is no evidence to go back to. */
  onBack?: () => void;
  onClose: () => void;
  onOpenInLibrary: () => void;
}) {
  return (
    <aside
      aria-label="Document"
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface"
    >
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 pl-2.5 pr-3">
        {onBack ? (
          <IconButton aria-label="Back to evidence" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
          </IconButton>
        ) : null}
        <h2
          className={`m-0 min-w-0 flex-1 truncate text-sm font-semibold text-ink ${onBack ? "" : "pl-2.5"}`}
        >
          {doc.title}
        </h2>
        <IconButton aria-label="Open in Library" onClick={onOpenInLibrary}>
          <ExternalLinkIcon className="size-4" />
        </IconButton>
        <IconButton aria-label="Close" onClick={onClose}>
          <XIcon className="size-4" />
        </IconButton>
      </div>
      {unavailable ? null : (
        <dl className="m-0 grid shrink-0 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-5 pb-4 pt-0.5 text-xs leading-4">
          <dt className="text-ink-faint-text">Version</dt>
          <dd className="m-0 text-ink">{doc.version}</dd>
          <dt className="text-ink-faint-text">Effective</dt>
          <dd className="m-0 text-ink">{doc.effective}</dd>
          <dt className="text-ink-faint-text">Readable by</dt>
          <dd className="m-0 inline-flex items-center gap-[5px] text-ink">
            {doc.readableBy.everyone ? <GlobeIcon className="size-[13px]" /> : null}
            {doc.readableBy.label}
          </dd>
          <dt className="text-ink-faint-text">Owner</dt>
          <dd className="m-0 text-ink">{doc.owner}</dd>
        </dl>
      )}
      <div className="mx-5 h-px shrink-0 bg-border" />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-6 pt-5">
        {unavailable ? (
          <p className="m-0 text-[13px] leading-5 text-ink-muted" role="status">
            {unavailable}
          </p>
        ) : loading ? (
          <div aria-busy="true" className="flex flex-col gap-2.5">
            <Skeleton height={10} />
            <Skeleton height={10} width="94%" />
            <Skeleton height={10} width="70%" />
          </div>
        ) : (
          doc.sections.map((section) => (
            <section className="flex flex-col gap-1.5" key={section.heading}>
              <h3 className="m-0 text-[13px] font-semibold leading-5 text-ink">{section.heading}</h3>
              {section.paragraphs.map((segments, index) => (
                <p className="m-0 text-[13px] leading-[22px] text-ink-muted [text-wrap:pretty]" key={index}>
                  {segments.map((segment, i) => (
                    <Span activeN={activeN} key={i} segment={segment} />
                  ))}
                </p>
              ))}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
