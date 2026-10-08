import type { WorkspaceIdentity } from "@/app/actions";
import type {
  SettingsAccount,
  SettingsConnector,
  SettingsModelConfig,
} from "@/lib/contracts/settings-view";
import { departmentLabel } from "@/lib/labels";
import { shortGenerationId } from "@/lib/labels";

/** Brain `GET /config` (admin only). */
export type BrainConfig = {
  models: { answer: string; embedding: string; reranker: string };
  retrieval: {
    mode: "hybrid" | "keyword";
    passages: number;
    rerankFloor: number;
    configVersion: string;
  };
  activeGenerationId: string | null;
  connectors: Array<{
    id: string;
    label: string;
    kind: "upload" | "github" | "http" | "action";
    approval: boolean;
    status: "active" | "connected" | "not_connected";
  }>;
};

/** `totalDocuments` is applied only for admins, so a member never carries it. */
export function mapAccount(identity: WorkspaceIdentity, totalDocuments?: number): SettingsAccount {
  const subject = identity.subject ?? identity.id;
  return {
    name: identity.name ?? subject,
    email: identity.email ?? subject,
    role: identity.isAdmin ? "Admin" : "Member",
    department: identity.department ? departmentLabel(identity.department) : "None",
    readableDocuments: identity.readableDocumentCount,
    ...(identity.isAdmin && totalDocuments !== undefined ? { totalDocuments } : {}),
  };
}

export function mapAdminSettings(
  config: BrainConfig,
  activeDocuments: number,
): { config: SettingsModelConfig; connectors: SettingsConnector[] } {
  const connectors: SettingsConnector[] = [
    {
      id: "uploads",
      name: "Uploads",
      description: `Built in, ${activeDocuments} documents`,
      status: "active",
    },
  ];
  const ticket = config.connectors.find(
    (connector) => connector.kind === "action" && connector.label === "create_ticket",
  );
  if (ticket) {
    connectors.push({
      id: "support-desk",
      name: "Support desk",
      description: ticket.approval
        ? "create_ticket, every call needs approval"
        : "create_ticket",
      status: ticket.status,
    });
  }
  const github = config.connectors.find((connector) => connector.kind === "github");
  connectors.push({
    id: "github",
    name: "GitHub",
    description: "Sync a repository folder into a draft",
    status: github ? github.status : "not_connected",
    connectable: true,
  });
  return {
    config: {
      answerModel: config.models.answer,
      embeddingModel: config.models.embedding,
      rerankerModel: config.models.reranker,
      retrieval: config.retrieval.mode === "hybrid" ? "Hybrid, keyword and vector" : "Keyword",
      passagesPerAnswer: config.retrieval.passages,
      rerankFloor: config.retrieval.rerankFloor,
      activeGeneration: config.activeGenerationId ? shortGenerationId(config.activeGenerationId) : "None",
    },
    connectors,
  };
}
