import { CheckIcon, FilePlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { formatSeconds, plural } from "./format";

export function NoEvidence({
  documentsSearched,
  latencyMs,
  requested,
  onRequest,
}: {
  documentsSearched: number;
  latencyMs?: number;
  requested: boolean;
  /** Omitted for an answer Brain did not store: there is nothing to request against. */
  onRequest?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[15px] leading-6 text-ink">
        I couldn&apos;t find this in the documents you can read, so I won&apos;t guess.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {requested ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-sunken px-3 text-[13px] font-medium text-ink-faint-text">
            <CheckIcon className="size-4 text-success" />
            Requested
          </span>
        ) : onRequest ? (
          <Button icon={<FilePlusIcon className="size-4" />} onClick={onRequest} size={32} variant="secondary">
            Request this document
          </Button>
        ) : null}
        <span className="font-mono text-[11px] text-ink-faint-text">
          Searched {plural(documentsSearched, "document", "documents")}
          {latencyMs === undefined ? null : ` · ${formatSeconds(latencyMs)}`}
        </span>
      </div>
      {requested ? (
        <p className="m-0 text-xs text-ink-faint-text">Admins see it under Unanswered questions.</p>
      ) : null}
    </div>
  );
}
