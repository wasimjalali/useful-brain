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
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  ...props
}: CitationChipProps) {
  return (
    <button
      aria-label={`Citation ${n}`}
      className="ub-cite ub-ring"
      data-active={active ? "true" : undefined}
      {...props}
      onBlur={(event) => {
        onBlur?.(event);
        onHover?.(false);
      }}
      onClick={onClick}
      onFocus={(event) => {
        onFocus?.(event);
        onHover?.(true);
      }}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        onHover?.(true);
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        onHover?.(false);
      }}
      type={type}
    >
      {n}
    </button>
  );
}
