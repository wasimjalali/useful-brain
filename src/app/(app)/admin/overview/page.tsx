import { OverviewView } from "@/components/admin/overview/overview-view";
import { PageBody } from "@/components/shell/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { brainJson } from "@/lib/cf/brain-client";
import type {
  EvalsAdminView,
  HealthResponse,
  OverviewResponse,
  UnansweredResponse,
} from "@/lib/contracts/admin-metrics";

import { mapEvalsSummary } from "../evals/mappers";
import { mapHealth, mapKpis, mapUnanswered, rangeSubtitle } from "./mappers";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [overview, unanswered, health, evals] = await Promise.all([
    brainJson<OverviewResponse>("/admin/overview?range=7d"),
    brainJson<UnansweredResponse>("/admin/unanswered?range=7d"),
    brainJson<HealthResponse>("/admin/health"),
    brainJson<EvalsAdminView>("/evaluations?view=campaign"),
  ]);
  return (
    <PageBody>
      <PageHeader subtitle={rangeSubtitle(overview.daily)} title="Overview" />
      <OverviewView
        evals={mapEvalsSummary(evals)}
        kpis={mapKpis(overview)}
        system={mapHealth(health.services)}
        unanswered={mapUnanswered(unanswered.questions, overview.generatedAt)}
      />
    </PageBody>
  );
}
