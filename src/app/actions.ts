"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { brainJson } from "@/lib/cf/brain-client";
import {
  actionFailure,
  actionSuccess,
  AppError,
  toPublicAppError,
  type ActionResult,
  type PublicAppError,
} from "@/lib/rag/app-errors";
import { extractUploadedText, MAX_DOCUMENT_TEXT_CHARS } from "@/lib/rag/extract-upload";
import type { GroundedAnswerResponse } from "@/lib/rag/grounded-answer";
import type { Conversation } from "@/lib/rag/chat-history";
import { emptyEmbeddingStorageStatus, type EmbeddingStorageStatus } from "@/lib/rag/storage-records";
import type { DocumentChunk, KnowledgeDocument } from "@/lib/rag/types";
import { northwindSeedDocuments } from "@/lib/eval/northwind-seed";
import type { SeedDocumentInput } from "@/lib/store/corpus-seed";
import type { EvalRunResult } from "@/lib/eval/manual-eval-set";
import type { KnowledgeInventory } from "@/lib/store/knowledge-inventory";

const MAX_QUESTION_LENGTH = 2000;

export type WorkspaceIdentity = {
  id: string;
  kind: "user" | "service_token";
  subject?: string;
  roles: string[];
  departments: string[];
};

function revalidateWorkspace() {
  revalidatePath("/", "layout");
}

export async function embedSyntheticDocumentsAction() {
  try {
    await brainJson("/knowledge/seed", {
      method: "POST",
      json: { documents: northwindSeedDocuments() },
    });
  } catch (error) {
    const inProgress =
      error instanceof Error && error.message.includes("already in progress");
    throwPublicAppError(
      error,
      inProgress
        ? {
            code: "RATE_LIMITED",
            message: "An indexing run is already in progress. Try again in a moment.",
            retryable: true,
          }
        : {
            code: "PROVIDER_TEMPORARY",
            message: "Indexing failed. Check the model connection and try again.",
            retryable: true,
          },
    );
  }
  revalidateWorkspace();
}

export async function reindexKnowledgeAction() {
  try {
    await brainJson("/knowledge/reindex", { method: "POST", json: {} });
  } catch (error) {
    throwPublicAppError(error, {
      code: "PROVIDER_TEMPORARY",
      message: "The knowledge base could not be re-indexed.",
      retryable: true,
    });
  }
  revalidateWorkspace();
}

export async function promoteCorpusVersionAction(versionId: string) {
  try {
    await brainJson("/knowledge/promote", { method: "POST", json: { generationId: versionId } });
  } catch (error) {
    throwPublicAppError(error, {
      code: "INTERNAL_ERROR",
      message: "The ready corpus could not be promoted.",
      retryable: true,
    });
  }
  revalidateWorkspace();
}

export async function askGroundedQuestion(input: {
  question: string;
  conversationId: string | null;
  requestId: string;
  assumePrincipal?: { userId: string; roles: string[]; departments: string[] } | null;
}): Promise<ActionResult<GroundedAnswerResponse>> {
  const question = input.question.trim();

  if (!question) {
    return actionFailure(
      new AppError("VALIDATION_FAILED", "Enter a question to get an answer.", false),
    );
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    return actionFailure(
      new AppError(
        "VALIDATION_FAILED",
        `That question is too long. Keep it under ${MAX_QUESTION_LENGTH} characters.`,
        false,
      ),
    );
  }

  try {
    return actionSuccess(
      await brainJson<GroundedAnswerResponse>("/turns", {
        method: "POST",
        json: {
          question,
          conversationId: input.conversationId ?? undefined,
          requestId: input.requestId,
          assumePrincipal: input.assumePrincipal ?? undefined,
        },
      }),
    );
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "The answer could not be generated.",
      retryable: false,
    });
  }
}

export async function cancelGroundedQuestionAction(
  requestId: string,
): Promise<ActionResult<{ conversationId: string }>> {
  try {
    return actionSuccess(
      await brainJson<{ conversationId: string }>("/cancel", {
        method: "POST",
        json: { requestId },
      }),
    );
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "The answer could not be stopped.",
      retryable: true,
    });
  }
}

export async function loadConversationAction(conversationId: string) {
  try {
    return actionSuccess(
      await brainJson<Conversation>(`/conversations/${conversationId}`),
    );
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "The conversation could not be loaded.",
      retryable: true,
    });
  }
}

export async function deleteConversationAction(conversationId: string) {
  try {
    await brainJson(`/conversations/${conversationId}`, { method: "DELETE" });
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "The conversation could not be deleted.",
      retryable: true,
    });
  }
}

