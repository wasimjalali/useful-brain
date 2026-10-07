import { EyeOffIcon } from "@/components/icons";

export function RestrictedNote({ title, readers }: { title: string; readers: string }) {
  return (
    <p className="m-0 flex items-center gap-1.5 text-xs text-ink-faint-text">
      <EyeOffIcon className="size-3.5 shrink-0" />
      Only you see this: {title} exists, but only {readers} can read it.
    </p>
  );
}
