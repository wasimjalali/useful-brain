import { ModelChip } from "@/components/admin/evals/evals-footer";
import { EvalsView } from "@/components/admin/evals/evals-view";
import { PageBody } from "@/components/shell/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { brainJson } from "@/lib/cf/brain-client";
import type { EvalsAdminView } from "@/lib/contracts/admin-metrics";

import { mapEvals } from "./mappers";

export const dynamic = "force-dynamic";

export default async function EvalsPage() {
  const view = mapEvals(await brainJson<EvalsAdminView>("/evaluations?view=campaign"));
  return (
    <PageBody>
      <PageHeader actions={<ModelChip model={view.model} />} subtitle={view.subtitle} title="Evals" />
      <EvalsView view={view} />
    </PageBody>
  );
}
