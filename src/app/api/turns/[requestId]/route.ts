import { getCloudflareContext } from "@opennextjs/cloudflare";

import { forwardIdentityToBrain } from "@/lib/cf/service-binding-identity";

type BrainBinding = {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
};

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  const { env } = await getCloudflareContext({ async: true });
  const brain = (env as { BRAIN?: BrainBinding }).BRAIN;
  if (!brain) {
    return Response.json(
      { code: "UNAVAILABLE", message: "Brain is not bound to this web worker." },
      { status: 503 },
    );
  }
  const { requestId } = await params;
  const upstream = await forwardIdentityToBrain(
    brain,
    request,
    `/turns/${encodeURIComponent(requestId)}/progress`,
  );
  // Progress is polled state and must never be served from a cache.
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  const upstreamRequestId = upstream.headers.get("x-request-id");
  if (upstreamRequestId) {
    headers.set("x-request-id", upstreamRequestId);
  }
  headers.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers });
}
