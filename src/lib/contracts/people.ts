export const NORTHWIND_DEPARTMENTS = [
  "engineering",
  "executive",
  "finance",
  "hr",
  "legal",
  "operations",
  "sales",
  "support",
] as const;

/** Roles an invite may grant. `admin` is deliberately absent (D11). */
export const NORTHWIND_ROLES = [
  "standard",
  "manager",
  "director",
  "hr_manager",
  "finance_manager",
  "sales_manager",
  "support_manager",
  "executive",
  "it_admin",
] as const;

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PEOPLE_LIST_CAP = 200;

export type PersonView = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  department: string | null;
  readableDocuments: number;
  lastActive: number | null;
};

export type PeopleResponse = {
  people: PersonView[];
  total: number;
  activeDocuments: number;
};

export type GroupView = {
  id: string;
  name: string;
  type: "built_in" | "department" | "role";
  people: number;
  addsDocuments: number;
  rule: string;
};

export type GroupsResponse = { groups: GroupView[] };

export type CreateInviteRequest = { email: string; role: string; department: string };
export type CreateInviteResponse = { url: string; expiresAt: number };

/** Stable reason on a rejected invite; the dialog maps on this, never on message text. */
export const INVITE_REASONS = [
  "invalid_email",
  "invalid_role",
  "invalid_department",
  "account_exists",
  "invite_open",
] as const;
export type InviteReason = (typeof INVITE_REASONS)[number];

export type CreateInviteResult =
  | { ok: true; data: CreateInviteResponse }
  | {
      ok: false;
      error: { code: string; message: string; retryable: boolean; reason?: InviteReason };
    };
