import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/rag/app-errors";
import { extractUploadedText } from "@/lib/rag/extract-upload";

const brainJson = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/cf/brain-client", () => ({
  brainJson: (...args: unknown[]) => brainJson(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

vi.mock("@/lib/eval/northwind-seed", () => ({
  northwindSeedDocuments: () => [
    {
      documentId: "nw_test",
      title: "Test",
      sourceName: "Test",
      sourcePath: "northwind/test.md",
      accessScope: "public",
      allowedRoles: [],
      allowedDepartments: [],
      body: "Test body.",
      metadata: {},
    },
  ],
}));

describe("extractUploadedText", () => {
  it("reads .md files as plain text and derives a title from the filename", async () => {
    const file = new File(["# Hello\n\nWorld"], "return_policy.md", {
      type: "text/markdown",
    });

    const result = await extractUploadedText(file);

    expect(result.title).toBe("return policy");
    expect(result.markdown).toBe("# Hello\n\nWorld");
  });

  it("reads .txt files as plain text", async () => {
    const file = new File(["Plain body text."], "warranty-notes.txt", {
      type: "text/plain",
    });

    const result = await extractUploadedText(file);

    expect(result.title).toBe("warranty notes");
    expect(result.markdown).toBe("Plain body text.");
  });

  it("normalizes separators and casing quirks in the derived title", async () => {
    const file = new File(["content"], "Shipping_And-Returns.MD", {
      type: "text/markdown",
    });

    const result = await extractUploadedText(file);

    expect(result.title).toBe("Shipping And Returns");
  });

  it("rejects unsupported file extensions", async () => {
    const file = new File(["<html></html>"], "notes.html", {
      type: "text/html",
    });

    await expect(extractUploadedText(file)).rejects.toThrow(
      /unsupported file type/i,
    );
  });

  it("rejects files over the max upload size", async () => {
    const bigContent = "a".repeat(5 * 1024 * 1024 + 1);
    const file = new File([bigContent], "large.txt", { type: "text/plain" });

    await expect(extractUploadedText(file)).rejects.toThrow(/too large/i);
  });

  it("rejects files that extract to empty or whitespace-only text", async () => {
    const file = new File(["   \n\n  "], "empty.md", {
      type: "text/markdown",
    });

    await expect(extractUploadedText(file)).rejects.toThrow(
      /did not contain any readable text/i,
    );
  });
});

describe("addSyntheticDocumentAction", () => {
  beforeEach(() => {
    vi.resetModules();
    brainJson.mockReset();
    revalidatePath.mockReset();
  });

  async function importAction() {
    const mod = await import("./actions");
    return mod.addSyntheticDocumentAction;
  }

  function formDataOf(fields: Record<string, string>) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      formData.set(key, value);
    }
    return formData;
  }

  it("rejects a title over 120 characters", async () => {
    const addSyntheticDocumentAction = await importAction();
    const formData = formDataOf({
      title: "a".repeat(121),
      body: "Some body text.",
    });

    await expect(addSyntheticDocumentAction(formData)).rejects.toThrow(
      /under 120 characters/i,
    );
    expect(brainJson).not.toHaveBeenCalled();
  });

  it("rejects a body over 50,000 characters", async () => {
    const addSyntheticDocumentAction = await importAction();
    const formData = formDataOf({
      title: "Valid Title",
      body: "a".repeat(50_001),
    });

    await expect(addSyntheticDocumentAction(formData)).rejects.toThrow(
      /under 50,000 characters/i,
    );
    expect(brainJson).not.toHaveBeenCalled();
  });

  it("rejects a title that slugifies to empty (no letters or numbers)", async () => {
    const addSyntheticDocumentAction = await importAction();
    const formData = formDataOf({
      title: "!!! *** ???",
      body: "Some body text.",
    });

    await expect(addSyntheticDocumentAction(formData)).rejects.toThrow(
      /letters or numbers/i,
    );
    expect(brainJson).not.toHaveBeenCalled();
  });

  it("slugifies a normal title and merges the document into Brain", async () => {
    brainJson.mockResolvedValue({ generationId: "g-1", chunkCount: 1, vectorize: "skipped" });

    const addSyntheticDocumentAction = await importAction();
    const formData = formDataOf({
      title: "Shipping & Returns Policy!",
      body: "Body text describing the policy.",
    });

    await addSyntheticDocumentAction(formData);

    expect(brainJson).toHaveBeenCalledWith("/knowledge/seed", {
      method: "POST",
      json: {
        merge: true,
        documents: [
          expect.objectContaining({
            documentId: "nw_upload_shipping_returns_policy",
            title: "Shipping & Returns Policy!",
            sourcePath: "northwind/uploads/shipping_returns_policy.md",
            accessScope: "public",
            body: "# Shipping & Returns Policy!\n\nBody text describing the policy.",
          }),
        ],
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("surfaces a clear error when Brain seed fails", async () => {
    brainJson.mockRejectedValue(new Error("model unreachable"));

    const addSyntheticDocumentAction = await importAction();
    const formData = formDataOf({
      title: "Another Policy",
      body: "Body text describing the policy.",
    });

    await expect(addSyntheticDocumentAction(formData)).rejects.toThrow(
      /could not be stored/i,
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("uses the uploaded file's derived title and text when title/body are blank", async () => {
    brainJson.mockResolvedValue({ generationId: "g-1", chunkCount: 1, vectorize: "skipped" });

    const addSyntheticDocumentAction = await importAction();
    const formData = new FormData();
    formData.set("title", "");
    formData.set("body", "");
    formData.set(
      "file",
      new File(["Uploaded document body."], "uploaded_policy.md", {
        type: "text/markdown",
      }),
    );

    await addSyntheticDocumentAction(formData);

    expect(brainJson).toHaveBeenCalledWith("/knowledge/seed", {
      method: "POST",
      json: {
        merge: true,
        documents: [
          expect.objectContaining({
            documentId: "nw_upload_uploaded_policy",
            title: "uploaded policy",
            body: "# uploaded policy\n\nUploaded document body.",
          }),
        ],
      },
    });
  });
});

describe("askGroundedQuestion", () => {
  beforeEach(() => {
    vi.resetModules();
    brainJson.mockReset();
  });

  async function importAction() {
    const mod = await import("./actions");
    return mod.askGroundedQuestion;
  }

  it("returns a serialized success result", async () => {
    const answer = {
      question: "What is the first-response target for a P1 support ticket?",
      answer: "P1 tickets have a first-response target of 1 hour. [1]",
    };
    brainJson.mockResolvedValue(answer);
    const askGroundedQuestion = await importAction();

    const result = await askGroundedQuestion({
      question: "What is the first-response target for a P1 support ticket?",
      conversationId: null,
      requestId: "request-1",
    });

    expect(result).toEqual({ ok: true, data: answer });
    expect(brainJson).toHaveBeenCalledWith(
      "/turns",
      expect.objectContaining({
        method: "POST",
        json: expect.objectContaining({
          question: "What is the first-response target for a P1 support ticket?",
          conversationId: undefined,
          requestId: "request-1",
        }),
      }),
    );
    expect(brainJson.mock.calls[0][1].json).not.toHaveProperty("history");
  });

  it("returns stable provider error data instead of throwing", async () => {
    brainJson.mockRejectedValue(
      new AppError(
        "PROVIDER_TEMPORARY",
        "The model service is temporarily unavailable. Try again.",
        true,
      ),
    );
    const askGroundedQuestion = await importAction();

    const result = await askGroundedQuestion({
      question: "What is the first-response target for a P1 support ticket?",
      conversationId: null,
      requestId: "request-2",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "PROVIDER_TEMPORARY",
        message: "The model service is temporarily unavailable. Try again.",
        retryable: true,
      },
    });
  });

  it("returns a validation error result for an empty question", async () => {
    const askGroundedQuestion = await importAction();

    const result = await askGroundedQuestion({
      question: "   ",
      conversationId: null,
      requestId: "request-3",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Enter a question to get an answer.",
        retryable: false,
      },
    });
    expect(brainJson).not.toHaveBeenCalled();
  });
});

describe("workspace actions", () => {
  beforeEach(() => {
    vi.resetModules();
    brainJson.mockReset();
    revalidatePath.mockReset();
  });

  it("keeps an empty corpus empty and loads operator identity", async () => {
    brainJson.mockImplementation(async (path: string) => {
      if (path === "/knowledge") {
        return {
          documents: [],
          chunks: [],
          embeddingStorageStatus: {
            storedDocuments: 0,
            storedChunks: 0,
            embeddedChunks: 0,
            lastRunStatus: "not_started",
            lastRunMessage: null,
            lastEmbeddedAt: null,
            activeVersionId: null,
            readyVersionId: null,
            corpusStatus: "not_started",
          },
          retrievalMode: "keyword",
        };
      }
      if (path === "/conversations" || path === "/evaluations") {
        return [];
      }
      if (path === "/whoami") {
        return {
          id: "principal-dev",
          kind: "user",
          roles: ["operator"],
          departments: ["support"],
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    const { loadWorkspaceSnapshot } = await import("./actions");

    const snapshot = await loadWorkspaceSnapshot();

    expect(snapshot.documents).toEqual([]);
    expect(snapshot.chunks).toEqual([]);
    expect(snapshot.identity?.id).toBe("principal-dev");
    expect(snapshot.retrievalMode).toBe("keyword");
    expect(snapshot.error).toBeNull();
  });

  it("requests a new ready generation when re-indexing", async () => {
    brainJson.mockResolvedValue({ generationId: "g-ready" });
    const { reindexKnowledgeAction } = await import("./actions");

    await reindexKnowledgeAction();

    expect(brainJson).toHaveBeenCalledWith("/knowledge/reindex", {
      method: "POST",
      json: {},
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
