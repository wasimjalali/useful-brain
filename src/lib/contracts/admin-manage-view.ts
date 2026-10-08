// View-model types for the admin Sources and People screens.
// Components are presentational; pages map Brain responses into these shapes.

export type SourceStatus = "active" | "draft" | "failed";

export type ActiveGenerationView = {
  id: string;
  promotedLabel: string;
  documents: number;
  chunks: number;
  retrieval: string;
};

export type DraftGenerationView =
  | {
      state: "building";
      id: string;
      embeddedChunks: number;
      totalChunks: number;
      documents: number;
      failed: number;
    }
  | { state: "checks_passed"; id: string; summary: string }
  | { state: "checks_failed"; id: string; summary: string }
  | { state: "paused"; id: string; summary: string };

export type SourceRowView = {
  id: string;
  /** Null for a private-owner document: the title is never shown to an admin. */
  title: string | null;
  fileName: string | null;
  /** Human-readable failure line, shown in place of the file name. */
  errorMessage: string | null;
  department: string;
  readers: string;
  chunks: number | null;
  updatedLabel: string;
  status: SourceStatus;
};

export type SourceFilter = "all" | SourceStatus;

export type SourceCounts = Record<SourceFilter, number>;

export type UploadStage = "parsing" | "chunking" | "embedding" | "ready" | "failed";

export type UploadFileView = {
  id: string;
  name: string;
  sizeLabel: string;
  stage: UploadStage;
  error?: string;
  /** Who can read this file, fixed when its upload started. */
  readers?: string;
  /** Replaces the stage text, for example when polling stopped. */
  note?: string;
};

export type UploadScope = "everyone" | "departments" | "roles";

export const UPLOAD_DEPARTMENTS = [
  "Engineering",
  "Executive",
  "Finance",
  "HR",
  "Legal",
  "Operations",
  "Sales",
  "Support",
] as const;

export const UPLOAD_ROLES = [
  "Managers",
  "Directors",
  "HR managers",
  "Finance managers",
  "Support managers",
  "Sales managers",
] as const;

export const UPLOAD_ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".md", ".markdown", ".txt"] as const;
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export type PersonRowView = {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "Member";
  department: string;
  readableCount: number;
  lastActiveLabel: string;
};

export type GroupRowView = {
  id: string;
  name: string;
  type: "Built in" | "Department" | "Role";
  people: number;
  addsDocuments: string;
  rule: string;
};

export type PeopleTab = "people" | "groups";

export type InviteInput = {
  email: string;
  department: string;
};

export type InviteState =
  | { status: "form"; error?: string; fieldErrors?: { email?: string } }
  | { status: "submitting" }
  | { status: "done"; link: string; expiresLabel: string };
