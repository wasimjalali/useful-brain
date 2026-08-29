import { redirect } from "next/navigation";

import { loadWorkspaceSnapshot } from "@/app/actions";
import { isRetrievalReady } from "@/lib/rag/workspace-status";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await loadWorkspaceSnapshot();
  redirect(
    isRetrievalReady(snapshot.embeddingStorageStatus) ? "/chat" : "/knowledge",
  );
}
