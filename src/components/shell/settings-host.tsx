"use client";

import { useEffect, useState } from "react";

import { signOutAction, type WorkspaceIdentity } from "@/app/actions";
import { loadAdminSettingsAction, type AdminSettingsData } from "@/app/settings-actions";
import { mapAccount } from "@/components/settings/settings-mapper";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

type AdminState =
  | { status: "loading" }
  | { status: "ready"; data: AdminSettingsData }
  | { status: "error"; message: string };

/** The settings dialog, opened by `?settings=1` on any page. */
export function SettingsHost({
  identity,
  onClose,
}: {
  identity: WorkspaceIdentity | null;
  onClose: () => void;
}) {
  const isAdmin = identity?.isAdmin === true;
  const [admin, setAdmin] = useState<AdminState>({ status: "loading" });

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    let cancelled = false;
    void loadAdminSettingsAction().then((result) => {
      if (cancelled) {
        return;
      }
      setAdmin(
        result.ok
          ? { status: "ready", data: result.data }
          : { status: "error", message: result.error.message },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!identity || (isAdmin && admin.status !== "ready")) {
    const message = !identity
      ? "Couldn't load your account."
      : admin.status === "error"
        ? admin.message
        : null;
    return (
      <Dialog ariaLabel="Settings" onClose={onClose} width={780}>
        <div className="flex h-[580px] max-h-[calc(100dvh-32px)] flex-col items-center justify-center gap-3 rounded-2xl bg-bubble px-8 text-center">
          {message ? (
            <>
              <p className="text-sm text-ink" role="alert">
                {message}
              </p>
              <Button onClick={onClose} variant="secondary">
                Close
              </Button>
            </>
          ) : (
            <p className="text-sm text-ink-muted" role="status">
              Loading settings
            </p>
          )}
        </div>
      </Dialog>
    );
  }

  const data = admin.status === "ready" ? admin.data : null;
  return (
    <SettingsDialog
      account={mapAccount(identity, data?.totalDocuments)}
      config={data?.config}
      connectors={data?.connectors}
      isAdmin={isAdmin}
      onClose={onClose}
      onSignOut={() => void signOutAction()}
    />
  );
}
