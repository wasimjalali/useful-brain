import type { ReactNode } from "react";

import { CircleAlertIcon } from "@/components/icons";

import { Button } from "./button";

export function InlineAlert({
  children,
  action,
}: {
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="ub-alert" role="alert">
      <CircleAlertIcon className="size-4 shrink-0 text-danger" />
      <span className="flex-1">{children}</span>
      {action ? (
        <span className="shrink-0 [&_.ub-btn]:bg-bubble [&_.ub-btn]:shadow-sel">
          <Button onClick={action.onClick} size={32} variant="secondary">
            {action.label}
          </Button>
        </span>
      ) : null}
    </div>
  );
}
