import type { ReactNode } from "react";

import { deleteConversationAction } from "@/app/actions";
import { loadShellData } from "@/app/shell-data";
import { AppShell } from "@/components/shell/app-shell";
import { WorkspaceLoadError } from "@/components/shell/workspace-load-error";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const data = await loadShellData();
  return (
    <AppShell
      deleteConversationAction={deleteConversationAction}
      embeddingStorageStatus={data.embeddingStorageStatus}
      identity={data.identity}
      initialConversations={data.conversations}
      retrievalMode={data.retrievalMode}
      retrievalReady={data.retrievalReady}
    >
      {data.error ? <WorkspaceLoadError message={data.error} /> : children}
    </AppShell>
  );
}
