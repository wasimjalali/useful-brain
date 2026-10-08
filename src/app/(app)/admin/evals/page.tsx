import { ModelChip } from "@/components/admin/evals/evals-footer";
import { EvalsView } from "@/components/admin/evals/evals-view";
import { PageHeader } from "@/components/ui/page-header";
import { brainJson } from "@/lib/cf/brain-client";
import type { EvalsAdminView } from "@/lib/contracts/admin-metrics";

import { mapEvals } from "./mappers";

export const dynamic = "force-dynamic";

export default async function EvalsPage() {
  const view = mapEvals(await brainJson<EvalsAdminView>("/evaluations?view=campaign"));
  return (
    <div className="uv-scroll min-h-0 flex-1 overflow-y-auto">
      <PageHeader actions={<div className="mb-[23px]"><ModelChip model={view.model} /></div>} subtitle={view.subtitle} title="Evals" />
      <div className="px-4 pt-6 pb-10 min-[768px]:px-12">
        <EvalsView view={view} />
      </div>
    </div>
  );
}
