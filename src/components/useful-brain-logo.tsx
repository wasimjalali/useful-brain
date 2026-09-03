type MarkTone = "dark" | "light";

const DOCUMENT =
  "M17 0h116l52 52v173a17 17 0 0 1-17 17H17A17 17 0 0 1 0 225V17A17 17 0 0 1 17 0ZM17 10h113V48l8 8H175V225a7 7 0 0 1-7 7H17a7 7 0 0 1-7-7V17a7 7 0 0 1 7-7Z";

const QUOTE =
  "M164.2 139h11.6c1.7 0 2.8 1.2 2.8 2.9v9.4c0 1.1-.7 2-1.8 2.3c1.2.6 1.6 2.2 1.4 3.8-.5 4-3.4 8.2-8.2 10-2.2.8-5 .2-5.6-1.8-.5-1.4.2-2.8 1.4-3.4 1.6 1.6 4.6 1.4 5.4-1 .6-1.8-.4-3.6-2.2-4.4l-1.2-1.2h-5.2c-1.3 0-2.4-1.1-2.4-2.4V142c0-1.7 1.2-3 2.9-3z";

// The quote pair's identity bbox spans x 160-203, y 139-167, centered on
// (181.5, 153). The document bbox centers on (110, 121), so this transform
// pins the quote to the document center at 43% of the document width, the
// same proportion as the app tile icon.
const QUOTE_TRANSFORM = "translate(110 121) scale(2) translate(-181.5 -153)";

function markColors(tone: MarkTone) {
  // One ink for document and quote: the document interior is transparent, so
  // the quote always sits on the surface showing through the outline.
  const ink = tone === "dark" ? "#fafafa" : "#171717";
  return { ink, quote: ink };
}

export function UsefulBrainMarkPaths({
  ink,
  quote,
}: {
  ink: string;
  quote: string;
}) {
  return (
    <>
      <path fill={ink} fillRule="evenodd" d={DOCUMENT} />
      <g fill={quote} transform={QUOTE_TRANSFORM}>
        <path d={QUOTE} />
        <path d={QUOTE} transform="translate(25 0)" />
      </g>
    </>
  );
}

/** Document + centered quote mark. Light = ink on canvas. Dark = inverted for a brand tile. */
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
