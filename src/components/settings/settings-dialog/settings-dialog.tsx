"use client";

import { useState, type ReactNode } from "react";

import {
  CpuIcon,
  LockIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PlugIcon,
  SunIcon,
  UserRoundIcon,
  XIcon,
} from "@/components/icons";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { StatusDot, type StatusTone } from "@/components/ui/status";
import type {
  SettingsAccount,
  SettingsConnector,
  SettingsModelConfig,
  SettingsSection,
} from "@/lib/contracts/settings-view";
import { useTheme, type ThemeChoice } from "@/lib/theme";

const THEME_OPTIONS = [
  { value: "system", label: "System", icon: <MonitorIcon className="size-4" /> },
  { value: "light", label: "Light", icon: <SunIcon className="size-4" /> },
  { value: "dark", label: "Dark", icon: <MoonIcon className="size-4" /> },
];

const CONNECTOR_STATUS: Record<
  SettingsConnector["status"],
  { label: string; tone: StatusTone }
> = {
  active: { label: "Active", tone: "success" },
  connected: { label: "Connected", tone: "success" },
  not_connected: { label: "Not connected", tone: "faint" },
};

type NavItem = { id: SettingsSection; label: string; icon: ReactNode };

const GENERAL_NAV: NavItem[] = [
  { id: "appearance", label: "Appearance", icon: <SunIcon className="size-4" /> },
  { id: "account", label: "Account", icon: <UserRoundIcon className="size-4" /> },
];
const ADMIN_NAV: NavItem[] = [
  { id: "model", label: "Model and retrieval", icon: <CpuIcon className="size-4" /> },
  { id: "connectors", label: "Connectors", icon: <PlugIcon className="size-4" /> },
];

