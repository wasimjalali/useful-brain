import { proxyLogoutRequest } from "@/lib/auth/web-auth-proxy";

export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return proxyLogoutRequest(request);
}
