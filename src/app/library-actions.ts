"use server";

import { brainJson } from "@/lib/cf/brain-client";
import type { DocumentRequestResponse } from "@/lib/contracts/document-requests";
import type { SearchResponse } from "@/lib/contracts/library";
import { actionFailure, actionSuccess, type ActionResult } from "@/lib/rag/app-errors";

const MIN_QUERY = 2;
const MAX_QUERY = 200;

export async function searchAll(query: string): Promise<ActionResult<SearchResponse>> {
  const q = query.trim();
  if (q.length < MIN_QUERY || q.length > MAX_QUERY) {
    return actionSuccess({ chats: [], documents: [] });
  }
  try {
    return actionSuccess(
      await brainJson<SearchResponse>(`/search?q=${encodeURIComponent(q)}`),
    );
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "Search is unavailable right now.",
      retryable: true,
    });
  }
}

export async function requestDocumentAction(
  question: string,
): Promise<ActionResult<DocumentRequestResponse>> {
  try {
    return actionSuccess(
      await brainJson<DocumentRequestResponse>("/document-requests", {
        method: "POST",
        json: { question },
      }),
    );
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "Couldn't send the request.",
      retryable: true,
    });
  }
}