export function SettingsDialog({
  account,
  config,
  connectors,
  initialSection = "appearance",
  isAdmin,
  onClose,
  onSignOut,
}: {
  account: SettingsAccount;
  /** Required for admins. Read from live config, never hard-coded. */
  config?: SettingsModelConfig;
  connectors?: SettingsConnector[];
  initialSection?: SettingsSection;
  isAdmin: boolean;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const adminSection = initialSection === "model" || initialSection === "connectors";
  const [section, setSection] = useState<SettingsSection>(
    adminSection && !isAdmin ? "appearance" : initialSection,
  );
  const { choice, resolved, setChoice } = useTheme();

  function renderNav(item: NavItem) {
    const on = item.id === section;
    return (
      <button
        aria-current={on ? "page" : undefined}
        className="ub-ring flex h-[34px] items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] text-ink data-[on=true]:bg-sunken data-[on=true]:font-medium"
        data-on={on ? "true" : undefined}
        key={item.id}
        onClick={() => setSection(item.id)}
        type="button"
      >
        <span className="inline-flex text-ink-muted">{item.icon}</span>
        {item.label}
      </button>
    );
  }

  return (
    <Dialog ariaLabel="Settings" onClose={onClose} width={780}>
      <div className="flex h-[580px] max-h-[calc(100dvh-32px)] overflow-hidden rounded-2xl bg-bubble">
        <nav
          aria-label="Settings sections"
          className="flex w-[212px] shrink-0 flex-col gap-px px-2.5 py-4 shadow-[inset_-1px_0_0_var(--border)]"
        >
          <h2 className="px-2.5 pb-3 pt-1 text-base font-semibold tracking-[-0.01em]">Settings</h2>
          {GENERAL_NAV.map(renderNav)}
          {isAdmin ? (
            <>
              <p className="px-2.5 pb-1.5 pt-4 text-xs font-medium text-ink-faint-text">Admin</p>
              {ADMIN_NAV.map(renderNav)}
            </>
          ) : null}
        </nav>
        <div className="relative min-w-0 flex-1 overflow-y-auto">
          <div className="absolute right-3 top-3">
            <IconButton aria-label="Close settings" onClick={onClose}>
              <XIcon className="size-4" />
            </IconButton>
          </div>
          <div className="flex flex-col gap-7 px-8 py-7">
            {section === "appearance" ? (
              <section className="flex flex-col gap-3.5">
                <h3 className="text-sm font-semibold">Appearance</h3>
                <div className="flex items-center gap-4">
                  <span className="flex-1 text-[13px]">Theme</span>
                  <Segmented
                    label="Theme"
                    onChange={(value) => setChoice(value as ThemeChoice)}
                    options={THEME_OPTIONS}
                    value={choice}
                  />
                </div>
                <p className="text-xs text-ink-faint-text">
                  {choice === "system"
                    ? `Follows your device. ${resolved === "dark" ? "Dark" : "Light"} right now.`
                    : `Always ${choice}, whatever your device uses.`}
                </p>
              </section>
            ) : null}
            {section === "account" ? (
              <section className="flex flex-col gap-3.5">
                <h3 className="text-sm font-semibold">Account</h3>
                <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-y-3 text-[13px] leading-5">
                  <dt className="text-ink-faint-text">Name</dt>
                  <dd>{account.name}</dd>
                  <dt className="text-ink-faint-text">Email</dt>
                  <dd className="break-words">{account.email}</dd>
                  <dt className="text-ink-faint-text">Role</dt>
                  <dd>{account.role}</dd>
                  <dt className="text-ink-faint-text">Department</dt>
                  <dd>{account.department}</dd>
                  <dd className="col-span-2">
                    {account.totalDocuments === undefined
                      ? `Can read ${account.readableDocuments} documents`
                      : `Can read ${account.readableDocuments} of ${account.totalDocuments} documents`}
                  </dd>
                </dl>
                <div>
                  <Button icon={<LogOutIcon className="size-4" />} onClick={onSignOut} variant="secondary">
                    Sign out
                  </Button>
                </div>
              </section>
            ) : null}
            {section === "model" && isAdmin && config ? (
              <section className="flex flex-col gap-3.5">
                <div className="flex items-center gap-2.5 pr-10">
                  <h3 className="text-sm font-semibold">Model and retrieval</h3>
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-faint-text">
                    <LockIcon aria-hidden="true" className="size-3.5" />
                    Read-only. Changes go through evals.
                  </span>
                </div>
                <dl className="grid grid-cols-[160px_minmax(0,1fr)] gap-y-2.5 text-[13px] leading-5">
                  <dt className="text-ink-faint-text">Answer model</dt>
                  <dd className="break-all font-mono text-xs">{config.answerModel}</dd>
                  <dt className="text-ink-faint-text">Embeddings</dt>
                  <dd className="break-all font-mono text-xs">{config.embeddingModel}</dd>
                  <dt className="text-ink-faint-text">Reranker</dt>
                  <dd className="break-all font-mono text-xs">{config.rerankerModel}</dd>
                  <dt className="text-ink-faint-text">Retrieval</dt>
                  <dd>{config.retrieval}</dd>
                  <dt className="text-ink-faint-text">Passages per answer</dt>
                  <dd className="font-mono text-xs">{config.passagesPerAnswer}</dd>
                  <dt className="text-ink-faint-text">Rerank floor</dt>
                  <dd className="font-mono text-xs">{config.rerankFloor}</dd>
                  <dt className="text-ink-faint-text">Active generation</dt>
                  <dd className="font-mono text-xs">{config.activeGeneration}</dd>
                </dl>
              </section>
            ) : null}
            {section === "connectors" && isAdmin ? (
              <section className="flex flex-col gap-3.5">
                <h3 className="text-sm font-semibold">Connectors</h3>
                <ul className="flex flex-col">
                  {(connectors ?? []).map((connector) => {
                    const status = CONNECTOR_STATUS[connector.status];
                    return (
                      <li
                        className="flex items-center gap-3 border-b border-border py-3 last:border-b-0"
                        key={connector.id}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium">{connector.name}</p>
                          <p className="text-xs text-ink-faint-text">{connector.description}</p>
                        </div>
                        {connector.connectable ? (
                          <Button disabled size={32}>
                            Connect
                          </Button>
                        ) : null}
                        <span className="inline-flex items-center gap-1.5 text-xs text-ink-faint-text">
                          <StatusDot tone={status.tone} />
                          {status.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
