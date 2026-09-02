import type { ReactNode } from "react";

import { UsefulBrainLogo } from "@/components/useful-brain-logo";
import {
  ChatIcon,
  EvaluationsIcon,
  KnowledgeIcon,
  NewChatIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
} from "@/components/icons";
import { DEFAULT_USEFUL_BRAIN_CONFIG } from "@/lib/useful-brain-config";
import type { Conversation } from "@/lib/rag/chat-history";

import type { WorkspaceView } from "./workspace-shell";

type PageItem = {
  id: Extract<WorkspaceView, "knowledge" | "evaluations">;
  label: string;
  icon: (props: { className?: string }) => ReactNode;
};

const PAGE_ITEMS: PageItem[] = [
  {
    id: "knowledge",
    label: DEFAULT_USEFUL_BRAIN_CONFIG.knowledgeLabel,
    icon: KnowledgeIcon,
  },
  {
    id: "evaluations",
    label: DEFAULT_USEFUL_BRAIN_CONFIG.evaluationsLabel,
    icon: EvaluationsIcon,
  },
];

export function WorkspaceNav({
  activeConversationId = null,
  activeView,
  conversations = [],
  conversationError = null,
  mobile = false,
  onDeleteConversation = () => {},
  onNewChat = () => {},
  onOpenSettings = () => {},
  onSearch = () => {},
  onSelectConversation = () => {},
  onSelectView,
  operatorLabel = "Operator",
  retrievalReady = true,
}: {
  activeConversationId?: string | null;
  activeView: WorkspaceView;
  conversations?: Conversation[];
  conversationError?: string | null;
  mobile?: boolean;
  onDeleteConversation?: (id: string) => void;
  onNewChat?: () => void;
  onOpenSettings?: () => void;
  onSearch?: () => void;
  onSelectConversation?: (id: string) => void;
  onSelectView: (view: WorkspaceView) => void;
  operatorLabel?: string;
  retrievalReady?: boolean;
}) {
  return (
    <aside
      className={[
        "flex w-[248px] shrink-0 flex-col gap-5 px-3 py-4",
        mobile ? "h-full bg-canvas" : "hidden lg:flex",
      ].join(" ")}
    >
      <div className="px-2 pt-1">
        <UsefulBrainLogo />
      </div>

      <nav aria-label="Workspace" className="flex flex-col gap-0.5">
        <button className="nav-item text-sm" onClick={onNewChat} type="button">
          <NewChatIcon className="size-[18px] shrink-0" />
          <span>New chat</span>
        </button>
        <button className="nav-item text-sm" onClick={onSearch} type="button">
          <SearchIcon className="size-[18px] shrink-0" />
          <span>Search</span>
        </button>
        {PAGE_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          return (
            <button
              aria-current={active ? "page" : undefined}
              className="nav-item text-sm"
              key={item.id}
              onClick={() => onSelectView(item.id)}
              type="button"
            >
              <Icon className="size-[18px] shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <p className="px-2 text-[11px] text-ink-faint">Recents</p>
        {conversations.length > 0 ? (
          <ChatHistoryList
            activeConversationId={
              activeView === "chat" ? activeConversationId : null
            }
            conversations={conversations}
            onDelete={onDeleteConversation}
            onSelect={onSelectConversation}
          />
        ) : (
          <p className="px-2 text-xs leading-5 text-ink-faint">
            Chats will appear here.
          </p>
        )}
        {conversationError ? (
          <p className="px-2 text-xs leading-5 text-danger" role="alert">
            {conversationError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <div className="rail-group">
          <button
            aria-current={activeView === "settings" ? "page" : undefined}
            className="nav-item w-full text-sm"
            onClick={onOpenSettings}
            type="button"
          >
            <SettingsIcon className="size-[18px] shrink-0" />
            <span>Settings</span>
          </button>
        </div>
        <div className="flex items-center gap-2.5 rounded-2xl px-2 py-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-xs font-semibold text-ink">
            {operatorInitial(operatorLabel)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{operatorLabel}</p>
            <p className="text-[11px] text-ink-faint">
              {retrievalReady ? "Retrieval ready" : "Setup needed"}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function ChatHistoryList({
  activeConversationId,
  conversations,
  onDelete,
  onSelect,
}: {
  activeConversationId: string | null;
  conversations: Conversation[];
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="-mr-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
      {conversations.map((conversation) => {
        const active = conversation.id === activeConversationId;
        return (
          <div className="group relative" key={conversation.id}>
            <button
              aria-current={active ? "true" : undefined}
              className={[
                "flex w-full items-center gap-2.5 rounded-lg py-1.5 pl-2.5 pr-8 text-left text-[13px] transition",
                active
                  ? "bg-sunken text-ink"
                  : "text-ink-muted hover:bg-sunken hover:text-ink",
              ].join(" ")}
              onClick={() => onSelect(conversation.id)}
              type="button"
            >
              <ChatIcon className="size-4 shrink-0 opacity-70" />
              <span className="truncate">{conversation.title}</span>
            </button>
            <button
              aria-label={`Delete chat: ${conversation.title}`}
              className="icon-btn absolute right-1 top-1/2 size-6 -translate-y-1/2 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100"
              onClick={() => onDelete(conversation.id)}
              type="button"
            >
              <TrashIcon className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function operatorInitial(label: string) {
  const trimmed = label.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "O";
}
