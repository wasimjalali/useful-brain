import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/rag/app-errors";

const brainJson = vi.fn();
const redirect = vi.fn((target: string) => {
  throw new Error(`REDIRECT:${target}`);
});

vi.mock("@/lib/cf/brain-client", () => ({ brainJson: (...args: unknown[]) => brainJson(...args) }));
vi.mock("next/navigation", () => ({ redirect: (target: string) => redirect(target) }));

import { homeDestination, loadHomeDestination, loadIdentity, loadShellData } from "./shell-data";

const member = {
  id: "p1",
  kind: "user",
  roles: ["standard"],
  departments: ["support"],
  isAdmin: false,
  department: "support",
  readableDocumentCount: 34,
};
const admin = { ...member, id: "p2", roles: ["admin"], isAdmin: true, department: null };
const inventory = (corpusStatus: string, activeVersionId: string | null) => ({
  embeddingStorageStatus: { corpusStatus, activeVersionId },
  retrievalMode: "hybrid",
  documents: [],
  chunks: [],
});

beforeEach(() => {
  brainJson.mockReset();
  redirect.mockClear();
});

describe("homeDestination", () => {
  it("sends members to chat and admins with no ready corpus to Sources", () => {
    expect(homeDestination({ isAdmin: false, retrievalReady: false })).toBe("/chat");
    expect(homeDestination({ isAdmin: true, retrievalReady: true })).toBe("/chat");
    expect(homeDestination({ isAdmin: true, retrievalReady: false })).toBe("/admin/sources");
  });
});

describe("shell data", () => {
  it("redirects to /login when the session is missing", async () => {
    brainJson.mockRejectedValue(new AppError("AUTH_REQUIRED", "Sign in.", false));
    await expect(loadShellData()).rejects.toThrow("REDIRECT:/login");
  });

  it("returns a load error for any other failure instead of throwing", async () => {
    brainJson.mockRejectedValue(new Error("down"));
    const data = await loadShellData();
    expect(data.error).toMatch(/could not load/i);
    expect(data.identity).toBeNull();
  });

  it("never calls /knowledge for a member", async () => {
    brainJson.mockImplementation(async (path: string) =>
      path === "/whoami" ? member : [],
    );
    const data = await loadShellData();
    expect(brainJson.mock.calls.map((call) => call[0])).toEqual(["/whoami", "/conversations"]);
    expect(data.retrievalReady).toBe(true);
  });

  it("reads corpus status for an admin", async () => {
    brainJson.mockImplementation(async (path: string) => {
      if (path === "/whoami") return admin;
      if (path === "/knowledge") return inventory("ready", null);
      return [];
    });
    const data = await loadShellData();
    expect(data.retrievalReady).toBe(false);
  });

  it("loadIdentity fails closed to null and still redirects an expired session", async () => {
    brainJson.mockRejectedValueOnce(new Error("down"));
    await expect(loadIdentity()).resolves.toBeNull();
    brainJson.mockRejectedValueOnce(new AppError("AUTH_REQUIRED", "Sign in.", false));
    await expect(loadIdentity()).rejects.toThrow("REDIRECT:/login");
  });

  it("resolves / for a member without touching /knowledge", async () => {
    brainJson.mockImplementation(async () => member);
    await expect(loadHomeDestination()).resolves.toBe("/chat");
    expect(brainJson).not.toHaveBeenCalledWith("/knowledge");
  });

  it("resolves / for an admin by corpus readiness", async () => {
    brainJson.mockImplementation(async (path: string) =>
      path === "/whoami" ? admin : inventory("ready", null),
    );
    await expect(loadHomeDestination()).resolves.toBe("/admin/sources");
    brainJson.mockImplementation(async (path: string) =>
      path === "/whoami" ? admin : inventory("active", "g1"),
    );
    await expect(loadHomeDestination()).resolves.toBe("/chat");
  });
});
