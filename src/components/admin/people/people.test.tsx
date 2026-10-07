import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GroupRowView, PersonRowView } from "@/lib/contracts/admin-manage-view";

import { InviteDialog } from "./invite-dialog";
import { PeopleView } from "./people-view";

const people: PersonRowView[] = [
  { id: "p1", name: "Priya Shah", email: "priya.shah@northwind.example", role: "Member", department: "Support", readableCount: 31, lastActiveLabel: "Today, 09:31" },
  { id: "p2", name: "Jordan Ellis", email: "jordan.ellis@northwind.example", role: "Admin", department: "Operations", readableCount: 62, lastActiveLabel: "Now" },
];
const groups: GroupRowView[] = [
  { id: "g1", name: "Engineering", type: "Department", people: 31, addsDocuments: "+10 documents", rule: "department = engineering" },
];

function view(over: Partial<Parameters<typeof PeopleView>[0]> = {}) {
  const props = {
    tab: "people" as const,
    peopleCount: 148,
    groupCount: 9,
    query: "",
    people,
    groups,
    readableTotal: 62,
    onTabChange: vi.fn(),
    onQueryChange: vi.fn(),
    onViewAs: vi.fn(),
    onInvite: vi.fn(),
    ...over,
  };
  render(<PeopleView {...props} />);
  return props;
}

describe("PeopleView", () => {
  it("header, subtitle and Invite people", () => {
    const p = view();
    expect(screen.getByRole("heading", { name: "People" })).toBeInTheDocument();
    expect(screen.getByText("Access follows department and role. Use View as to check what someone can read.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Invite people" }));
    expect(p.onInvite).toHaveBeenCalledOnce();
  });

  it("tabs show counts and switch", () => {
    const p = view();
    expect(screen.getByRole("tab", { name: /People\s*148/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Groups\s*9/ }));
    expect(p.onTabChange).toHaveBeenCalledWith("groups");
  });

  it("people rows: initials avatar, email, role, department and View as", () => {
    const p = view();
    expect(screen.getByText("PS")).toBeInTheDocument();
    expect(screen.getByText("priya.shah@northwind.example")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View as Priya Shah" }));
    expect(p.onViewAs).toHaveBeenCalledWith(people[0]);
  });

  it("shows the readable bar only when a denominator is given", () => {
    const { unmount } = render(<div />);
    unmount();
    view();
    expect(screen.getAllByRole("meter")).toHaveLength(2);
    expect(screen.getAllByRole("meter")[0]).toHaveAttribute("aria-valuenow", "31");
    expect(screen.getAllByRole("meter")[0]).toHaveAttribute("aria-valuemax", "62");
  });

  it("omits the bar without a denominator but keeps the count", () => {
    view({ readableTotal: undefined });
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.getByText("31")).toBeInTheDocument();
  });

  it("search placeholder follows the tab", () => {
    view();
    expect(screen.getByPlaceholderText("Search name or email")).toBeInTheDocument();
  });

  it("groups tab renders the groups table with a mono rule", () => {
    view({ tab: "groups" });
    expect(screen.getByPlaceholderText("Search groups")).toBeInTheDocument();
    expect(screen.getByText("department = engineering")).toBeInTheDocument();
    expect(screen.getByText("+10 documents")).toBeInTheDocument();
    expect(screen.queryByText("Priya Shah")).not.toBeInTheDocument();
  });
});

function invite(state: Parameters<typeof InviteDialog>[0]["state"]) {
  const props = {
    state,
    departments: ["Support", "Engineering"],
    onSubmit: vi.fn(),
    onClose: vi.fn(),
  };
  render(<InviteDialog {...props} />);
  return props;
}

describe("InviteDialog", () => {
  it("does not submit an empty or malformed email", () => {
    const p = invite({ status: "form" });
    fireEvent.click(screen.getByRole("button", { name: "Create invite" }));
    expect(p.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invite" }));
    expect(p.onSubmit).not.toHaveBeenCalled();
  });

  it("has no role choice, so an admin can't be invited", () => {
    invite({ status: "form" });
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText("Admin")).toBeNull();
  });

  it("submits trimmed email with department", () => {
    const p = invite({ status: "form" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "  new.hire@northwind.example " } });
    fireEvent.click(screen.getByRole("button", { name: "Create invite" }));
    expect(p.onSubmit).toHaveBeenCalledWith({ email: "new.hire@northwind.example", department: "Support" });
  });

  it("shows a server error and a field error", () => {
    invite({ status: "form", error: "Couldn't create the invite.", fieldErrors: { email: "That email already has an account" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't create the invite.");
    expect(screen.getByText("That email already has an account")).toBeInTheDocument();
  });

  it("disables the submit while submitting", () => {
    invite({ status: "submitting" });
    expect(screen.getByRole("button", { name: "Create invite" })).toBeDisabled();
  });

  it("result state: read-only link, expiry and Copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    invite({ status: "done", link: "https://x.example/invite/abc", expiresLabel: "Expires 15 Oct 2026" });
    const field = screen.getByLabelText("Invite link") as HTMLInputElement;
    expect(field).toHaveAttribute("readonly");
    expect(field.value).toBe("https://x.example/invite/abc");
    expect(screen.getByText("Expires 15 Oct 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("https://x.example/invite/abc");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("surfaces a clipboard failure instead of claiming it copied", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, configurable: true });
    invite({ status: "done", link: "https://x.example/i", expiresLabel: "Expires soon" });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Couldn't copy. Select the link and copy it.")).toBeInTheDocument();
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });
});
