import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InviteAcceptForm } from "./invite-accept-form";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

function fill() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ana Lima" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "longenough1" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
}

describe("InviteAcceptForm", () => {
  it("posts token, name and password then goes to chat", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InviteAcceptForm token="t0ken" />);
    fill();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/chat"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/invite");
    expect(JSON.parse(init.body as string)).toEqual({ token: "t0ken", name: "Ana Lima", password: "longenough1" });
  });

  it("shows one generic message for an invalid, expired or used link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "This invite link is no longer valid." }), { status: 400 })));
    render(<InviteAcceptForm token="t0ken" />);
    fill();
    expect(await screen.findByText("This invite link is no longer valid.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the generic message when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
    render(<InviteAcceptForm token="t0ken" />);
    fill();
    expect(await screen.findByText("This invite link is no longer valid.")).toBeInTheDocument();
  });

  it("toggles password visibility", () => {
    render(<InviteAcceptForm token="t" />);
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  });
});
