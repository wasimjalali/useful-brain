import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupsResponse, PeopleResponse } from "@/lib/contracts/people";

import { PeopleWorkspace } from "./people-workspace";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const people: PeopleResponse = {
  total: 2,
  activeDocuments: 62,
  people: [
    { id: "p1", name: "Priya Shah", email: "priya@northwind.example", role: "member", department: "support", readableDocuments: 31, lastActive: null },
    { id: "p/2", name: "Jordan Ellis", email: "jordan@northwind.example", role: "admin", department: "operations", readableDocuments: 62, lastActive: null },
  ],
};
const groups: GroupsResponse = {
  groups: [{ id: "g1", name: "Engineering", type: "department", people: 3, addsDocuments: 10, rule: "department = engineering" }],
};

function mount(createInvite = vi.fn()) {
  render(<PeopleWorkspace createInvite={createInvite} groups={groups} people={people} />);
  return createInvite;
}

beforeEach(() => push.mockClear());

describe("PeopleWorkspace", () => {
  it("filters people client-side by name or email", () => {
    mount();
    fireEvent.change(screen.getByPlaceholderText("Search name or email"), { target: { value: "jordan" } });
    expect(screen.queryByText("Priya Shah")).not.toBeInTheDocument();
    expect(screen.getByText("Jordan Ellis")).toBeInTheDocument();
  });

  it("shows counts and switches to groups", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /Groups\s*1/ }));
    expect(screen.getByText("department = engineering")).toBeInTheDocument();
  });

  it("View as navigates to chat with the encoded principal id", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "View as Jordan Ellis" }));
    expect(push).toHaveBeenCalledWith("/chat?viewAs=p%2F2");
  });

  it("invite success shows an absolute link and expiry", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, data: { url: "/invite/abc", expiresAt: Date.UTC(2026, 9, 15) } });
    mount(create);
    fireEvent.click(screen.getByRole("button", { name: "Invite people" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@northwind.example" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create invite" }));
    });
    expect(create).toHaveBeenCalledWith({ email: "new@northwind.example", role: "standard", department: "engineering" });
    const field = (await screen.findByLabelText("Invite link")) as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/invite/abc`);
    expect(screen.getByText("Expires 15 Oct 2026")).toBeInTheDocument();
  });

  it.each([
    ["invalid_email", "Enter a valid email address"],
    ["account_exists", "That email already has an account"],
    ["invite_open", "An invite is already open for that email"],
  ])("invite reason %s becomes a field error", async (reason, shown) => {
    const create = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "generic", retryable: false, reason },
    });
    mount(create);
    fireEvent.click(screen.getByRole("button", { name: "Invite people" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@northwind.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invite" }));
    await waitFor(() => expect(screen.getByText(shown)).toBeInTheDocument());
  });

  it("a failure with no reason is a generic form alert, whatever the message says", async () => {
    const create = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "That email is already registered.", retryable: false },
    });
    mount(create);
    fireEvent.click(screen.getByRole("button", { name: "Invite people" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@northwind.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't create the invite.");
  });

  it("offers no Admin role and always sends a standard role", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, data: { url: "/invite/abc", expiresAt: Date.UTC(2026, 9, 15) } });
    mount(create);
    fireEvent.click(screen.getByRole("button", { name: "Invite people" }));
    expect(screen.queryByRole("radio", { name: "Admin" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@northwind.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invite" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ role: "standard" })));
  });
});
