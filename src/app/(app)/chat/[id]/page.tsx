import { getCloudflareContext } from "@opennextjs/cloudflare";

import { loadConversationViewAction } from "@/app/chat-actions";
import { ChatSession } from "@/components/chat/chat-view";
import { isDemoMode } from "@/lib/demo/demo-mode";

import { chatPageProps, loadChatSuggestions } from "../chat-page-props";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  // The demo keeps its sample questions under the answers in saved chats too.
  const demo = isDemoMode(env as { DEMO_MODE?: string });
  const [result, suggestions] = await Promise.all([
    loadConversationViewAction(id),
    demo ? loadChatSuggestions() : Promise.resolve([]),
  ]);
  return (
    <ChatSession
      {...chatPageProps}
      initialConversation={result.ok ? result.data : null}
      key={id}
      loadError={result.ok ? null : result.error.message}
      suggestions={suggestions}
      suggestionsAfterAnswers={demo}
    />
  );
}
