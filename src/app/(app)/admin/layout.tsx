import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { loadIdentity } from "@/app/shell-data";

export const dynamic = "force-dynamic";

/** Admin pages 404 for everyone else. Brain enforces the same rule. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const identity = await loadIdentity();
  if (!identity?.isAdmin) {
    notFound();
  }
  return children;
}
