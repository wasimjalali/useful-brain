import { SettingsIcon, UserIcon } from "@/components/icons";
import { StatusLabel } from "@/components/ui/status-label";
import type { WorkspaceIdentity } from "@/app/actions";
import { NORTHWIND_PRINCIPALS } from "@/lib/eval/northwind-principals";
import { SELECTED_MODELS } from "@/lib/models/selection";
import type { EmbeddingStorageStatus } from "@/lib/rag/storage-records";
import { isRetrievalReady } from "@/lib/rag/workspace-status";
import type { KnowledgeInventory } from "@/lib/store/knowledge-inventory";

export function SettingsWorkspace({
  assumedPrincipalKey = null,
  identity,
  onAssumePrincipal,
  retrievalMode,
  status,
}: {
  assumedPrincipalKey?: string | null;
  identity: WorkspaceIdentity | null;
  onAssumePrincipal?: (key: string | null) => void;
  retrievalMode: KnowledgeInventory["retrievalMode"];
  status: EmbeddingStorageStatus;
}) {
  const ready = isRetrievalReady(status);

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border pb-5">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Settings</h1>
      </header>

      <section aria-labelledby="identity-heading" className="settings-section">
        <div className="settings-section-title">
          <UserIcon className="size-4" />
          <h2 id="identity-heading">Operator identity</h2>
        </div>
        <dl className="settings-list">
          <SettingsRow label="Principal" value={identity?.id ?? "Unavailable"} mono />
          <SettingsRow label="Identity kind" value={identity?.kind ?? "Unavailable"} />
          <SettingsRow label="Roles" value={identity?.roles.join(", ") || "None"} />
          <SettingsRow
            label="Departments"
            value={identity?.departments.join(", ") || "None"}
          />
          <SettingsRow label="Runtime" value="Loopback operator on 127.0.0.1" />
          {onAssumePrincipal ? (
            <div className="settings-row">
              <dt>
                <label htmlFor="assume-principal">Assume principal</label>
              </dt>
              <dd>
                <select
                  className="field-input min-h-10 px-3 text-sm text-ink outline-none"
                  id="assume-principal"
                  onChange={(event) =>
                    onAssumePrincipal(event.target.value === "" ? null : event.target.value)
                  }
                  value={assumedPrincipalKey ?? ""}
                >
                  <option value="">Operator</option>
                  {NORTHWIND_PRINCIPALS.map((principal) => (
                    <option key={principal.key} value={principal.key}>
                      {principal.userId} ({[...principal.roles, ...principal.departments].join(", ")})
                    </option>
                  ))}
                </select>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="retrieval-heading" className="settings-section">
        <div className="settings-section-title">
          <SettingsIcon className="size-4" />
          <h2 id="retrieval-heading">Retrieval</h2>
        </div>
        <dl className="settings-list">
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
          <SettingsRow label="Ready generation" value={status.readyVersionId ?? "None"} mono />
          <SettingsRow label="Documents" value={status.storedDocuments.toLocaleString("en-US")} />
          <SettingsRow label="Chunks" value={status.storedChunks.toLocaleString("en-US")} />
          <SettingsRow label="Data policy" value="Synthetic documents only" />
        </dl>
      </section>

      <section aria-labelledby="models-heading" className="settings-section">
        <div className="settings-section-title">
          <SettingsIcon className="size-4" />
          <h2 id="models-heading">Locked models</h2>
        </div>
        <dl className="settings-list">
          <SettingsRow label="Chat" value={SELECTED_MODELS.chat.id} mono />
          <SettingsRow
            label="Embeddings"
            value={`${SELECTED_MODELS.embedding.id} · ${SELECTED_MODELS.embedding.dimensions} cosine`}
            mono
          />
          <SettingsRow label="Rerank" value={SELECTED_MODELS.rerank.id} mono />
        </dl>
      </section>
    </div>
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
