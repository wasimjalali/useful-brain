/**
 * Seeds synthetic Northwind people into the LOCAL dev operations database.
 *   npm run seed:demo -- --dry-run     print counts only
 *   DEMO_PASSWORD=... npm run seed:demo
 *   DEMO_PASSWORD=... npm run seed:demo -- --remote --env staging
 * --remote needs an explicit --env <name> (development or staging). It is passed
 * to wrangler, so the environment's own database is used. production is refused.
 * DEMO_PASSWORD must meet the signup rules (8 to 128 characters).
 * DEMO_PASSWORD is read from the environment, never printed, never written to disk.
 * Only Maya Chen, Priya Shah and Jordan Ellis can sign in; the rest get an unusable hash.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { hashPassword } from "../src/lib/auth/password";
import { normalizePassword } from "../src/lib/auth/session-account";

const TOTAL_PEOPLE = 148;
const DEPARTMENT_HEADCOUNT: Array<[string, number]> = [
  ["engineering", 40],
  ["support", 30],
  ["sales", 24],
  ["operations", 18],
  ["finance", 14],
  ["hr", 10],
  ["executive", 6],
  ["legal", 6],
];
const DEPARTMENT_MANAGER_ROLE: Record<string, string> = {
  hr: "hr_manager",
  finance: "finance_manager",
  sales: "sales_manager",
  support: "support_manager",
  executive: "executive",
};
const UNUSABLE_HASH = "disabled";
const OPERATIONS_BINDING = "OPERATIONS_DB";
const REMOTE_ENVIRONMENTS = new Set(["development", "staging"]);

const FIRST = [
  "Aisha", "Ben", "Carla", "Dev", "Elena", "Farid", "Grace", "Hugo", "Ines", "Jamal",
  "Kira", "Leo", "Mina", "Noah", "Olga", "Pavel", "Quinn", "Rosa", "Sam", "Tara",
  "Umar", "Vera", "Will", "Xena", "Yusuf", "Zoe", "Arjun", "Bella", "Chen", "Dara",
];
const LAST = [
  "Adams", "Bauer", "Castro", "Dunn", "Evans", "Fischer", "Gomez", "Hale", "Ito", "Jensen",
  "Khan", "Lopez", "Meyer", "Nolan", "Okafor", "Patel", "Quist", "Reyes", "Silva", "Tran",
  "Usman", "Vega", "Wong", "Xu", "Young", "Zhang", "Baker", "Cole", "Diaz", "Egan",
];

type Person = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  department: string;
  signIn: boolean;
};

const PERSONAS: Person[] = [
  { id: "demo-maya-chen", name: "Maya Chen", email: "maya.chen@northwind.example", roles: ["standard"], department: "engineering", signIn: true },
  { id: "demo-priya-shah", name: "Priya Shah", email: "priya.shah@northwind.example", roles: ["standard"], department: "support", signIn: true },
  { id: "demo-jordan-ellis", name: "Jordan Ellis", email: "jordan.ellis@northwind.example", roles: ["admin", "standard"], department: "operations", signIn: true },
];

function buildPeople(): Person[] {
  const people = [...PERSONAS];
  const taken = new Set(people.map((person) => person.email));
  const remaining = new Map(DEPARTMENT_HEADCOUNT);
  for (const persona of PERSONAS) {
    remaining.set(persona.department, (remaining.get(persona.department) ?? 0) - 1);
  }
  let index = 0;
  for (const [department, count] of remaining) {
    for (let n = 0; n < count; n += 1) {
      const first = FIRST[index % FIRST.length];
      const last = LAST[(index * 7 + Math.floor(index / FIRST.length)) % LAST.length];
      let email = `${first}.${last}@northwind.example`.toLowerCase();
      for (let suffix = 2; taken.has(email); suffix += 1) {
        email = `${first}.${last}${suffix}@northwind.example`.toLowerCase();
      }
      taken.add(email);
      const manager = n % 6 === 0;
      const roles = manager
        ? [n % 18 === 0 ? "director" : (DEPARTMENT_MANAGER_ROLE[department] ?? "manager")]
        : ["standard"];
      people.push({
        id: `demo-${email.split("@")[0].replaceAll(".", "-")}`,
        name: `${first} ${last}`,
        email,
        roles,
        department,
        signIn: false,
      });
      index += 1;
    }
  }
  if (people.length !== TOTAL_PEOPLE) {
    throw new Error(`expected ${TOTAL_PEOPLE} people, built ${people.length}`);
  }
  return people;
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

async function buildSql(people: Person[], password: string): Promise<string> {
  const now = Date.now();
  const lines: string[] = [];
  const signInHash = await hashPassword(password);
  for (const person of people) {
    const hash = person.signIn ? signInHash : UNUSABLE_HASH;
    const rotate = person.signIn
      ? "password_hash = excluded.password_hash"
      : "password_hash = auth_users.password_hash";
    lines.push(
      `INSERT OR IGNORE INTO principals (id, kind, subject, created_at) VALUES (${quote(person.id)}, 'user', ${quote(person.email)}, ${now});`,
      `INSERT INTO auth_users (id, email, name, password_hash, created_at, updated_at) VALUES (${quote(person.id)}, ${quote(person.email)}, ${quote(person.name)}, ${quote(hash)}, ${now}, ${now}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, ${rotate}, updated_at = excluded.updated_at;`,
      `INSERT OR IGNORE INTO departments (principal_id, department) VALUES (${quote(person.id)}, ${quote(person.department)});`,
      ...person.roles.map(
        (role) => `INSERT OR IGNORE INTO roles (principal_id, role) VALUES (${quote(person.id)}, ${quote(role)});`,
      ),
    );
  }
  return lines.join("\n");
}

function countsOf(people: Person[]): string {
  const by = (pick: (person: Person) => string[]) => {
    const counts = new Map<string, number>();
    for (const person of people) {
      for (const key of pick(person)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts].sort().map(([key, n]) => `${key}=${n}`).join(", ");
  };
  return [
    `people: ${people.length} (sign-in personas: ${people.filter((p) => p.signIn).length})`,
    `departments: ${by((p) => [p.department])}`,
    `roles: ${by((p) => p.roles)}`,
  ].join("\n");
}

function parseArgs(argv: string[]): { dryRun: boolean; remote: boolean; env: string | null } {
  let dryRun = false;
  let remote = false;
  let env: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--remote") {
      remote = true;
    } else if (arg === "--env") {
      env = argv[i + 1] ?? "";
      i += 1;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (remote) {
    if (!env || !REMOTE_ENVIRONMENTS.has(env)) {
      throw new Error(`--remote needs --env <${[...REMOTE_ENVIRONMENTS].join("|")}>. production is refused.`);
    }
  } else if (env !== null) {
    throw new Error("--env only applies with --remote");
  }
  return { dryRun, remote, env };
}

async function main(): Promise<void> {
  const { dryRun, remote, env } = parseArgs(process.argv.slice(2));
  const people = buildPeople();
  const targetName = remote ? `remote (${env})` : "local";
  if (dryRun) {
    console.log(`${countsOf(people)}\ntarget: ${targetName} (dry run, nothing written)`);
    return;
  }
  const password = process.env.DEMO_PASSWORD;
  if (!password) {
    throw new Error("DEMO_PASSWORD is not set. Refusing to run.");
  }
  normalizePassword(password);
  const sql = await buildSql(people, password);
  const dir = mkdtempSync(path.join(tmpdir(), "seed-demo-"));
  try {
    const file = path.join(dir, "seed.sql");
    writeFileSync(file, sql, { mode: 0o600 });
    const target = remote ? ["--remote", "--env", env as string] : ["--local", "--persist-to", ".wrangler/state"];
    const childEnv: NodeJS.ProcessEnv = { ...process.env, CI: "true" };
    delete childEnv.DEMO_PASSWORD;
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", OPERATIONS_BINDING, ...target, "-c", "workers/brain/wrangler.jsonc", "--file", file],
      { stdio: "inherit", env: childEnv },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`${countsOf(people)}\nseeded ${targetName} operations database`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
