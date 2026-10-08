"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { InlineAlert } from "@/components/ui/inline-alert";
import type { SourceFilter } from "@/lib/contracts/admin-manage-view";
import type { DraftActionResponse, ReindexResponse, SourcesResponse } from "@/lib/contracts/sources";
import type { ActionResult } from "@/lib/rag/app-errors";

import { ConfirmDialog } from "./confirm-dialog";
import { filterRows, mapSources } from "./sources-mappers";
import { SourcesView } from "./sources-view";
import { UploadFlow, type UploadActions } from "./upload-flow";

export const SOURCES_POLL_MS = 2000;
/** 30 minutes of polling at 2s. A draft still building after that needs a manual refresh. */
export const SOURCES_MAX_POLLS = 900;

export type SourcesActions = UploadActions & {
  loadSources: () => Promise<ActionResult<SourcesResponse>>;
  reindex: () => Promise<ActionResult<ReindexResponse>>;
  promoteDraft: (generationId: string) => Promise<ActionResult<DraftActionResponse>>;
  discardDraft: (generationId: string) => Promise<ActionResult<DraftActionResponse>>;
};

type Confirm = "promote" | "discard" | null;

export function SourcesWorkspace({
  initial,
  peopleTotal,
  actions,
  initialUploadOpen = false,
}: {
  initial: SourcesResponse;
  peopleTotal: number;
  actions: SourcesActions;
  initialUploadOpen?: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(initialUploadOpen);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const actionsRef = useRef(actions);
  const busyRef = useRef(false);

  useEffect(() => {
    actionsRef.current = actions;
  });

  const model = useMemo(() => mapSources(data), [data]);
  const rows = useMemo(() => filterRows(model.rows, filter, query), [model.rows, filter, query]);
  const draftState = data.draft?.state;
  const polling = draftState === "building" || draftState === "checking";

  useEffect(() => {
    if (!polling) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let polls = 0;
    const next = () => {
      timer = setTimeout(async () => {
        const result = await actionsRef.current.loadSources();
        if (cancelled) {
          return;
        }
        polls += 1;
        if (!result.ok) {
          setError({ message: result.error.message, retry: true });
          return;
        }
        setData(result.data);
        const state = result.data.draft?.state;
        if ((state === "building" || state === "checking") && polls < SOURCES_MAX_POLLS) {
          next();
        }
      }, SOURCES_POLL_MS);
    };
    next();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [polling, retryToken]);

  async function reload(): Promise<boolean> {
    const result = await actionsRef.current.loadSources();
    if (!result.ok) {
      setError({ message: result.error.message, retry: false });
      return false;
    }
    setData(result.data);
    return true;
  }

  async function run(work: () => Promise<ActionResult<unknown>>) {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (!result.ok) {
        setError({ message: result.error.message, retry: false });
        return;
      }
      await reload();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function confirmed() {
    const kind = confirm;
    const id = data.draft?.id;
    if (!kind || !id) {
      setConfirm(null);
      return;
    }
    await run(() => (kind === "promote" ? actions.promoteDraft(id) : actions.discardDraft(id)));
    setConfirm(null);
  }

  async function uploadClosed(started: boolean) {
    setUploadOpen(false);
    if (started) {
      await reload();
      router.refresh();
    }
  }

  return (
    <>
      {error ? (
        <div className="px-12 pt-6">
          <InlineAlert
            action={
              error.retry
                ? {
                    label: "Retry",
                    onClick: () => {
                      setError(null);
                      setRetryToken((token) => token + 1);
                    },
                  }
                : undefined
            }
          >
            {error.message}
          </InlineAlert>
        </div>
      ) : null}
      <SourcesView
        active={model.active}
        busy={busy}
        counts={model.counts}
        documentCount={model.documentCount}
        draft={model.draft}
        filter={filter}
        onDiscard={() => setConfirm("discard")}
        onFilterChange={setFilter}
        onPromote={() => setConfirm("promote")}
        onQueryChange={setQuery}
        onReindex={() => void run(() => actions.reindex())}
        onUpload={() => setUploadOpen(true)}
        query={query}
        rows={rows}
      />
      {confirm === "promote" ? (
        <ConfirmDialog
          body="Readers switch to this draft right away. The current generation stays available for rollback."
          busy={busy}
          confirmLabel="Promote"
          onCancel={() => setConfirm(null)}
          onConfirm={() => void confirmed()}
          title="Promote draft"
        />
      ) : null}
      {confirm === "discard" ? (
        <ConfirmDialog
          body="The draft and the files in it are deleted. Readers are not affected."
          busy={busy}
          confirmLabel="Discard"
          onCancel={() => setConfirm(null)}
          onConfirm={() => void confirmed()}
          title="Discard draft"
        />
      ) : null}
      {uploadOpen ? (
        <UploadFlow
          actions={actions}
          onAdded={() => void uploadClosed(true)}
          onBatchSent={() => void reload()}
          onClose={(started) => void uploadClosed(started)}
          peopleCount={peopleTotal}
        />
      ) : null}
    </>
  );
}
