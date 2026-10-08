import { loadConversationViewAction } from "@/app/chat-actions";
import { ChatSession } from "@/components/chat/chat-view";

import { chatPageProps } from "../chat-page-props";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await loadConversationViewAction(id);
  return (
    <ChatSession
      {...chatPageProps}
      initialConversation={result.ok ? result.data : null}
      key={id}
      loadError={result.ok ? null : result.error.message}
    />
  );
}
