import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" className="mx-auto w-full max-w-3xl flex-1 px-6 py-10" role="status">
      <span className="sr-only">Loading</span>
      <div className="flex flex-col gap-3">
        <Skeleton height={24} width={220} />
        <Skeleton width="92%" />
        <Skeleton width="80%" />
        <Skeleton width="56%" />
      </div>
    </div>
  );
}
