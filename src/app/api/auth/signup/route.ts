import { proxyAuthRequest } from "@/lib/auth/web-auth-proxy";

export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return proxyAuthRequest("/auth/signup", request);
}
