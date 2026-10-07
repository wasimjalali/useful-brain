import { getCloudflareContext } from "@opennextjs/cloudflare";

import { brainStreamPut } from "@/lib/cf/brain-stream";
import type { BrainService } from "@/lib/cf/service-binding-identity";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function reject(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Streams one upload to Brain. The file is never buffered here: the browser's
 * body goes straight through the service binding into R2. Brain re-checks
 * the session, the admin role and the declared size.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ batchId: string; fileId: string }> },
): Promise<Response> {
  // A cookie-authenticated write from another site is refused outright.
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return reject(403, "FORBIDDEN", "This request came from another site.");
  }
  const { batchId, fileId } = await params;
  if (!ID_PATTERN.test(batchId) || !ID_PATTERN.test(fileId)) {
    return reject(404, "NOT_FOUND", "That resource was not found.");
  }
  const declared = Number(request.headers.get("content-length") ?? "");
  if (!Number.isInteger(declared) || declared < 1 || declared > MAX_UPLOAD_BYTES || !request.body) {
    return reject(400, "VALIDATION_FAILED", "The request is invalid.");
  }
  const { env } = await getCloudflareContext({ async: true });
  const brain = (env as { BRAIN?: BrainService }).BRAIN;
  if (!brain) {
    return reject(503, "UNAVAILABLE", "Brain is not bound to this web worker.");
  }
  const upstream = await brainStreamPut(brain, {
    incomingHeaders: request.headers,
    path: `/admin/uploads/${encodeURIComponent(batchId)}/files/${encodeURIComponent(fileId)}`,
    body: request.body,
    contentLength: declared,
  });
  const headers = new Headers({ "cache-control": "no-store" });
  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  const upstreamRequestId = upstream.headers.get("x-request-id");
  if (upstreamRequestId) {
    headers.set("x-request-id", upstreamRequestId);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
