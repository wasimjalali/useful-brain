import { ChatSession } from "@/components/chat/chat-view";

import { chatPageProps, loadChatSuggestions } from "./chat-page-props";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  const { scope } = await searchParams;
  const suggestions = await loadChatSuggestions();
  return (
    <ChatSession
      {...chatPageProps}
      scopeDocumentId={typeof scope === "string" && scope ? scope : null}
      suggestions={suggestions}
    />
  );
}
