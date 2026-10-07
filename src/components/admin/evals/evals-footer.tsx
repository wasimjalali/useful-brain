import { CpuIcon, LockIcon } from "@/components/icons";

export function EvalsFooter() {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-t border-border text-xs text-ink-faint-text">
      <LockIcon className="size-[13px]" />
      <span>Read-only here. Run the suite from the repo:</span>
      <span className="font-mono text-xs text-ink-muted">npm run eval:northwind</span>
    </div>
  );
}

export function ModelChip({ model }: { model: string }) {
  return (
    <span className="inline-flex h-[30px] items-center gap-2 rounded-[10px] bg-sunken px-2.5 font-mono text-xs text-ink">
      <CpuIcon className="size-3.5 text-ink-muted" />
      {model}
    </span>
  );
}
