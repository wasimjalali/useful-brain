"use client";

import { useEffect, useId, useRef, useState } from "react";

import { ChevronDownIcon } from "@/components/icons";

export type SelectOption = {
  label: string;
  value: string;
};

export function Select({
  disabled = false,
  id,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  id?: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  value: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const listId = `${fieldId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="field-input flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm text-ink"
        disabled={disabled}
        id={fieldId}
        onClick={() => setOpen((current) => !current)}
        role="combobox"
        type="button"
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-ink-faint" />
      </button>
      {open ? (
        <ul
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-raise"
          id={listId}
          role="listbox"
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <li key={option.value}>
                <button
                  aria-selected={active}
                  className={[
                    "flex w-full px-3 py-2 text-left text-sm",
                    active
                      ? "bg-sunken font-medium text-ink"
                      : "text-ink hover:bg-sunken",
                  ].join(" ")}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  role="option"
                  type="button"
                >
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
