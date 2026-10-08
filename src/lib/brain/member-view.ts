import { isAdminPrincipal } from "../auth/admin";
import type { GroundedAnswerResponse } from "../rag/grounded-answer";

/**
 * Evidence rows shown as admin-only diagnostics carry channel scores, chunk
 * ids and the corpus generation. A turn response for anyone but an admin
 * leaves them out: the chunk id becomes the row's citation label (still
 * unique within the answer, so list keys and citation lookups keep working)
 * and every score collapses to 0. Text, source, section, rank, label and
 * document id are untouched, so citations resolve exactly as before.
 */
export function withMemberEvidenceView<T extends GroundedAnswerResponse>(
  response: T,
  principal: { roles: readonly string[] },
): T {
  if (isAdminPrincipal(principal)) {
    return response;
  }
  const copy = { ...response } as GroundedAnswerResponse;
  delete copy.corpusGenerationId;
  return {
    ...copy,
    retrieval: {
      ...response.retrieval,
      results: response.retrieval.results.map((item) => {
        const visible = { ...item, chunkId: item.citationLabel, score: 0 };
        delete visible.vectorScore;
        delete visible.keywordScore;
        delete visible.fusedScore;
        delete visible.rerankScore;
        return visible;
      }),
    },
  } as T;
}
