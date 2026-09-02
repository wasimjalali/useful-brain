type MarkTone = "dark" | "light";

/**
 * The constellation mark: a query node linked to the sources it retrieves,
 * the literal shape of retrieval. "dark" renders on the brand tile and
 * "light" renders on a light surface.
 */
export function UsefulBrainMark({
  tone = "dark",
  className,
}: {
  tone?: MarkTone;
  className?: string;
}) {
  const node = tone === "dark" ? "var(--brand-ink)" : "var(--brand)";
  const focal = tone === "dark" ? "var(--accent-on-dark)" : "var(--accent)";
  const line = focal;

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M32 32 L18 18 M32 32 L48 16 M32 32 L46 44 M32 32 L18 46"
        stroke={line}
        strokeWidth={2.6}
        strokeLinecap="round"
        opacity={0.5}
      />
      <circle cx="32" cy="32" r="6" fill={focal} />
      <circle cx="18" cy="18" r="3.6" fill={node} />
      <circle cx="48" cy="16" r="3.6" fill={node} />
      <circle cx="46" cy="44" r="3.6" fill={node} />
      <circle cx="18" cy="46" r="3.6" fill={node} />
    </svg>
  );
}

/** Mark on a brand tile plus the wordmark. Used in the sidebar and header. */
export function UsefulBrainLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-brand shadow-sm">
        <UsefulBrainMark tone="dark" className="size-6" />
      </span>
      {!compact ? (
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">
          Useful Brain
        </span>
      ) : null}
    </div>
  );
}
