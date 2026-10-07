import { loadActivityAction } from "@/app/admin-insights-actions";
import { ActivityView } from "@/components/admin/activity/activity-view";
import { PageBody } from "@/components/shell/page-body";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const initial = await loadActivityAction({ outcome: "all" });
  return (
    <PageBody>
      <PageHeader title="Activity" />
      <ActivityView initial={initial.ok ? initial.data : null} />
    </PageBody>
  );
}
