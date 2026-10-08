import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";

import { hostAllowedForRuntime } from "@/lib/cf/loopback-host";

/**
 * App-wide DNS-rebinding guard (pages, server actions and route handlers). In
 * loopback mode only loopback Host values are served; session mode passes through.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { env } = await getCloudflareContext({ async: true });
  const host = request.headers.get("host") ?? request.nextUrl.host;
  if (!hostAllowedForRuntime(env as { LOOPBACK_RUNTIME?: string }, host)) {
    return new NextResponse("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
