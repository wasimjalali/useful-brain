import { getCloudflareContext } from "@opennextjs/cloudflare";

import { ChatSession } from "@/components/chat/chat-view";
import { isDemoMode } from "@/lib/demo/demo-mode";

import { chatPageProps, loadChatSuggestions } from "./chat-page-props";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  const { scope } = await searchParams;
  const suggestions = await loadChatSuggestions();
  const { env } = await getCloudflareContext({ async: true });
  return (
    <ChatSession
      {...chatPageProps}
      scopeDocumentId={typeof scope === "string" && scope ? scope : null}
      suggestions={suggestions}
      suggestionsAfterAnswers={isDemoMode(env as { DEMO_MODE?: string })}
    />
  );
}
