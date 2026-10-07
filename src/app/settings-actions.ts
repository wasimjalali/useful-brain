"use server";

import {
  mapAdminSettings,
  type BrainConfig,
} from "@/components/settings/settings-mapper";
import { brainJson } from "@/lib/cf/brain-client";
import {
  actionFailure,
  actionSuccess,
  type ActionResult,
} from "@/lib/rag/app-errors";
import type { PeopleResponse } from "@/lib/contracts/people";
import type { SettingsConnector, SettingsModelConfig } from "@/lib/contracts/settings-view";

export type AdminSettingsData = {
  config: SettingsModelConfig;
  connectors: SettingsConnector[];
  totalDocuments: number;
};

/** Admin only: Brain rejects both endpoints for anyone else. */
export async function loadAdminSettingsAction(): Promise<ActionResult<AdminSettingsData>> {
  try {
    const [config, people] = await Promise.all([
      brainJson<BrainConfig>("/config"),
      brainJson<PeopleResponse>("/admin/people"),
    ]);
    return actionSuccess({
      ...mapAdminSettings(config, people.activeDocuments),
      totalDocuments: people.activeDocuments,
    });
  } catch (error) {
    return actionFailure(error);
  }
}
