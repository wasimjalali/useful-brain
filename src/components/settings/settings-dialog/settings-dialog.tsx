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
import { initials } from "@/lib/format";
import { modelDisplayName } from "@/lib/labels";
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

function AccountChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex gap-1 rounded-md px-2 py-0.5 text-xs text-ink-muted shadow-[0_0_0_1px_var(--border)]">
      <span className="text-ink-faint-text">{label}</span>
      {value}
    </span>
  );
}

function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="pl-0.5 text-[11.5px] text-ink-faint-text">{label}</p>
      <div className="overflow-hidden rounded-[10px] shadow-[0_0_0_1px_var(--border)]">{children}</div>
    </div>
  );
}

function SettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 px-3 py-[9px] text-[13px] [&+&]:border-t [&+&]:border-border">
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="flex min-w-0 flex-col items-end text-right">{children}</span>
    </div>
  );
}

function ModelValue({ id }: { id: string }) {
  const name = modelDisplayName(id);
  return (
    <>
      <span>{name}</span>
      {name !== id ? (
        <span className="max-w-full truncate font-mono text-[11px] text-ink-faint-text">{id}</span>
      ) : null}
    </>
  );
}

export function SettingsDialog({
  account,
  config,
  connectors,
  adminError,
  initialSection = "appearance",
  isAdmin,
  onClose,
  onSignOut,
}: {
  account: SettingsAccount;
  /** Required for admins. Read from live config, never hard-coded. */
  config?: SettingsModelConfig;
  connectors?: SettingsConnector[];
  /** Set when loading the admin data failed. Shown in the admin sections only. */
  adminError?: string;
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
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken text-sm font-semibold text-ink-muted"
                  >
                    {initials(account.name || account.email)}
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold">{account.name || account.email}</p>
                    {account.name && account.name !== account.email ? (
                      <p className="break-words text-[12.5px] text-ink-faint-text">{account.email}</p>
                    ) : null}
                  </div>
                </div>
                {account.role || account.department ? (
                  <div className="flex flex-wrap gap-1.5">
                    {account.role ? <AccountChip label="Role" value={account.role} /> : null}
                    {account.department ? (
                      <AccountChip label="Department" value={account.department} />
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[12.5px] text-ink-muted">
                    <span>Documents you can read</span>
                    <span className="font-mono tabular-nums text-ink">
                      {account.totalDocuments === undefined
                        ? account.readableDocuments
                        : `${account.readableDocuments} of ${account.totalDocuments}`}
                    </span>
                  </div>
                  {account.totalDocuments ? (
                    <div
                      aria-label="Documents you can read"
                      aria-valuemax={account.totalDocuments}
                      aria-valuemin={0}
                      aria-valuenow={account.readableDocuments}
                      className="h-[5px] overflow-hidden rounded-sm bg-sunken"
                      role="meter"
                    >
                      <div
                        className="h-full rounded-sm bg-ink"
                        style={{
                          width: `${Math.min(100, Math.max(0, (account.readableDocuments / account.totalDocuments) * 100))}%`,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
                <div>
                  <Button icon={<LogOutIcon className="size-4" />} onClick={onSignOut} variant="secondary">
                    Sign out
                  </Button>
                </div>
              </section>
            ) : null}
            {(section === "model" || section === "connectors") && isAdmin && adminError ? (
              <p className="text-sm text-ink" role="alert">
                {adminError}
              </p>
            ) : null}
            {section === "model" && isAdmin && config ? (
              <section className="flex flex-col gap-3.5">
                <div className="flex items-center gap-2.5 pr-10">
                  <h3 className="text-sm font-semibold">Model and retrieval</h3>
                  <span className="inline-flex items-center gap-1 rounded-full bg-sunken py-0.5 pl-1.5 pr-2 text-[11px] text-ink-faint-text">
                    <LockIcon aria-hidden="true" className="size-3" />
                    Read-only
                  </span>
                </div>
                <SettingsGroup label="Models">
                  <SettingsRow label="Answer">
                    <ModelValue id={config.answerModel} />
                  </SettingsRow>
                  <SettingsRow label="Embeddings">
                    <ModelValue id={config.embeddingModel} />
                  </SettingsRow>
                  <SettingsRow label="Reranker">
                    <ModelValue id={config.rerankerModel} />
                  </SettingsRow>
                </SettingsGroup>
                <SettingsGroup label="Retrieval">
                  <SettingsRow label="Search">{config.retrieval}</SettingsRow>
                  <SettingsRow label="Passages per answer">
                    <span className="font-mono tabular-nums">{config.passagesPerAnswer}</span>
                  </SettingsRow>
                  <SettingsRow label="Rerank floor">
                    <span className="font-mono tabular-nums">{config.rerankFloor}</span>
                  </SettingsRow>
                  <SettingsRow label="Active generation">
                    <span className="font-mono tabular-nums">{config.activeGeneration}</span>
                  </SettingsRow>
                </SettingsGroup>
              </section>
            ) : null}
            {section === "connectors" && isAdmin && !adminError ? (
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
