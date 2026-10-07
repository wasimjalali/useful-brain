"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type SegmentedOption = {
  value: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
};

export function Segmented({
  label,
  mode = "radiogroup",
  options,
  value,
  onChange,
}: {
  label: string;
  mode?: "radiogroup" | "tablist";
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const optionRole = mode === "tablist" ? "tab" : "radio";

  function onKeyDown(event: KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    for (let i = 1; i <= options.length; i += 1) {
      const next = (index + step * i + options.length * i) % options.length;
      if (!options[next].disabled) {
        onChange(options[next].value);
        refs.current[next]?.focus();
        return;
      }
    }
  }

  return (
    <div aria-label={label} className="ub-seg" role={mode}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            aria-checked={mode === "radiogroup" ? selected : undefined}
            aria-selected={mode === "tablist" ? selected : undefined}
            className="ub-seg-opt ub-ring"
            data-selected={selected ? "true" : undefined}
            disabled={option.disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            ref={(node) => {
              refs.current[index] = node;
            }}
            role={optionRole}
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {option.icon}
            {option.label}
            {option.count === undefined ? null : (
              <span className="text-ink-faint-text">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
