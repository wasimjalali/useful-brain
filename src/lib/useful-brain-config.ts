export type UsefulBrainClientConfig = {
  productName: string;
  companyName: string;
  productSubtitle: string;
  supportRoleLabel: string;
  knowledgeLabel: string;
  evaluationsLabel: string;
};

export const DEFAULT_USEFUL_BRAIN_CONFIG: UsefulBrainClientConfig = {
  productName: "Useful Brain",
  companyName: "Northwind",
  productSubtitle: "Company knowledge",
  supportRoleLabel: "Knowledge agent",
  knowledgeLabel: "Sources",
  evaluationsLabel: "Evals",
};
