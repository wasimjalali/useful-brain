"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import { CheckIcon, FileTextIcon, FileUpIcon, LayersIcon, XIcon } from "@/components/icons";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FilterChip } from "@/components/ui/filter-chip";
import { Segmented } from "@/components/ui/segmented";
import {
  UPLOAD_ACCEPTED_EXTENSIONS,
  UPLOAD_DEPARTMENTS,
  UPLOAD_MAX_BYTES,
  UPLOAD_ROLES,
  type UploadFileView,
  type UploadScope,
  type UploadStage,
} from "@/lib/contracts/admin-manage-view";

const STAGES: UploadStage[] = ["parsing", "chunking", "embedding", "ready"];
const STAGE_LABEL: Record<UploadStage, string> = {
  parsing: "Parsing",
  chunking: "Chunking",
  embedding: "Embedding",
  ready: "Ready",
  failed: "Failed",
};

const SCOPES = [
  { value: "everyone", label: "Everyone" },
  { value: "departments", label: "Departments" },
  { value: "roles", label: "Roles" },
];

const MAX_FILES = 25;
const MAX_NAME_LENGTH = 200;

/** Same name rule as Brain's create-batch check, so a batch is never refused as a whole. */
function nameAllowed(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_NAME_LENGTH &&
    !/[/\\\u0000-\u001f\u007f]/.test(trimmed) &&
    !trimmed.startsWith(".")
  );
}

/**
 * Splits a selection into files the pipeline accepts and inline rejection messages.
 * `existing` holds the names already in the list, which count towards the duplicate
 * and 25-file limits.
 */
export function validateUploadFiles(
  files: File[],
  existing: string[] = [],
): { accepted: File[]; rejections: string[] } {
  const accepted: File[] = [];
  const rejections: string[] = [];
  const seen = new Set(existing.map((name) => name.trim().toLowerCase()));
  let count = existing.length;
  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (!UPLOAD_ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      rejections.push(`${file.name}: unsupported file type`);
    } else if (file.size < 1) {
      rejections.push(`${file.name}: the file is empty`);
    } else if (file.size > UPLOAD_MAX_BYTES) {
      rejections.push(`${file.name}: larger than 25 MB`);
    } else if (!nameAllowed(file.name)) {
      rejections.push(`${file.name}: the file name isn't allowed`);
    } else if (seen.has(file.name.trim().toLowerCase())) {
      rejections.push(`${file.name}: a file with this name is already in the list`);
    } else if (count >= MAX_FILES) {
      rejections.push(`${file.name}: at most ${MAX_FILES} files at a time`);
    } else {
      accepted.push(file);
      seen.add(file.name.trim().toLowerCase());
      count += 1;
    }
  }
  return { accepted, rejections };
}

function segmentColor(stage: UploadStage, index: number) {
  if (stage === "failed") {
    return "var(--danger)";
  }
  const current = STAGES.indexOf(stage);
  if (stage === "ready" || index < current) {
    return "var(--ink)";
  }
  return index === current ? "var(--ink-faint)" : "var(--sunken)";
}

function FileRow({ file, onRemove }: { file: UploadFileView; onRemove?: (id: string) => void }) {
  const stageText = file.stage === "failed" ? (file.error ?? "Failed") : (file.note ?? STAGE_LABEL[file.stage]);
  const tone =
    file.stage === "ready" ? "text-success" : file.stage === "failed" ? "text-danger" : "text-ink-muted";
  return (
    <li
      className={`grid h-11 items-center gap-x-2.5 border-b border-border ${
        file.stage === "failed" && onRemove
          ? "grid-cols-[16px_minmax(0,1fr)_auto_112px_28px]"
          : "grid-cols-[16px_minmax(0,1fr)_auto_112px]"
      }`}
    >
      <FileTextIcon className="size-4 text-ink-muted" />
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-[13px] font-medium" title={file.name}>
          {file.name}
        </span>
        <span className="shrink-0 text-xs text-ink-faint-text">
          {file.sizeLabel}
          {file.readers ? ` · ${file.readers}` : ""}
        </span>
      </span>
      <span className={`max-w-40 truncate text-xs ${tone}`} title={stageText}>
        {stageText}
      </span>
      <span aria-hidden="true" className="grid grid-cols-4 gap-[3px]">
        {STAGES.map((_, index) => (
          <span
            className="h-1 rounded-full"
            key={index}
            style={{ background: segmentColor(file.stage, index) }}
          />
        ))}
      </span>
      {file.stage === "failed" && onRemove ? (
        <IconButton aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.id)}>
          <XIcon className="size-3.5" />
        </IconButton>
      ) : null}
    </li>
  );
}

