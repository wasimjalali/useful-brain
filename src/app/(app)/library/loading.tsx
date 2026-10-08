import { LibraryClient } from "@/components/library/library-client";
import { PageHeader } from "@/components/ui/page-header";

export default function LibraryLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader title="Library" />
      <LibraryClient documents={[]} loading />
    </div>
  );
}
