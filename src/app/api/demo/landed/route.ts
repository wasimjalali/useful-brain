import { getCloudflareContext } from "@opennextjs/cloudflare";

import { demoLandedResponse } from "@/lib/demo/demo-sign-in";

export const dynamic = "force-dynamic";

/** Where the demo sign-in lands: on to the page with the new cookie, or a cookie notice without it. */
export async function GET(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext({ async: true });
  return demoLandedResponse(request, env as { DEMO_MODE?: string });
}
