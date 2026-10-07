import { beforeEach, describe, expect, it, vi } from "vitest";

const loadIdentity = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("@/app/shell-data", () => ({ loadIdentity: () => loadIdentity() }));
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));

import AdminLayout from "./layout";

beforeEach(() => {
  loadIdentity.mockReset();
  notFound.mockClear();
});

describe("admin layout guard", () => {
  it("returns not-found for a member", async () => {
    loadIdentity.mockResolvedValue({ id: "maya", roles: ["standard"], isAdmin: false });
    await expect(AdminLayout({ children: "secret" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("fails closed when whoami is unavailable", async () => {
    loadIdentity.mockResolvedValue(null);
    await expect(AdminLayout({ children: "secret" })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("does not trust a role string without the server's isAdmin flag", async () => {
    loadIdentity.mockResolvedValue({ id: "x", roles: ["admin"], isAdmin: false });
    await expect(AdminLayout({ children: "secret" })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders children for an admin", async () => {
    loadIdentity.mockResolvedValue({ id: "jordan", roles: ["admin"], isAdmin: true });
    await expect(AdminLayout({ children: "admin page" })).resolves.toBe("admin page");
    expect(notFound).not.toHaveBeenCalled();
  });
});
