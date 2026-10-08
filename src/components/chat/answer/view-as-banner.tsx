import { EyeIcon } from "@/components/icons";

export function ViewAsBanner({
  name,
  department,
  documentCount,
  onExit,
}: {
  name: string;
  department: string;
  documentCount: number;
  onExit: () => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2.5 bg-accent px-4 text-[13px] text-accent-ink">
      <EyeIcon className="size-4" />
      <span className="flex-1 truncate">
        <strong className="font-semibold">Viewing as {name}</strong> · {department} · {documentCount}{" "}
        {documentCount === 1 ? "document" : "documents"}
      </span>
      <button
        className="ub-ring h-7 rounded-[10px] bg-accent-ink px-3 text-[13px] font-medium text-accent"
        onClick={onExit}
        style={{ ["--ring-bg" as string]: "var(--accent)" }}
        type="button"
      >
        Exit
      </button>
    </div>
  );
}
