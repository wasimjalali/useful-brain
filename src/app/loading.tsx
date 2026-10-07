import "@/components/shell/shell.css";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="ub-shell" role="status">
      <aside className="ub-rail">
        <div className="ub-rail-logo">
          <Skeleton height={22} width={20} />
          <Skeleton height={14} width={92} />
        </div>
        <div className="ub-rail-group" style={{ marginTop: 14, gap: 10, padding: "0 10px" }}>
          <Skeleton height={14} width="70%" />
          <Skeleton height={14} width="55%" />
          <Skeleton height={14} width="62%" />
        </div>
      </aside>
      <div className="ub-main">
        <main className="ub-stage" />
      </div>
      <span className="sr-only">Loading workspace</span>
    </div>
  );
}