export function UploadDialog({
  files,
  scope,
  selectedGroups,
  peopleCount,
  departments = UPLOAD_DEPARTMENTS,
  roles = UPLOAD_ROLES,
  onScopeChange,
  onToggleGroup,
  onFilesAdded,
  onRemoveFile,
  locked = false,
  onCancel,
  onSubmit,
}: {
  files: UploadFileView[];
  scope: UploadScope;
  selectedGroups: string[];
  peopleCount: number;
  departments?: readonly string[];
  roles?: readonly string[];
  onScopeChange: (scope: UploadScope) => void;
  onToggleGroup: (group: string) => void;
  /** Called with only the files that passed type and size checks. */
  onFilesAdded: (files: File[]) => void;
  /** Called to drop a failed file from the list. */
  onRemoveFile?: (id: string) => void;
  /** True once a file has started: its readers can no longer change. */
  locked?: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejections, setRejections] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const readyCount = files.filter((file) => file.stage === "ready").length;
  const allReady = files.length > 0 && readyCount === files.length;
  const groups = scope === "roles" ? roles : departments;

  function receive(list: FileList | File[] | null | undefined) {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) {
      return;
    }
    const { accepted, rejections: rejected } = validateUploadFiles(
      picked,
      files.map((file) => file.name),
    );
    setRejections(rejected);
    if (accepted.length > 0) {
      onFilesAdded(accepted);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    receive(event.dataTransfer?.files);
  }

  function onZoneKey(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputRef.current?.click();
    }
  }

  return (
    <Dialog ariaLabel="Upload documents" onClose={onCancel} top={96} width={560}>
      <div className="flex h-14 items-center pr-3 pl-6">
        <h2 className="flex-1 text-base font-semibold tracking-[-0.01em]">Upload documents</h2>
        <IconButton aria-label="Close" onClick={onCancel}>
          <XIcon className="size-4" />
        </IconButton>
      </div>

      <div className="flex flex-col gap-5 px-6">
        <div
          className="ub-ring flex h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[14px] text-center"
          data-testid="dropzone"
          onClick={() => inputRef.current?.click()}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDrop={onDrop}
          onKeyDown={onZoneKey}
          role="button"
          style={{
            background: dragging ? "var(--border)" : "var(--sunken)",
            boxShadow: "inset 0 0 0 1px var(--edge)",
          }}
          tabIndex={0}
        >
          <FileUpIcon className="size-5 text-ink-muted" />
          <span className="text-[13px]">
            Drop files here, or <span className="font-medium underline underline-offset-2">browse</span>
          </span>
          <span className="text-xs text-ink-faint-text">PDF, DOCX or Markdown, up to 25 MB each</span>
        </div>
        <input
          accept={UPLOAD_ACCEPTED_EXTENSIONS.join(",")}
          aria-label="Choose files"
          hidden
          multiple
          onChange={(event) => {
            receive(event.target.files);
            event.target.value = "";
          }}
          ref={inputRef}
          type="file"
        />

        {rejections.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-danger" role="alert">
            {rejections.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}

        {files.length > 0 ? (
          <ul aria-label="Files" className="flex flex-col">
            {files.map((file) => (
              <FileRow file={file} key={file.id} onRemove={onRemoveFile} />
            ))}
          </ul>
        ) : null}

        <div className="flex flex-col gap-2.5">
          <span className="text-[13px] font-medium">Who can read these</span>
          <div className="w-max">
            <Segmented
              label="Who can read these"
              onChange={(value) => onScopeChange(value as UploadScope)}
              options={locked ? SCOPES.map((option) => ({ ...option, disabled: true })) : SCOPES}
              value={scope}
            />
          </div>
          {scope === "everyone" ? (
            <span className="text-xs text-ink-faint-text">All {peopleCount} people at Northwind.</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {groups.map((group) => {
                const on = selectedGroups.includes(group);
                return (
                  <FilterChip disabled={locked} key={group} onClick={() => onToggleGroup(group)} pressed={on}>
                    {on ? <CheckIcon className="size-[13px]" strokeWidth={2} /> : null}
                    {group}
                  </FilterChip>
                );
              })}
            </div>
          )}
        </div>

        {locked ? (
          <span className="-mt-3 text-xs text-ink-faint-text">Readers are fixed once a file starts uploading.</span>
        ) : null}

        <div className="flex items-start gap-2 text-[13px] leading-5 text-ink-muted">
          <LayersIcon className="mt-0.5 size-[15px] shrink-0" />
          <span>Files go into a draft. Nothing changes for readers until you promote it.</span>
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2 pt-5 pr-4 pb-4 pl-6">
        <span className="flex-1 text-xs text-ink-faint-text">
          {files.length > 0 ? `${readyCount} of ${files.length} ready` : ""}
        </span>
        <Button onClick={onCancel} size={36} variant="secondary">
          Cancel
        </Button>
        <Button disabled={!allReady} onClick={onSubmit} size={36} variant={allReady ? "primary" : "secondary"}>
          Add to draft
        </Button>
      </div>
    </Dialog>
  );
}
