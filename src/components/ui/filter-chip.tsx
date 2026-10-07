import type { ButtonHTMLAttributes } from "react";

type FilterChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  pressed?: boolean;
  count?: number;
};

export function FilterChip({
  pressed = false,
  count,
  type = "button",
  children,
  ...props
}: FilterChipProps) {
  return (
    <button aria-pressed={pressed} className="ub-chip ub-ring" type={type} {...props}>
      {children}
      {count === undefined ? null : <span className="ub-chip-count">{count}</span>}
    </button>
  );
}
