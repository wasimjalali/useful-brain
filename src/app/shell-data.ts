import { cache } from "react";
import { redirect } from "next/navigation";

import type { WorkspaceIdentity } from "@/app/actions";
import { brainJson } from "@/lib/cf/brain-client";
import { AppError } from "@/lib/rag/app-errors";
import type { Conversation } from "@/lib/rag/chat-history";
import {
  emptyEmbeddingStorageStatus,
  type EmbeddingStorageStatus,
} from "@/lib/rag/storage-records";
import { isRetrievalReady } from "@/lib/rag/workspace-status";
import type { KnowledgeInventory } from "@/lib/store/knowledge-inventory";

export type ShellData = {
  identity: WorkspaceIdentity | null;
  conversations: Array<Pick<Conversation, "id" | "title" | "createdAt" | "updatedAt">>;
  embeddingStorageStatus: EmbeddingStorageStatus;
  retrievalMode: KnowledgeInventory["retrievalMode"];
  retrievalReady: boolean;
  error: string | null;
};

function rethrowAuth(error: unknown): void {
  if (error instanceof AppError && error.code === "AUTH_REQUIRED") {
    redirect("/login");
  }
}

/**
 * Who is asking. Redirects to /login when there is no session. Any other
 * failure returns null, which every caller treats as "not allowed".
 */
export const loadIdentity = cache(async (): Promise<WorkspaceIdentity | null> => {
  try {
    return await brainJson<WorkspaceIdentity>("/whoami");
  } catch (error) {
    rethrowAuth(error);
    return null;
  }
});

/** Where `/` sends a signed-in person. */
export function homeDestination(input: {
  isAdmin: boolean;
  retrievalReady: boolean;
}): "/chat" | "/admin/sources" {
  return input.isAdmin && !input.retrievalReady ? "/admin/sources" : "/chat";
}

/**
 * Admins only: the corpus status behind the setup notice and Settings.
 * Members never call Brain `/knowledge`, because it ships the whole inventory.
 */
async function loadCorpusStatus(): Promise<{
  embeddingStorageStatus: EmbeddingStorageStatus;
  retrievalMode: KnowledgeInventory["retrievalMode"];
}> {
  const inventory = await brainJson<KnowledgeInventory>("/knowledge");
  return {
    embeddingStorageStatus: inventory.embeddingStorageStatus,
    retrievalMode: inventory.retrievalMode,
  };
}

export async function loadHomeDestination(): Promise<"/chat" | "/admin/sources"> {
  const identity = await loadIdentity();
  if (!identity?.isAdmin) {
    return "/chat";
  }
  try {
    const { embeddingStorageStatus } = await loadCorpusStatus();
    return homeDestination({
      isAdmin: true,
      retrievalReady: isRetrievalReady(embeddingStorageStatus),
    });
  } catch (error) {
    rethrowAuth(error);
    return "/admin/sources";
  }
}

/** Everything the shell layout needs, loaded once per full page load. */
export async function loadShellData(): Promise<ShellData> {
  try {
    const [identity, conversations] = await Promise.all([
      brainJson<WorkspaceIdentity>("/whoami"),
      brainJson<ShellData["conversations"]>("/conversations"),
    ]);
    let corpus: Awaited<ReturnType<typeof loadCorpusStatus>> | null = null;
    if (identity.isAdmin) {
      corpus = await loadCorpusStatus();
    }
    return {
      identity,
      conversations,
      embeddingStorageStatus: corpus?.embeddingStorageStatus ?? emptyEmbeddingStorageStatus,
      retrievalMode: corpus?.retrievalMode ?? "keyword",
      retrievalReady: corpus ? isRetrievalReady(corpus.embeddingStorageStatus) : true,
      error: null,
    };
  } catch (error) {
    rethrowAuth(error);
    return {
      identity: null,
      conversations: [],
      embeddingStorageStatus: emptyEmbeddingStorageStatus,
      retrievalMode: "keyword",
      retrievalReady: true,
      error: "Useful Brain could not load the workspace.",
    };
  }
}

/** Admin pages only: the full document inventory. */
export async function loadKnowledgeInventory(): Promise<KnowledgeInventory> {
  try {
    return await brainJson<KnowledgeInventory>("/knowledge");
  } catch (error) {
    rethrowAuth(error);
    throw error;
  }
}
