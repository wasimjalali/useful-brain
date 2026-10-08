"use client";

import Link from "next/link";
import type { RefObject } from "react";

import type { WorkspaceIdentity } from "@/app/actions";
import { SettingsIcon, TrashIcon, XIcon } from "@/components/icons";
import { UsefulBrainMarkPaths } from "@/components/useful-brain-logo";
import { IconButton } from "@/components/ui/button";
import { capitalize, initials } from "@/lib/format";
import { groupConversations } from "@/lib/chat/groups";
import { DEFAULT_USEFUL_BRAIN_CONFIG } from "@/lib/useful-brain-config";

import { ADMIN_NAV, PRIMARY_NAV, type NavItem } from "./nav";
import { shortcutLabel, useIsMac } from "./platform";
import type { ConversationSummary } from "./shell-context";

export type RailProps = {
  conversations: ConversationSummary[];
  conversationError?: string | null;
  identity: WorkspaceIdentity | null;
  /** Below 1200px the rail is a slide-over and gets a close button. */
  overlay?: boolean;
  /** True while the slide-over is open: it becomes a modal dialog. */
  modal?: boolean;
  now: number;
  pathname: string;
  railRef?: RefObject<HTMLElement | null>;
  onClose?: () => void;
  onDeleteConversation: (id: string) => void;
  onNavigate?: () => void;
  onNewChat: () => void;
  onSearch: () => void;
  onSettings: () => void;
};

function isActive(item: NavItem, pathname: string): boolean {
  if (!item.href) {
    return false;
  }
  return item.id === "new"
    ? pathname === "/chat"
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function Rail({
  conversationError = null,
  conversations,
  identity,
  modal = false,
  now,
  onClose,
  onDeleteConversation,
  onNavigate,
  onNewChat,
  onSearch,
  onSettings,
  overlay = false,
  pathname,
  railRef,
}: RailProps) {
  const isMac = useIsMac();
  const groups = groupConversations(conversations, now);
  const name = identity?.name ?? identity?.subject ?? identity?.id ?? "Operator";
  const role = identity?.isAdmin
    ? "Admin"
    : identity?.department
      ? capitalize(identity.department)
      : null;

  return (
    <aside
      aria-label={modal ? "Navigation" : "Workspace"}
      aria-modal={modal ? "true" : undefined}
      className="ub-rail"
      id="app-rail"
      ref={railRef}
      role={modal ? "dialog" : undefined}
      tabIndex={modal ? -1 : undefined}
    >
      <div className="ub-rail-logo">
        <svg
          aria-hidden="true"
          className="ub-rail-mark"
          fill="none"
          viewBox="0 0 220 242"
        >
          <UsefulBrainMarkPaths ink="currentColor" quote="currentColor" />
        </svg>
        <span className="ub-rail-wordmark">
          {DEFAULT_USEFUL_BRAIN_CONFIG.productName}
        </span>
        {overlay ? (
          <span className="ub-rail-close">
            <IconButton aria-label="Close menu" onClick={onClose}>
              <XIcon className="size-[18px]" />
            </IconButton>
          </span>
        ) : null}
      </div>

      <nav aria-label="Primary" className="ub-rail-group">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const hint = item.shortcut ? shortcutLabel(isMac, item.shortcut) : null;
          const content = (
            <>
              <span className="ub-row-icon">
                <Icon className="size-4" />
              </span>
              <span className="ub-row-label">{item.label}</span>
              {hint ? (
                <span aria-hidden="true" className="ub-row-kbd">
                  {hint}
                </span>
              ) : null}
            </>
          );
          const shortcutKey = item.shortcut
            ? `${isMac ? "Meta" : "Control"}+${item.shortcut}`
            : undefined;
          if (item.id === "search") {
            return (
              <button
                aria-keyshortcuts={shortcutKey}
                className="ub-row ub-ring"
                key={item.id}
                onClick={() => {
                  onNavigate?.();
                  onSearch();
                }}
                type="button"
              >
                {content}
              </button>
            );
          }
          return (
            <Link
              aria-current={isActive(item, pathname) ? "page" : undefined}
              aria-keyshortcuts={shortcutKey}
              className="ub-row ub-ring"
              data-nav="true"
              href={item.href}
              key={item.id}
              onClick={() => {
                if (item.id === "new") {
                  onNewChat();
                }
                onNavigate?.();
              }}
            >
              {content}
            </Link>
          );
        })}
      </nav>

      {identity?.isAdmin ? (
        <nav aria-label="Admin" className="ub-rail-section">
          <p className="ub-rail-label">Admin</p>
          <div className="ub-rail-group">
            {ADMIN_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  aria-current={isActive(item, pathname) ? "page" : undefined}
                  className="ub-row ub-ring"
                  data-nav="true"
                  href={item.href}
                  key={item.id}
                  onClick={onNavigate}
                >
                  <span className="ub-row-icon">
                    <Icon className="size-4" />
                  </span>
                  <span className="ub-row-label">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}

      <div aria-label="Chats" className="ub-rail-chats uv-scroll" role="region">
        {groups.length === 0 ? (
          <p className="ub-rail-empty">Questions you ask show up here.</p>
        ) : (
          groups.map((group) => (
            <section aria-label={group.label} className="ub-rail-section" key={group.label}>
              <p className="ub-rail-label">{group.label}</p>
              <ul className="ub-rail-group">
                {group.items.map((conversation) => (
                  <li className="ub-chat-wrap" key={conversation.id}>
                    <Link
                      aria-current={
                        pathname === `/chat/${conversation.id}` ? "page" : undefined
                      }
                      className="ub-row ub-chat-row ub-ring"
                      data-nav="true"
                      href={`/chat/${conversation.id}`}
                      onClick={onNavigate}
                    >
                      <span className="ub-row-label">{conversation.title}</span>
                    </Link>
                    <span className="ub-chat-delete">
                      <IconButton
                        aria-label={`Delete chat: ${conversation.title}`}
                        onClick={() => onDeleteConversation(conversation.id)}
                      >
                        <TrashIcon className="size-3.5" />
                      </IconButton>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {conversationError ? (
          <p className="ub-rail-error" role="alert">
            {conversationError}
          </p>
        ) : null}
      </div>

      <div className="ub-rail-profile">
        <span aria-hidden="true" className="ub-avatar">
          {initials(name)}
        </span>
        <div className="ub-profile-text">
          <span className="ub-profile-name">{name}</span>
          {role ? <span className="ub-profile-role">{role}</span> : null}
        </div>
        <IconButton aria-label="Settings" onClick={onSettings}>
          <SettingsIcon className="size-4" />
        </IconButton>
      </div>
    </aside>
  );
}
