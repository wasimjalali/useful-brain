import { describe, expect, it } from "vitest";

import {
  absoluteInviteLink,
  expiresLabel,
  filterPeople,
  mapGroups,
  mapPeople,
  inviteFailure,
} from "./people-mappers";

const NOW = Date.UTC(2026, 9, 8, 12, 0);

describe("people mappers", () => {
  it("maps wire people to rows", () => {
    const rows = mapPeople(
      [
        { id: "u1", name: "Priya Shah", email: "p@x.example", role: "member", department: "support", readableDocuments: 31, lastActive: null },
        { id: "u2", name: "Jo", email: "j@x.example", role: "admin", department: null, readableDocuments: 62, lastActive: NOW - 60_000 },
      ],
      NOW,
    );
    expect(rows[0]).toMatchObject({ role: "Member", department: "Support", readableCount: 31, lastActiveLabel: "Never" });
    expect(rows[1]).toMatchObject({ role: "Admin", department: "None", lastActiveLabel: "Just now" });
  });

  it("maps groups", () => {
    expect(
      mapGroups([{ id: "g", name: "HR", type: "role", people: 2, addsDocuments: 1, rule: "role = hr_manager" }]),
    ).toEqual([{ id: "g", name: "HR", type: "Role", people: 2, addsDocuments: "+1 document", rule: "role = hr_manager" }]);
  });

  it("filters by name or email, case-insensitive", () => {
    const rows = mapPeople(
      [
        { id: "1", name: "Priya Shah", email: "a@x.example", role: "member", department: null, readableDocuments: 0, lastActive: null },
        { id: "2", name: "Jo", email: "priya2@x.example", role: "member", department: null, readableDocuments: 0, lastActive: null },
        { id: "3", name: "Kim", email: "k@x.example", role: "member", department: null, readableDocuments: 0, lastActive: null },
      ],
      NOW,
    );
    expect(filterPeople(rows, " PRIYA ").map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterPeople(rows, "")).toHaveLength(3);
  });

  it("builds an absolute link and expiry label", () => {
    expect(absoluteInviteLink("https://app.example", "/invite/abc")).toBe("https://app.example/invite/abc");
    expect(expiresLabel(Date.UTC(2026, 9, 15))).toBe("Expires 15 Oct 2026");
  });

  it("maps each invite failure reason to a field or form error", () => {
    expect(inviteFailure("invalid_email")).toEqual({ status: "form", fieldErrors: { email: "Enter a valid email address" } });
    expect(inviteFailure("invalid_role")).toEqual({ status: "form", error: "Couldn't create the invite." });
    expect(inviteFailure("invalid_department")).toEqual({ status: "form", error: "Couldn't create the invite." });
    expect(inviteFailure("account_exists")).toEqual({ status: "form", fieldErrors: { email: "That email already has an account" } });
    expect(inviteFailure("invite_open")).toEqual({ status: "form", fieldErrors: { email: "An invite is already open for that email" } });
    expect(inviteFailure(undefined)).toEqual({ status: "form", error: "Couldn't create the invite." });
  });

  it("ignores message text entirely", () => {
    expect(inviteFailure("Enter a valid email address." as never)).toEqual({ status: "form", error: "Couldn't create the invite." });
  });
});
