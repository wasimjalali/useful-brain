import { env } from "cloudflare:workers";

import { sha256Hex } from "../../../src/lib/ingest/digests";
import { promoteGeneration } from "../../../src/lib/store/corpus-d1";
import { seedNorthwindCorpus, type SeedDocumentInput } from "../../../src/lib/store/corpus-seed";

export async function seedPrincipals(): Promise<void> {
  await env.OPERATIONS_DB.batch([
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
    ).bind("principal-alice", "user", "alice@karkoai.com", 1),
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO roles (principal_id, role) VALUES (?, ?)`,
    ).bind("principal-alice", "operator"),
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO departments (principal_id, department) VALUES (?, ?)`,
    ).bind("principal-alice", "engineering"),
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
    ).bind("principal-dev", "user", "dev@localhost", 1),
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO roles (principal_id, role) VALUES (?, ?)`,
    ).bind("principal-dev", "operator"),
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
    ).bind("principal-bot", "service_token", "ci-bot.access", 1),
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO roles (principal_id, role) VALUES (?, ?)`,
    ).bind("principal-bot", "ingest"),
  ]);
}

export type PersonaId = "member-maya" | "member-priya" | "member-jordan";

const PERSONAS: Record<
  PersonaId,
  { email: string; name: string; role: string; department: string }
> = {
  "member-maya": {
    email: "maya.chen@northwind.example",
    name: "Maya Chen",
    role: "standard",
    department: "engineering",
  },
  "member-priya": {
    email: "priya.shah@northwind.example",
    name: "Priya Shah",
    role: "standard",
    department: "support",
  },
  "member-jordan": {
    email: "jordan.ellis@northwind.example",
    name: "Jordan Ellis",
    role: "admin",
    department: "operations",
  },
};

/** Inserts a session-mode user and returns its session cookie. */
export async function seedSessionUser(input: {
  id: string;
  email: string;
  name: string;
  roles: string[];
  departments: string[];
}): Promise<string> {
  const db = env.OPERATIONS_DB;
  const token = `${input.id}-session-token`.padEnd(64, "0");
  await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO principals (id, kind, subject, created_at) VALUES (?, 'user', ?, 1)`)
      .bind(input.id, input.email),
    ...input.roles.map((role) =>
      db.prepare(`INSERT OR IGNORE INTO roles (principal_id, role) VALUES (?, ?)`).bind(input.id, role),
    ),
    ...input.departments.map((department) =>
      db
        .prepare(`INSERT OR IGNORE INTO departments (principal_id, department) VALUES (?, ?)`)
        .bind(input.id, department),
    ),
    db
      .prepare(
        `INSERT OR IGNORE INTO auth_users (id, email, name, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, 'not-a-real-hash', 1, 1)`,
      )
      .bind(input.id, input.email, input.name),
    db
      .prepare(
        `INSERT OR IGNORE INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, 1)`,
      )
      .bind(`sess-${input.id}`, input.id, await sha256Hex(token), Date.now() + 86_400_000),
  ]);
  return `usefulbrain.session=${token}`;
}

/** Inserts the three Northwind personas with sessions and returns their cookies. */
export async function seedPersonas(): Promise<Record<PersonaId, string>> {
  const cookies = {} as Record<PersonaId, string>;
  for (const [id, persona] of Object.entries(PERSONAS) as Array<
    [PersonaId, (typeof PERSONAS)[PersonaId]]
  >) {
    cookies[id] = await seedSessionUser({
      id,
      email: persona.email,
      name: persona.name,
      roles: [persona.role],
      departments: [persona.department],
    });
  }
  return cookies;
}

function longBody(title: string, headings: string[]): string {
  return headings
    .map((heading, index) => {
      const paragraph = Array.from(
        { length: 60 },
        (_, line) => `${title} ${heading} note ${index}-${line} covers the synthetic procedure.`,
      ).join(" ");
      return `## ${heading}\n\n${paragraph}`;
    })
    .join("\n\n")
    .replace(/^/, `# ${title}\n\n`);
}

export const CORPUS_DOCUMENT_IDS = [
  "doc-public-handbook",
  "doc-public-security",
  "doc-eng-runbook",
  "doc-support-playbook",
  "doc-ops-vendors",
  "doc-finance-policy",
  "doc-manager-comp",
  "doc-private-maya",
] as const;

