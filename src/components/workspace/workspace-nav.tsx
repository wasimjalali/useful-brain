import type { ReactNode } from "react";

import { UsefulBrainLogo } from "@/components/useful-brain-logo";
import {
  ChatIcon,
  EvaluationsIcon,
  KnowledgeIcon,
  TrashIcon,
} from "@/components/icons";
import { DEFAULT_USEFUL_BRAIN_CONFIG } from "@/lib/useful-brain-config";
import type { Conversation } from "@/lib/rag/chat-history";

import type { WorkspaceView } from "./workspace-shell";

type NavItem = {
  id: WorkspaceView;
  label: string;
  icon: (props: { className?: string }) => ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  { id: "chat", label: "Chat", icon: ChatIcon },
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
  documentsCount = 0,
  embeddedChunks = 0,
  mobile = false,
  onDeleteConversation = () => {},
  onSelectConversation = () => {},
  onSelectView,
  retrievalReady = true,
}: {
  activeConversationId?: string | null;
  activeView: WorkspaceView;
  conversations?: Conversation[];
  documentsCount?: number;
  embeddedChunks?: number;
  mobile?: boolean;
  onDeleteConversation?: (id: string) => void;
  onSelectConversation?: (id: string) => void;
  onSelectView: (view: WorkspaceView) => void;
  retrievalReady?: boolean;
}) {
  return (
    <aside
      className={[
        "flex w-[264px] shrink-0 flex-col gap-6 border-r border-border bg-surface px-4 py-5",
        mobile ? "h-full" : "hidden lg:flex",
      ].join(" ")}
    >
      <div className="px-2">
        <UsefulBrainLogo />
      </div>

      <nav aria-label="Workspace" className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
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

      {conversations.length > 0 ? (
        <ChatHistoryList
          activeConversationId={activeConversationId}
          conversations={conversations}
          onDelete={onDeleteConversation}
          onSelect={onSelectConversation}
        />
      ) : null}

      <div className="mt-auto flex flex-col gap-3 px-1">
        <div className="flex items-center gap-2 px-1">
          <span
            className={[
              "size-1.5 rounded-full",
              retrievalReady ? "bg-success" : "bg-warning",
            ].join(" ")}
          />
          <span className="text-xs font-medium text-ink-muted">
            {retrievalReady ? "Retrieval ready" : "Setup needed"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <RailStat label="Documents" value={documentsCount.toString()} />
          <RailStat label="Vectors" value={embeddedChunks.toString()} />
        </div>
        <p className="px-1 text-xs leading-5 text-ink-faint">
          Synthetic support documents only. No customer data.
        </p>
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
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Recent
      </p>
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
                    ? "bg-accent-soft text-accent-deep"
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
    </div>
  );
}

function RailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-canvas px-3 py-2.5">
      <p className="text-[11px] font-medium text-ink-faint">{label}</p>
      <p className="tnum mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
