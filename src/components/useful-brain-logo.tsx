type MarkTone = "dark" | "light";

const DOCUMENT =
  "M17 0h116l52 52v173a17 17 0 0 1-17 17H17A17 17 0 0 1 0 225V17A17 17 0 0 1 17 0ZM17 10h113V48l8 8H175V225a7 7 0 0 1-7 7H17a7 7 0 0 1-7-7V17a7 7 0 0 1 7-7Z";

const QUOTE =
  "M164.2 139h11.6c1.7 0 2.8 1.2 2.8 2.9v9.4c0 1.1-.7 2-1.8 2.3c1.2.6 1.6 2.2 1.4 3.8-.5 4-3.4 8.2-8.2 10-2.2.8-5 .2-5.6-1.8-.5-1.4.2-2.8 1.4-3.4 1.6 1.6 4.6 1.4 5.4-1 .6-1.8-.4-3.6-2.2-4.4l-1.2-1.2h-5.2c-1.3 0-2.4-1.1-2.4-2.4V142c0-1.7 1.2-3 2.9-3z";

function markColors(tone: MarkTone) {
  if (tone === "dark") {
    return { ink: "#fafafa", bar: "#595959", quote: "#171717" };
  }
  return { ink: "#171717", bar: "#d4d4d4", quote: "#ffffff" };
}

export function UsefulBrainMarkPaths({
  ink,
  bar,
  quote,
}: {
  ink: string;
  bar: string;
  quote: string;
}) {
  return (
    <>
      <path fill={ink} fillRule="evenodd" d={DOCUMENT} />
      <rect x="35" y="85" width="95" height="13" rx="6.5" fill={ink} />
      <rect x="35" y="117" width="95" height="13" rx="6.5" fill={ink} />
      <rect x="35" y="151" width="95" height="33" rx="8" fill={bar} />
      <circle cx="181.5" cy="153.5" r="38.5" fill={ink} />
      <g fill={quote}>
        <path d={QUOTE} />
        <path d={QUOTE} transform="translate(25 0)" />
      </g>
    </>
  );
}

/** Document + quote mark. Light = ink on canvas. Dark = inverted for a brand tile. */
export function UsefulBrainMark({
  tone = "light",
  className,
}: {
  tone?: MarkTone;
  className?: string;
}) {
  const colors = markColors(tone);

  return (
    <svg viewBox="0 0 220 242" fill="none" className={className} aria-hidden="true">
      <UsefulBrainMarkPaths {...colors} />
    </svg>
  );
}

export function UsefulBrainAvatar({ className }: { className?: string }) {
  return (
    <span
      className={["grid size-8 shrink-0 place-items-center rounded-xl bg-brand", className]
        .filter(Boolean)
        .join(" ")}
    >
      <UsefulBrainMark tone="dark" className="h-[22px] w-auto" />
    </span>
  );
}

/** Official lockup: mark + wordmark. Compact is the mark only. */
export function UsefulBrainLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2" aria-label="Useful Brain">
      <UsefulBrainMark tone="light" className="h-7 w-auto shrink-0" />
      {compact ? null : (
        <span className="translate-y-px text-[14px] font-bold leading-none tracking-[-0.03em] text-ink">
          Useful Brain
        </span>
      )}
    </div>
  );
}
