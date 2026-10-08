import { vi } from "vitest";

import type { WorkspaceIdentity } from "@/app/actions";

export const member: WorkspaceIdentity = {
  id: "maya",
  kind: "user",
  subject: "Maya Chen",
  roles: ["standard"],
  departments: ["support"],
  isAdmin: false,
  department: "support",
  readableDocumentCount: 34,
};

export const admin: WorkspaceIdentity = {
  ...member,
  id: "jordan",
  subject: "Jordan Ellis",
  roles: ["admin"],
  isAdmin: true,
  department: null,
};

/** Makes matchMedia answer min-width and max-width queries for a viewport. */
export function setViewport(width: number) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const max = /max-width:\s*(\d+)px/.exec(query);
      const min = /min-width:\s*(\d+)px/.exec(query);
      const matches =
        (max ? width <= Number(max[1]) : true) && (min ? width >= Number(min[1]) : true);
      return {
        matches,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      };
    },
  });
}

export function clearViewport() {
  Reflect.deleteProperty(window, "matchMedia");
}
