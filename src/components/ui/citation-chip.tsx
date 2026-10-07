import type { ButtonHTMLAttributes } from "react";

type CitationChipProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "children" | "onClick"
> & {
  n: number | string;
  /** Hovered or pinned. */
  active?: boolean;
  onHover?: (hovered: boolean) => void;
  onClick?: () => void;
};

export function CitationChip({
  n,
  active = false,
  onHover,
  onClick,
  type = "button",
  ...props
}: CitationChipProps) {
  return (
    <button
      aria-label={`Citation ${n}`}
      className="ub-cite ub-ring"
      data-active={active ? "true" : undefined}
      onBlur={() => onHover?.(false)}
      onClick={onClick}
      onFocus={() => onHover?.(true)}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      type={type}
      {...props}
    >
      {n}
    </button>
  );
}
