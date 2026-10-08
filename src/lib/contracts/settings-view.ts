export type SettingsSection = "appearance" | "account" | "model" | "connectors";

export type SettingsAccount = {
  name: string;
  email: string;
  role: string;
  department: string;
  /** Documents the principal can read. */
  readableDocuments: number;
  /** Corpus total. Pass only for admins (plan D1); members never see it. */
  totalDocuments?: number;
};

export type SettingsModelConfig = {
  answerModel: string;
  embeddingModel: string;
  rerankerModel: string;
  retrieval: string;
  passagesPerAnswer: number;
  rerankFloor: number;
  activeGeneration: string;
};

export type SettingsConnector = {
  id: string;
  name: string;
  description: string;
  status: "active" | "connected" | "not_connected";
  /** Optional connect action. Omitted rows show a disabled Connect button when not connected. */
  connectable?: boolean;
};