export const CORPUS_DOCUMENTS: SeedDocumentInput[] = [
  {
    documentId: "doc-public-handbook",
    title: "Employee Handbook",
    sourceName: "Northwind Handbook",
    sourcePath: "northwind/company/employee-handbook.md",
    accessScope: "public",
    allowedRoles: [],
    allowedDepartments: [],
    body: longBody("Employee Handbook", ["Working hours", "Leave"]),
    metadata: { department: "hr", version: "3.1", effective_date: "2026-01-01" },
  },
  {
    documentId: "doc-public-security",
    title: "Security Basics",
    sourceName: "Northwind Security",
    sourcePath: "northwind/company/security-basics.md",
    accessScope: "public",
    allowedRoles: [],
    allowedDepartments: [],
    body: "# Security Basics\n\n## Passwords\n\nUse a password manager for every account.",
  },
  {
    documentId: "doc-eng-runbook",
    title: "Incident Runbook",
    sourceName: "Northwind Engineering",
    sourcePath: "northwind/engineering/incident-runbook.md",
    accessScope: "department",
    allowedRoles: [],
    allowedDepartments: ["engineering"],
    body: longBody("Incident Runbook", ["Paging", "Rollback", "Postmortem"]),
    metadata: { department: "engineering", version: "2.0" },
  },
  {
    documentId: "doc-support-playbook",
    title: "Support Playbook",
    sourceName: "Northwind Support",
    sourcePath: "northwind/support/support-playbook.md",
    accessScope: "department",
    allowedRoles: [],
    allowedDepartments: ["support"],
    body: "# Support Playbook\n\n## Escalation\n\nEscalate P0 tickets within ten minutes.",
    metadata: { department: "support" },
  },
  {
    documentId: "doc-ops-vendors",
    title: "Vendor List",
    sourceName: "Northwind Operations",
    sourcePath: "northwind/operations/vendor-list.md",
    accessScope: "department",
    allowedRoles: [],
    allowedDepartments: ["operations"],
    body: "# Vendor List\n\n## Approved\n\nThe approved vendor list is reviewed each quarter.",
    metadata: { department: "operations" },
  },
  {
    documentId: "doc-finance-policy",
    title: "Budget Approval Policy",
    sourceName: "Northwind Finance",
    sourcePath: "northwind/finance/budget-approval.md",
    accessScope: "role",
    allowedRoles: ["finance_manager"],
    allowedDepartments: [],
    body: "# Budget Approval Policy\n\n## Limits\n\nSpend above the limit needs finance approval.",
    metadata: { department: "finance" },
  },
  {
    documentId: "doc-manager-comp",
    title: "Manager Compensation Bands",
    sourceName: "Northwind HR",
    sourcePath: "northwind/hr/manager-compensation.md",
    accessScope: "role",
    allowedRoles: ["manager"],
    allowedDepartments: [],
    body: "# Manager Compensation Bands\n\n## Bands\n\nBands are reviewed every year.",
    metadata: { department: "hr" },
  },
  {
    documentId: "doc-private-maya",
    title: "Maya Private Notes",
    sourceName: "Maya upload",
    sourcePath: "uploads/maya-notes.md",
    accessScope: "private",
    allowedRoles: [],
    allowedDepartments: [],
    body: "# Maya Private Notes\n\n## Notes\n\nPrivate planning notes for the quarter.",
    metadata: { owner_user_id: "member-maya" },
  },
];

/** Readable document count per persona over CORPUS_DOCUMENTS (8 in total). */
export const EXPECTED_READABLE: Record<PersonaId, number> = {
  "member-maya": 4,
  "member-priya": 3,
  "member-jordan": 3,
};

/** Seeds CORPUS_DOCUMENTS keyword-only (no AI, no Vectorize) and marks it active. */
export async function seedCorpus(): Promise<{ generationId: string; chunkCount: number }> {
  const result = await seedNorthwindCorpus({ db: env.CORPUS_DB, documents: CORPUS_DOCUMENTS });
  await promoteGeneration(env.CORPUS_DB, result.generationId);
  return { generationId: result.generationId, chunkCount: result.chunkCount };
}
