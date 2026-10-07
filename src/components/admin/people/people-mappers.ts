import type {
  GroupRowView,
  InviteState,
  PersonRowView,
} from "@/lib/contracts/admin-manage-view";
import type { GroupView, InviteReason, PersonView } from "@/lib/contracts/people";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function capitalize(value: string): string {
  return value === "hr" ? "HR" : value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function lastActiveLabel(lastActive: number | null, now: number): string {
  if (lastActive === null) {
    return "Never";
  }
  const minutes = Math.floor((now - lastActive) / 60_000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDate(lastActive);
}

export function mapPeople(people: PersonView[], now = Date.now()): PersonRowView[] {
  return people.map((person) => ({
    id: person.id,
    name: person.name,
    email: person.email,
    role: person.role === "admin" ? "Admin" : "Member",
    department: person.department ? capitalize(person.department) : "None",
    readableCount: person.readableDocuments,
    lastActiveLabel: lastActiveLabel(person.lastActive, now),
  }));
}

const GROUP_TYPES: Record<GroupView["type"], GroupRowView["type"]> = {
  built_in: "Built in",
  department: "Department",
  role: "Role",
};

export function mapGroups(groups: GroupView[]): GroupRowView[] {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    type: GROUP_TYPES[group.type],
    people: group.people,
    addsDocuments:
      group.addsDocuments === 0
        ? "None"
        : `+${group.addsDocuments} ${group.addsDocuments === 1 ? "document" : "documents"}`,
    rule: group.rule,
  }));
}

export function filterPeople(people: PersonRowView[], query: string): PersonRowView[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return people;
  }
  return people.filter(
    (person) =>
      person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle),
  );
}

export function filterGroups(groups: GroupRowView[], query: string): GroupRowView[] {
  const needle = query.trim().toLowerCase();
  return needle ? groups.filter((group) => group.name.toLowerCase().includes(needle)) : groups;
}

export function absoluteInviteLink(origin: string, path: string): string {
  return `${origin}${path}`;
}

export function expiresLabel(expiresAt: number): string {
  return `Expires ${formatDate(expiresAt)}`;
}

/** Maps a Brain invite error reason to dialog state. Anything else stays generic. */
export function inviteFailure(reason: InviteReason | undefined): Extract<InviteState, { status: "form" }> {
  switch (reason) {
    case "invalid_email":
      return { status: "form", fieldErrors: { email: "Enter a valid email address" } };
    case "account_exists":
      return { status: "form", fieldErrors: { email: "That email already has an account" } };
    case "invite_open":
      return { status: "form", fieldErrors: { email: "An invite is already open for that email" } };
    default:
      return { status: "form", error: "Couldn't create the invite." };
  }
}
