import { WorkspacePage } from "@/components/workspace/workspace-page";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkspacePage conversationId={id} view="chat" />;
}
