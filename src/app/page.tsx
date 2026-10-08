import { cookies } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { redirect } from "next/navigation";

import { loadHomeDestination } from "@/app/shell-data";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";

export const dynamic = "force-dynamic";

async function homeTarget(): Promise<"open" | "login" | "workspace"> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const identityMode = (env as { IDENTITY_MODE?: string }).IDENTITY_MODE;
    const loopback = (env as { LOOPBACK_RUNTIME?: string }).LOOPBACK_RUNTIME === "true";
    if (identityMode === "session") {
      const jar = await cookies();
      return jar.get(SESSION_COOKIE_NAME)?.value ? "workspace" : "login";
    }
    if (!loopback) {
      return "open";
    }
    return "workspace";
  } catch {
    return "open";
  }
}

export default async function Home() {
  const target = await homeTarget();
  if (target === "open") {
    redirect("/open");
  }
  if (target === "login") {
    redirect("/login");
  }

  redirect(await loadHomeDestination());
}
