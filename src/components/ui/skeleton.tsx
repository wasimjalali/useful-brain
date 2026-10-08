import type { CSSProperties } from "react";

export function Skeleton({
  width = "100%",
  height = 12,
  radius,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
}) {
  const style: CSSProperties = { width, height, borderRadius: radius };
  return <span aria-hidden="true" className="ub-skel" style={style} />;
}

function Busy({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function AnswerSkeleton() {
  return (
    <Busy className="flex flex-col gap-2.5" label="Loading answer">
      <Skeleton width="92%" />
      <Skeleton width="80%" />
      <Skeleton width="56%" />
      <span className="mt-1 flex gap-2">
        <Skeleton height={32} radius={10} width={180} />
        <Skeleton height={32} radius={10} width={150} />
      </span>
    </Busy>
  );
}

const ROW_WIDTHS = ["58%", "44%", "64%", "38%"];

export function TableRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Busy label="Loading rows">
      {Array.from({ length: rows }, (_, index) => (
        <span
          className="flex h-11 items-center gap-4 border-b border-border"
          data-skeleton-row
          key={index}
        >
          <Skeleton height={10} width={ROW_WIDTHS[index % ROW_WIDTHS.length]} />
          <Skeleton height={10} width={64} />
          <span className="flex-1" />
          <Skeleton height={20} width={52} />
        </span>
      ))}
    </Busy>
  );
}

export function PassageSkeleton() {
  return (
    <Busy className="flex flex-col gap-2.5" label="Loading passage">
      <span className="flex items-center gap-2">
        <Skeleton height={18} width={18} />
        <Skeleton height={10} width={150} />
      </span>
      <Skeleton height={10} />
      <Skeleton height={10} width="94%" />
      <Skeleton height={10} width="70%" />
    </Busy>
  );
}
