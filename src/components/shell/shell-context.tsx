"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import type { WorkspaceIdentity } from "@/app/actions";
import type { Conversation } from "@/lib/rag/chat-history";

export type ConversationSummary = Pick<
  Conversation,
  "id" | "title" | "createdAt" | "updatedAt"
>;

export type PanelRegistration = { label: string; onClose: () => void };

export type ShellContextValue = {
  identity: WorkspaceIdentity | null;
  conversations: ConversationSummary[];
  /** False only for an admin whose corpus has no active generation. */
  retrievalReady: boolean;
  upsertConversation: (id: string, title: string) => void;
  removeConversation: (id: string) => Promise<string | null>;
  conversationError: string | null;
  /** Bumped by New chat so a mounted chat view resets even on the same URL. */
  newChatNonce: number;
  newChat: () => void;
  openSearch: () => void;
  openSettings: () => void;
  panelHost: HTMLElement | null;
  registerPanel: (registration: PanelRegistration | null) => void;
};

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) {
    throw new Error("useShell must be used inside <AppShell>.");
  }
  return value;
}

/**
 * Fills the shell's evidence slot. The shell decides where it lives: a 380px
 * second stage on wide screens, a right sheet or a bottom sheet below that.
 * Later phases render their panel through this component.
 */
export function ShellPanel({
  children,
  label,
  onClose,
  open,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  open: boolean;
}) {
  const { panelHost, registerPanel } = useShell();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    registerPanel({ label, onClose: () => onCloseRef.current() });
    return () => registerPanel(null);
  }, [label, open, registerPanel]);

  if (!open || !panelHost) {
    return null;
  }
  return createPortal(children, panelHost);
}
