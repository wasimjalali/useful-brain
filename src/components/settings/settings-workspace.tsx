"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CloseIcon, LayersIcon, SettingsIcon, UserIcon } from "@/components/icons";
import { Select } from "@/components/ui/select";
import { StatusLabel } from "@/components/ui/status-label";
import type { WorkspaceIdentity } from "@/app/actions";
import { NORTHWIND_PRINCIPALS } from "@/lib/eval/northwind-principals";
import { SELECTED_MODELS } from "@/lib/models/selection";
import type { EmbeddingStorageStatus } from "@/lib/rag/storage-records";
import { isRetrievalReady } from "@/lib/rag/workspace-status";
import type { KnowledgeInventory } from "@/lib/store/knowledge-inventory";

type SettingsPane = "operator" | "retrieval" | "models";

const PANES: {
  id: SettingsPane;
  label: string;
  icon: typeof UserIcon;
}[] = [
  { id: "operator", label: "Operator", icon: UserIcon },
  { id: "retrieval", label: "Retrieval", icon: LayersIcon },
  { id: "models", label: "Models", icon: SettingsIcon },
];

export function SettingsWorkspace({
  assumedPrincipalKey = null,
  identity,
  onAssumePrincipal,
  onClose,
  retrievalMode,
  status,
}: {
  assumedPrincipalKey?: string | null;
  identity: WorkspaceIdentity | null;
  onAssumePrincipal?: (key: string | null) => void;
  onClose?: () => void;
  retrievalMode: KnowledgeInventory["retrievalMode"];
  status: EmbeddingStorageStatus;
}) {
  const [pane, setPane] = useState<SettingsPane>("operator");
  const ready = isRetrievalReady(status);

  return (
    <div className="settings-modal">
      <nav aria-label="Settings sections" className="settings-modal-nav">
        {PANES.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-current={pane === item.id ? "page" : undefined}
              className="nav-item text-sm"
              key={item.id}
              onClick={() => setPane(item.id)}
              type="button"
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 px-5 py-4">
          <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink">Settings</h1>
          {onClose ? (
            <button
              aria-label="Close settings"
              className="icon-btn size-9"
              onClick={onClose}
              type="button"
            >
              <CloseIcon className="size-4" />
            </button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          {pane === "operator" ? (
            <OperatorPane
              assumedPrincipalKey={assumedPrincipalKey}
              identity={identity}
              onAssumePrincipal={onAssumePrincipal}
            />
          ) : null}
          {pane === "retrieval" ? (
            <RetrievalPane ready={ready} retrievalMode={retrievalMode} status={status} />
          ) : null}
          {pane === "models" ? <ModelsPane /> : null}
        </div>
      </div>
    </div>
  );
}

function OperatorPane({
  assumedPrincipalKey,
  identity,
  onAssumePrincipal,
}: {
  assumedPrincipalKey: string | null;
  identity: WorkspaceIdentity | null;
  onAssumePrincipal?: (key: string | null) => void;
}) {
  const router = useRouter();
  return (
    <section aria-labelledby="identity-heading">
      <h2 className="sr-only" id="identity-heading">
        Operator
      </h2>
      <dl className="settings-list !mt-0 !border-t-0">
        {onAssumePrincipal && identity?.kind === "user" && identity.roles.includes("operator") ? (
          <div className="settings-row">
            <dt>
              <label htmlFor="assume-principal">Assume principal</label>
            </dt>
            <dd>
              <Select
                id="assume-principal"
                onChange={(next) => onAssumePrincipal(next === "" ? null : next)}
                options={[
                  { value: "", label: "Operator" },
                  ...NORTHWIND_PRINCIPALS.map((principal) => ({
                    value: principal.key,
                    label: `${principal.userId} (${[...principal.roles, ...principal.departments].join(", ")})`,
                  })),
                ]}
                value={assumedPrincipalKey ?? ""}
              />
            </dd>
          </div>
        ) : null}
        <SettingsRow label="Principal" value={identity?.id ?? "Unavailable"} mono />
        <SettingsRow label="Email" value={identity?.subject ?? "Unavailable"} />
        <SettingsRow label="Identity kind" value={identity?.kind ?? "Unavailable"} />
      </dl>
      <form
        className="mt-6"
        onSubmit={async (event) => {
          event.preventDefault();
          await fetch("/api/auth/logout", { method: "POST" });
          router.push("/login");
          router.refresh();
        }}
      >
        <button className="rounded-md border border-border px-3 py-2 text-sm text-ink" type="submit">
          Log out
        </button>
      </form>
    </section>
  );
}

function RetrievalPane({
  ready,
  retrievalMode,
  status,
}: {
  ready: boolean;
  retrievalMode: KnowledgeInventory["retrievalMode"];
  status: EmbeddingStorageStatus;
}) {
  return (
    <section aria-labelledby="retrieval-heading">
      <h2 className="sr-only" id="retrieval-heading">
        Retrieval
      </h2>
      <dl className="settings-list !mt-0 !border-t-0">
        <div className="settings-row">
          <dt>Readiness</dt>
          <dd>
            <StatusLabel tone={ready ? "success" : "warning"}>
              {ready ? "Retrieval ready" : "Setup needed"}
            </StatusLabel>
          </dd>
        </div>
        <SettingsRow
          label="Mode"
          value={retrievalMode === "hybrid" ? "Hybrid retrieval" : "Keyword retrieval in local preview"}
        />
        <SettingsRow label="Active generation" value={status.activeVersionId ?? "None"} mono />
        <SettingsRow label="Documents" value={status.storedDocuments.toLocaleString("en-US")} />
        <SettingsRow label="Chunks" value={status.storedChunks.toLocaleString("en-US")} />
        <SettingsRow label="Data policy" value="Synthetic documents only" />
      </dl>
    </section>
  );
}

function ModelsPane() {
  return (
    <section aria-labelledby="models-heading">
      <h2 className="sr-only" id="models-heading">
        Models
      </h2>
      <dl className="settings-list !mt-0 !border-t-0">
        <SettingsRow label="Chat" value={SELECTED_MODELS.chat.id} mono />
        <SettingsRow
          label="Embeddings"
          value={`${SELECTED_MODELS.embedding.id} · ${SELECTED_MODELS.embedding.dimensions} cosine`}
          mono
        />
        <SettingsRow label="Rerank" value={SELECTED_MODELS.rerank.id} mono />
      </dl>
    </section>
  );
}

function SettingsRow({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="settings-row">
      <dt>{label}</dt>
      <dd className={mono ? "font-mono text-xs" : undefined}>{value}</dd>
    </div>
  );
}
