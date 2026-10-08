import { BoundedIdError, parseBoundedId } from "../../../../src/lib/cf/bounded-id";
import { writeOperationalLog } from "../../../../src/lib/cf/operational-log";
import { withRequestId } from "../../../../src/lib/cf/request-id";
import { WorkerNotFoundError, WorkerValidationError } from "../../../../src/lib/cf/worker-errors";
import type { DirectoryRecord } from "../../../../src/lib/auth/principal";
import type { SearchResponse } from "../../../../src/lib/contracts/library";
import { activeGenerationId, type SqlExecutor } from "../../../../src/lib/store/corpus-d1";
import type { OperationsDatabase } from "../../../../src/lib/store/conversations";
import {
  documentResponse,
  listLibrary,
  loadReadableDocument,
  loadReliedOnSpans,
  searchChats,
  searchDocuments,
  searchTokens,
} from "../../../../src/lib/store/library-queries";

type LibraryEnv = { CORPUS_DB?: unknown; OPERATIONS_DB: unknown };

const MIN_QUERY = 2;
const MAX_QUERY = 200;

function json(body: unknown, requestId: string): Response {
  const response = Response.json(body, { headers: withRequestId(new Headers(), requestId) });
  response.headers.set("cache-control", "no-store");
  return response;
}

/**
 * Library list, document reader and global search. Returns null for paths it
 * does not own. Every corpus read applies the caller's ACL in SQL against the
 * active generation, so an unreadable id is indistinguishable from an unknown one.
 */
export async function handleLibraryRoute(input: {
  request: Request;
  path: string;
  env: LibraryEnv;
  principal: DirectoryRecord;
  requestId: string;
  started: number;
}): Promise<Response | null> {
  const { request, path, env, principal, requestId, started } = input;
  if (request.method !== "GET") {
    return null;
  }
  const documentMatch = path.match(/^\/documents\/([^/]+)$/);
  if (path !== "/library" && path !== "/search" && !documentMatch) {
    return null;
  }
  const url = new URL(request.url);
  const operations = env.OPERATIONS_DB as OperationsDatabase;
  const corpus = env.CORPUS_DB as SqlExecutor | undefined;
  const generationId = corpus ? await activeGenerationId(corpus) : null;
  const reader = {
    userId: principal.id,
    roles: principal.roles,
    departments: principal.departments,
  };
  const done = (operation: string) =>
    writeOperationalLog({
      requestId,
      principalKind: principal.kind,
      operation,
      status: "ok",
      durationMs: Date.now() - started,
    });

  if (path === "/library") {
    const documents = corpus && generationId ? await listLibrary(corpus, generationId, reader) : [];
    done("library");
    return json({ documents }, requestId);
  }

  if (path === "/search") {
    const query = (url.searchParams.get("q") ?? "").trim();
    if (query.length < MIN_QUERY || query.length > MAX_QUERY) {
      throw new WorkerValidationError();
    }
    const tokens = searchTokens(query);
    const [chats, documents] = await Promise.all([
      searchChats(operations, principal.id, query),
      corpus && generationId ? searchDocuments(corpus, generationId, reader, tokens) : [],
    ]);
    done("search");
    return json({ chats, documents } satisfies SearchResponse, requestId);
  }

  let documentId: string;
  try {
    documentId = parseBoundedId(decodeURIComponent(documentMatch![1]), "document id");
  } catch (error) {
    if (error instanceof BoundedIdError || error instanceof URIError) {
      throw new WorkerNotFoundError();
    }
    throw error;
  }
  if (!corpus || !generationId) {
    throw new WorkerNotFoundError();
  }
  const loaded = await loadReadableDocument(corpus, generationId, reader, documentId);
  const response = documentResponse(loaded);
  const messageParam = url.searchParams.get("message");
  if (messageParam !== null) {
    let messageId: string;
    try {
      messageId = parseBoundedId(messageParam, "message id");
    } catch {
      throw new WorkerNotFoundError();
    }
    const spans = await loadReliedOnSpans(
      operations,
      corpus,
      generationId,
      reader,
      loaded,
      messageId,
      url.searchParams.get("citation"),
    );
    if (spans) {
      response.spans = spans;
    }
  }
  done("document");
  return json(response, requestId);
}
