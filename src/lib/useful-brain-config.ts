export type UsefulBrainClientConfig = {
  productName: string;
  productSubtitle: string;
  supportRoleLabel: string;
  knowledgeLabel: string;
  evaluationsLabel: string;
};

export const DEFAULT_USEFUL_BRAIN_CONFIG: UsefulBrainClientConfig = {
  productName: "Useful Brain",
  productSubtitle: "Company knowledge",
  supportRoleLabel: "Knowledge agent",
  knowledgeLabel: "Knowledge base",
  evaluationsLabel: "Evaluations",
};
