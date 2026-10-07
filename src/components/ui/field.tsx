"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import { SearchIcon, XIcon } from "@/components/icons";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size"> & {
  label: string;
  size?: 40 | 44;
  error?: string;
  trailing?: ReactNode;
};

export function Field({
  label,
  size = 40,
  error,
  trailing,
  id,
  disabled,
  "aria-describedby": describedBy,
  ...props
}: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const errorId = `${inputId}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-ink-faint-text" htmlFor={inputId}>
        {label}
      </label>
      <div
        className="ub-field"
        data-disabled={disabled ? "true" : undefined}
        data-invalid={error ? "true" : undefined}
        data-size={size}
      >
        <input
          {...props}
          aria-describedby={
            [describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined
          }
          aria-invalid={error ? true : props["aria-invalid"]}
          className="ub-field-input"
          disabled={disabled}
          id={inputId}
        />
        {trailing}
      </div>
      {error ? (
        <p className="text-xs text-danger" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  width,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
}) {
  return (
    <div
      className="ub-field"
      data-size="36"
      style={width ? { width, maxWidth: "100%" } : undefined}
    >
      <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      <input
        aria-label={label}
        className="ub-field-input"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
      {value ? (
        <button
          aria-label="Clear search"
          className="ub-iconbtn ub-ring"
          onClick={() => onChange("")}
          style={{ width: 24, height: 24, borderRadius: 8 }}
          type="button"
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
