import { canAccessChunk } from "../acl/access";
import { ABSTENTION_CATEGORIES, type EvalQuestion } from "./northwind-loader";
import { mean, ndcg, rankedDocumentIds, recall, reciprocalRank } from "./metrics";
import { MAX_TOP_K } from "../retrieve/types";
import type { KnowledgePipeline } from "../retrieve/pipeline";
import type { SearchCitation } from "../retrieve/types";

export type QuestionResult = {
  questionId: string;
  category: EvalQuestion["category"];
  recall: number;
  reciprocalRank: number;
  ndcg: number;
  citationCorrect: boolean;
  abstentionCorrect: boolean;
  leakedDocumentIds: string[];
  aclViolationChunkIds: string[];
  topDocumentIds: string[];
};

export type RetrievalEvalReport = {
  topK: number;
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
  citationCorrectness: number;
  abstentionCorrectness: number;
  aclLeakCount: number;
  results: QuestionResult[];
};

function citationCorrect(question: EvalQuestion, citation: SearchCitation | undefined): boolean {
  if (!citation || question.expectedDocumentIds.length === 0) {
    return false;
  }
  if (!question.expectedDocumentIds.includes(citation.documentId)) {
    return false;
  }
  if (question.expectedSections.length > 0 && !question.expectedSections.includes(citation.sectionHeading)) {
    return false;
  }
  return true;
}

export async function runRetrievalEvals(
  pipeline: KnowledgePipeline,
  questions: EvalQuestion[],
  topK = 3,
): Promise<RetrievalEvalReport> {
  const effectiveTopK = Math.max(1, Math.min(topK, MAX_TOP_K));
  const results: QuestionResult[] = [];
  for (const question of questions) {
    const response = await pipeline.search({
      query: question.query,
      principal: question.principal,
      topK: effectiveTopK,
      candidateLimit: 24,
    });
    const ranked = rankedDocumentIds(response.hits.map((hit) => hit.citation.documentId));
    const leaked = ranked.filter((id) => question.forbiddenDocumentIds.includes(id));
    const violations: string[] = [];
    for (const hit of response.hits) {
      const chunk = pipeline.store.get(hit.chunkId);
      if (chunk && !canAccessChunk(question.principal, chunk).allowed) {
        violations.push(hit.chunkId);
      }
    }
    const requireAll = question.category === "multi_hop" || question.category === "multi_hop_expanded";
    const abstain = ABSTENTION_CATEGORIES.has(question.category);
    const topCitation = response.hits[0]?.citation;
    const result: QuestionResult = {
      questionId: question.questionId,
      category: question.category,
      recall: abstain ? 0 : recall(ranked, question.expectedDocumentIds, requireAll),
      reciprocalRank: abstain ? 0 : reciprocalRank(ranked, question.expectedDocumentIds),
      ndcg: abstain ? 0 : ndcg(ranked, question.expectedDocumentIds, effectiveTopK, requireAll),
      citationCorrect: abstain ? false : citationCorrect(question, topCitation),
      abstentionCorrect: abstain ? response.hits.length === 0 : false,
      leakedDocumentIds: leaked,
      aclViolationChunkIds: violations,
      topDocumentIds: ranked,
    };
    results.push(result);
  }
  const rankedResults = results.filter((result) => !ABSTENTION_CATEGORIES.has(result.category));
  const abstentionResults = results.filter((result) => ABSTENTION_CATEGORIES.has(result.category));
  return {
    topK: effectiveTopK,
    recallAtK: mean(rankedResults.map((result) => result.recall)),
    mrr: mean(rankedResults.map((result) => result.reciprocalRank)),
    ndcgAtK: mean(rankedResults.map((result) => result.ndcg)),
    citationCorrectness: mean(rankedResults.map((result) => (result.citationCorrect ? 1 : 0))),
    abstentionCorrectness: mean(abstentionResults.map((result) => (result.abstentionCorrect ? 1 : 0))),
    aclLeakCount:
      results.filter((result) => result.leakedDocumentIds.length > 0 || result.aclViolationChunkIds.length > 0).length,
    results,
  };
}