export async function deleteKnowledgeDocumentAction(documentId: string) {
  try {
    await brainJson(`/knowledge/documents/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
    });
    revalidateWorkspace();
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "The document could not be deleted.",
      retryable: true,
    });
  }
}

export async function importLegacyConversationsAction(
  conversations: Conversation[],
) {
  void conversations;
  return actionSuccess(null);
}

export async function addSyntheticDocumentAction(formData: FormData) {
  let title = String(formData.get("title") ?? "").trim();
  let body = String(formData.get("body") ?? "").trim();

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const extracted = await extractUploadedText(file);
    title = title || extracted.title;
    body = extracted.markdown.trim();
  }

  if (!title || !body) {
    throw new AppError("VALIDATION_FAILED", "A title and document text are both required.", false);
  }

  if (title.length > 120) {
    throw new AppError("VALIDATION_FAILED", "Keep the title under 120 characters.", false);
  }

  if (body.length > MAX_DOCUMENT_TEXT_CHARS) {
    throw new AppError(
      "VALIDATION_FAILED",
      "That document is larger than one knowledge document can hold (about 1.5 million characters). Split it into parts and upload each part.",
      false,
    );
  }

  const document = seedDocumentFromUpload(title, body);

  try {
    await brainJson("/knowledge/seed", {
      method: "POST",
      json: { merge: true, documents: [document] },
    });
  } catch {
    throw new AppError(
      "PROVIDER_TEMPORARY",
      "The document could not be stored. Try again from the Knowledge view.",
      true,
    );
  }

  revalidateWorkspace();
}

export async function signOutAction() {
  try {
    await brainJson("/auth/logout", { method: "POST", json: {} });
  } catch {
    // Browser cookie is cleared below either way.
  }
  const { cookies } = await import("next/headers");
  const { SESSION_COOKIE_NAME } = await import("@/lib/auth/session-cookie");
  const jar = await cookies();
  jar.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}

export async function loadWorkspaceSnapshot(): Promise<{
  documents: KnowledgeDocument[];
  chunks: DocumentChunk[];
  embeddingStorageStatus: EmbeddingStorageStatus;
  conversations: Conversation[];
  evalRuns: EvalRunResult[];
  identity: WorkspaceIdentity | null;
  retrievalMode: KnowledgeInventory["retrievalMode"];
  error: string | null;
}> {
  try {
    const [inventory, conversations, evalRuns, identity] = await Promise.all([
      brainJson<KnowledgeInventory>("/knowledge"),
      brainJson<Array<Pick<Conversation, "id" | "title" | "createdAt" | "updatedAt">>>(
        "/conversations",
      ),
      brainJson<EvalRunResult[]>("/evaluations"),
      brainJson<WorkspaceIdentity>("/whoami"),
    ]);
    return {
      documents: inventory.documents,
      chunks: inventory.chunks,
      embeddingStorageStatus: inventory.embeddingStorageStatus,
      conversations: conversations.map((conversation) => ({ ...conversation, turns: [] })),
      evalRuns,
      identity,
      retrievalMode: inventory.retrievalMode,
      error: null,
    };
  } catch (error) {
    if (error instanceof AppError && error.code === "AUTH_REQUIRED") {
      redirect("/login");
    }
    return {
      documents: [],
      chunks: [],
      embeddingStorageStatus: emptyEmbeddingStorageStatus,
      conversations: [],
      evalRuns: [],
      identity: null,
      retrievalMode: "keyword",
      error: "Useful Brain could not load the operator workspace.",
    };
  }
}

function seedDocumentFromUpload(title: string, body: string): SeedDocumentInput {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  if (!slug) {
    throw new AppError("VALIDATION_FAILED", "Use a title that contains letters or numbers.", false);
  }

  const documentId = `nw_upload_${slug}`;
  const markdown = body.startsWith("# ") ? body : `# ${title}\n\n${body}`;
  return {
    documentId,
    title,
    sourceName: title,
    sourcePath: `northwind/uploads/${slug}.md`,
    accessScope: "public",
    allowedRoles: [],
    allowedDepartments: [],
    body: markdown,
    metadata: {
      document_id: documentId,
      title,
      source_name: title,
      source_path: `northwind/uploads/${slug}.md`,
      department: "support",
      access_scope: "public",
      allowed_roles: [],
      allowed_departments: [],
    },
  };
}

function throwPublicAppError(error: unknown, fallback: PublicAppError): never {
  const publicError = toPublicAppError(error, fallback);
  throw new AppError(publicError.code, publicError.message, publicError.retryable);
}
