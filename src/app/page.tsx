import { getCloudflareContext } from "@opennextjs/cloudflare";
import { redirect } from "next/navigation";

import { loadWorkspaceSnapshot } from "@/app/actions";
import { isRetrievalReady } from "@/lib/rag/workspace-status";

export const dynamic = "force-dynamic";

async function isPublicLandingHost() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as { LOOPBACK_RUNTIME?: string }).LOOPBACK_RUNTIME !== "true";
  } catch {
    return false;
  }
}

export default async function Home() {
  if (await isPublicLandingHost()) {
    redirect("/open");
  }

  const snapshot = await loadWorkspaceSnapshot();
  redirect(
    isRetrievalReady(snapshot.embeddingStorageStatus) ? "/chat" : "/knowledge",
  );
}
