export type KnowledgeDocument = {
  id?: string;
  source: string;
  title: string;
  text: string;
};

export type DocumentChunk = {
  id: string;
  source: string;
  section: string;
  text: string;
  tokenEstimate: number;
  createdAt: string;
};
