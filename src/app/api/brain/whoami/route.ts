import { getCloudflareContext } from "@opennextjs/cloudflare";

import { forwardIdentityToBrain } from "@/lib/cf/service-binding-identity";

type BrainBinding = {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
};

export async function GET(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext({ async: true });
  const brain = (env as { BRAIN?: BrainBinding }).BRAIN;
  if (!brain) {
    return Response.json(
      { code: "UNAVAILABLE", message: "Brain is not bound to this web worker." },
      { status: 503 },
    );
  }
  return forwardIdentityToBrain(brain, request);
}
