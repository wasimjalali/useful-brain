"use client";

import { useState, type FormEvent } from "react";

import { XIcon } from "@/components/icons";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import type { InviteInput, InviteState } from "@/lib/contracts/admin-manage-view";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteDialog({
  state,
  departments,
  onSubmit,
  onClose,
}: {
  state: InviteState;
  departments: string[];
  onSubmit: (input: InviteInput) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState(departments[0] ?? "");
  const [localError, setLocalError] = useState<string | undefined>();
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setLocalError("Enter a valid email address");
      return;
    }
    setLocalError(undefined);
    onSubmit({ email: trimmed, department });
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <Dialog ariaLabel="Invite people" onClose={onClose} top={96} width={480}>
      <div className="flex h-14 items-center pr-3 pl-6">
        <h2 className="flex-1 text-base font-semibold tracking-[-0.01em]">Invite people</h2>
        <IconButton aria-label="Close" onClick={onClose}>
          <XIcon className="size-4" />
        </IconButton>
      </div>

      {state.status === "done" ? (
        <div className="flex flex-col gap-4 px-6 pb-6">
          <Field
            label="Invite link"
            readOnly
            style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
            trailing={
              <Button onClick={() => copyLink(state.link)} size={32} variant="secondary">
                Copy
              </Button>
            }
            value={state.link}
          />
          <p className="text-xs text-ink-faint-text">{state.expiresLabel}</p>
          <p aria-live="polite" className={`text-xs ${copy === "failed" ? "text-danger" : "text-success"}`}>
            {copy === "copied" ? "Copied" : copy === "failed" ? "Couldn't copy. Select the link and copy it." : ""}
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose} size={36} variant="secondary">
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-4 px-6 pb-5" noValidate onSubmit={submit}>
          {state.status === "form" && state.error ? <InlineAlert>{state.error}</InlineAlert> : null}
          <Field
            autoComplete="off"
            error={localError ?? (state.status === "form" ? state.fieldErrors?.email : undefined)}
            label="Email"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-faint-text" htmlFor="invite-department">
              Department
            </label>
            <Select
              id="invite-department"
              onChange={setDepartment}
              options={departments.map((name) => ({ label: name, value: name }))}
              value={department}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={onClose} size={36} variant="secondary">
              Cancel
            </Button>
            <Button disabled={state.status === "submitting"} size={36} type="submit" variant="primary">
              Create invite
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
