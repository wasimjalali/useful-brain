"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog ariaLabel={title} onClose={onCancel} top={160} width={440}>
      <div className="flex flex-col gap-2 px-6 pt-5">
        <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
        <p className="text-[13px] leading-5 text-ink-muted">{body}</p>
      </div>
      <div className="flex items-center justify-end gap-2 pt-5 pr-4 pb-4 pl-6">
        <Button onClick={onCancel} size={36} variant="secondary">
          Cancel
        </Button>
        <Button disabled={busy} onClick={onConfirm} size={36} variant="primary">
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
