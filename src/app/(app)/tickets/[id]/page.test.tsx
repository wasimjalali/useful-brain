import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/rag/app-errors";

const brainJson = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("@/lib/cf/brain-client", () => ({ brainJson: (...args: unknown[]) => brainJson(...args) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
  notFound: () => notFound(),
}));

import TicketPage from "./page";

beforeEach(() => {
  brainJson.mockReset();
  redirect.mockClear();
  notFound.mockClear();
});

describe("ticket page", () => {
  it("sends an expired session to /login", async () => {
    brainJson.mockRejectedValue(new AppError("AUTH_REQUIRED", "Sign in.", false));
    await expect(TicketPage({ params: Promise.resolve({ id: "SUP-1" }) })).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("returns not-found for a missing ticket", async () => {
    brainJson.mockRejectedValue(new AppError("NOT_FOUND", "x", false));
    await expect(TicketPage({ params: Promise.resolve({ id: "SUP-1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
