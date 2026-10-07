"use client";

import { useEffect, useRef, useState } from "react";

import type { UploadFileView, UploadScope, UploadStage } from "@/lib/contracts/admin-manage-view";
import type { UploadCreated, UploadReaders, UploadRequest, UploadStatus } from "@/lib/contracts/sources";
import type { ActionResult } from "@/lib/rag/app-errors";

import { UploadDialog } from "./upload-dialog";

export const UPLOAD_POLL_MS = 1000;
const MAX_STATUS_FAILURES = 3;

export type UploadActions = {
  createUpload: (request: UploadRequest) => Promise<ActionResult<UploadCreated>>;
  uploadStatus: (batchId: string) => Promise<ActionResult<UploadStatus>>;
  /** Streams one file to /api/admin/uploads/:batchId/files/:fileId. */
  putFile: (batchId: string, fileId: string, file: File) => Promise<{ ok: true } | { ok: false; message: string }>;
};

/** Wire names for the role chips in the dialog (NORTHWIND_ROLES in contracts/people). */
const ROLE_WIRE: Record<string, string> = {
  Managers: "manager",
  Directors: "director",
  "HR managers": "hr_manager",
  "Finance managers": "finance_manager",
  "Support managers": "support_manager",
  "Sales managers": "sales_manager",
};

/** Null while the choice is incomplete: nothing is uploaded until someone can read it. */
export function readersFor(scope: UploadScope, groups: string[]): UploadReaders | null {
  if (scope === "everyone") {
    return { kind: "everyone" };
  }
  if (groups.length === 0) {
    return null;
  }
  return scope === "departments"
    ? { kind: "departments", names: groups.map((group) => group.toLowerCase()) }
    : { kind: "roles", names: groups.map((group) => ROLE_WIRE[group] ?? group.toLowerCase().replace(/ /g, "_")) };
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Entry = {
  key: string;
  file: File;
  started: boolean;
  batchId?: string;
  fileId?: string;
  stage: UploadStage;
  error?: string;
};

const isTerminal = (entry: Entry) => entry.stage === "ready" || entry.stage === "failed";

export function UploadFlow({
  actions,
  peopleCount,
  onClose,
  onAdded,
}: {
  actions: UploadActions;
  peopleCount: number;
  /** Closed without adding; `started` is true when a batch already created a draft. */
  onClose: (started: boolean) => void;
  onAdded: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [scope, setScope] = useState<UploadScope>("everyone");
  const [groups, setGroups] = useState<string[]>([]);
  const entriesRef = useRef<Entry[]>([]);
  const mounted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const actionsRef = useRef(actions);

  useEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, []);

  function commit(next: Entry[]) {
    entriesRef.current = next;
    setEntries(next);
  }

  function patch(keys: string[], change: Partial<Entry> | ((entry: Entry) => Partial<Entry>)) {
    commit(
      entriesRef.current.map((entry) =>
        keys.includes(entry.key)
          ? { ...entry, ...(typeof change === "function" ? change(entry) : change) }
          : entry,
      ),
    );
  }

  function schedulePoll() {
    if (timer.current || !mounted.current) {
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      void poll();
    }, UPLOAD_POLL_MS);
  }

  async function poll() {
    const open = entriesRef.current.filter((entry) => entry.batchId && entry.fileId && !isTerminal(entry));
    const batchIds = [...new Set(open.map((entry) => entry.batchId as string))];
    for (const batchId of batchIds) {
      const result = await actionsRef.current.uploadStatus(batchId);
      if (!mounted.current) {
        return;
      }
      const keys = open.filter((entry) => entry.batchId === batchId).map((entry) => entry.key);
      if (!result.ok) {
        failures.current += 1;
        if (failures.current >= MAX_STATUS_FAILURES) {
          patch(keys, (entry) => (isTerminal(entry) ? {} : { stage: "failed", error: result.error.message }));
        }
        continue;
      }
      failures.current = 0;
      const byFile = new Map(result.data.files.map((file) => [file.id, file]));
      patch(keys, (entry) => {
        const status = byFile.get(entry.fileId as string);
        return status && !isTerminal(entry)
          ? { stage: status.stage, error: status.errorMessage }
          : {};
      });
    }
    if (mounted.current && entriesRef.current.some((entry) => entry.batchId && !isTerminal(entry))) {
      schedulePoll();
    }
  }

  async function sendBatch(pending: Entry[], readers: UploadReaders) {
    const keys = pending.map((entry) => entry.key);
    const created = await actionsRef.current.createUpload({
      readers,
      idempotencyKey: crypto.randomUUID(),
      files: pending.map((entry) => ({ name: entry.file.name, size: entry.file.size })),
    });
    if (!mounted.current) {
      return;
    }
    if (!created.ok) {
      patch(keys, { stage: "failed", error: created.error.message });
      return;
    }
    const { batchId, files } = created.data;
    pending.forEach((entry, index) => {
      const fileId = files[index]?.id;
      patch([entry.key], fileId ? { batchId, fileId } : { stage: "failed", error: "Couldn't start this file." });
    });
    for (const [index, entry] of pending.entries()) {
      const fileId = files[index]?.id;
      if (!fileId) {
        continue;
      }
      const sent = await actionsRef.current.putFile(batchId, fileId, entry.file);
      if (!mounted.current) {
        return;
      }
      if (!sent.ok) {
        patch([entry.key], { stage: "failed", error: sent.message });
      }
    }
    schedulePoll();
  }

  function flush(nextScope: UploadScope, nextGroups: string[]) {
    const readers = readersFor(nextScope, nextGroups);
    const pending = entriesRef.current.filter((entry) => !entry.started);
    if (!readers || pending.length === 0) {
      return;
    }
    patch(pending.map((entry) => entry.key), { started: true });
    void sendBatch(pending, readers);
  }

  function addFiles(files: File[]) {
    commit([
      ...entriesRef.current,
      ...files.map((file) => ({ key: crypto.randomUUID(), file, started: false, stage: "parsing" as const })),
    ]);
    flush(scope, groups);
  }

  function changeScope(next: UploadScope) {
    setScope(next);
    setGroups([]);
    flush(next, []);
  }

  function toggleGroup(group: string) {
    const next = groups.includes(group) ? groups.filter((item) => item !== group) : [...groups, group];
    setGroups(next);
    flush(scope, next);
  }

  const views: UploadFileView[] = entries.map((entry) => ({
    id: entry.key,
    name: entry.file.name,
    sizeLabel: sizeLabel(entry.file.size),
    stage: entry.stage,
    error: entry.error,
  }));

  return (
    <UploadDialog
      files={views}
      onCancel={() => onClose(entries.some((entry) => entry.batchId !== undefined))}
      onFilesAdded={addFiles}
      onScopeChange={changeScope}
      onSubmit={onAdded}
      onToggleGroup={toggleGroup}
      peopleCount={peopleCount}
      scope={scope}
      selectedGroups={groups}
    />
  );
}

/** Browser-side PUT to the Next route, which streams the file on to Brain. */
export async function putFileToRoute(
  batchId: string,
  fileId: string,
  file: File,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch(
      `/api/admin/uploads/${encodeURIComponent(batchId)}/files/${encodeURIComponent(fileId)}`,
      { method: "PUT", body: file, headers: { "content-type": "application/octet-stream" } },
    );
    if (response.ok) {
      return { ok: true };
    }
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === "object" ? (body as { message?: unknown }).message : null;
    return { ok: false, message: typeof message === "string" ? message : "The file couldn't be uploaded." };
  } catch {
    return { ok: false, message: "The file couldn't be uploaded. Check your connection." };
  }
}
