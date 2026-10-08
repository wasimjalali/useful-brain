import { loadActivityAction } from "@/app/admin-insights-actions";
import { ActivityView } from "@/components/admin/activity/activity-view";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const initial = await loadActivityAction({ outcome: "all" });
  return (
    <div className="uv-scroll min-h-0 flex-1 overflow-y-auto">
      <PageHeader title="Activity" />
      <div className="px-12 pt-6 pb-10">
        <ActivityView initial={initial.ok ? initial.data : null} />
      </div>
    </div>
  );
}
