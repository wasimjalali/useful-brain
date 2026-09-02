"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (!rootRef.current?.contains(event.target as Node)) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => Math.min(options.length - 1, current + 1));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(options.length - 1);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const option = options[activeIndex];
        if (option) {
          onChange(option.value);
          setOpen(false);
          buttonRef.current?.focus();
        }
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [activeIndex, onChange, open, options]);

  function openMenu() {
    if (disabled) {
      return;
    }
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function handleButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || open) {
      return;
    }
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      openMenu();
    }
  }

  const active = options[activeIndex] ?? selected;
  const activeId = active ? `${listId}-${active.value}` : undefined;

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-activedescendant={open ? activeId : undefined}
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="field-input flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm text-ink"
        disabled={disabled}
        id={fieldId}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openMenu();
          }
        }}
        onKeyDown={handleButtonKeyDown}
        ref={buttonRef}
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
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <li key={option.value}>
                <button
                  aria-selected={isSelected}
                  className={[
                    "flex w-full px-3 py-2 text-left text-sm",
                    isActive ? "bg-sunken text-ink" : "text-ink hover:bg-sunken",
                    isSelected ? "font-medium" : "",
                  ].join(" ")}
                  id={`${listId}-${option.value}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    buttonRef.current?.focus();
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  tabIndex={-1}
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
