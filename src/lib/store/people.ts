import { countReadableDocuments } from "../acl/access";
import {
  NORTHWIND_DEPARTMENTS,
  NORTHWIND_ROLES,
  PEOPLE_LIST_CAP,
  type GroupView,
  type PersonView,
} from "../contracts/people";
import { ADMIN_ROLE } from "../auth/admin";
import type { OperationsDatabase } from "./conversations";

type CorpusCounter = Parameters<typeof countReadableDocuments>[0];

type PersonRow = {
  id: string;
  email: string;
  name: string;
  roles: string;
  departments: string;
  last_active: number | null;
};

export async function listPeople(
  operations: OperationsDatabase,
  corpus: CorpusCounter | undefined,
  generationId: string | null,
): Promise<{ people: PersonView[]; total: number }> {
  const [rows, totalRow] = await Promise.all([
    operations
      .prepare(
        `SELECT p.id AS id, u.email AS email, u.name AS name,
                COALESCE((SELECT json_group_array(role) FROM roles WHERE principal_id = p.id), '[]') AS roles,
                COALESCE((SELECT json_group_array(department) FROM departments WHERE principal_id = p.id), '[]') AS departments,
                MAX(
                  COALESCE((SELECT MAX(created_at) FROM auth_sessions WHERE user_id = p.id), 0),
                  COALESCE((SELECT MAX(m.created_at) FROM messages m
                            JOIN conversations c ON c.id = m.conversation_id
                            WHERE c.owner_principal_id = p.id AND m.role = 'user'), 0)
                ) AS last_active
         FROM principals p JOIN auth_users u ON u.id = p.id
         WHERE p.kind = 'user'
         ORDER BY u.name COLLATE NOCASE, u.email
         LIMIT ?`,
      )
      .bind(PEOPLE_LIST_CAP)
      .all<PersonRow>(),
    operations
      .prepare(`SELECT COUNT(*) AS n FROM principals p JOIN auth_users u ON u.id = p.id WHERE p.kind = 'user'`)
      .first<{ n: number }>(),
  ]);
  const people: PersonView[] = [];
  for (const row of rows.results) {
    const roles = JSON.parse(row.roles) as string[];
    const departments = (JSON.parse(row.departments) as string[]).sort();
    const readable =
      corpus && generationId
        ? await countReadableDocuments(corpus, generationId, { userId: row.id, roles, departments })
        : 0;
    people.push({
      id: row.id,
      name: row.name,
      email: row.email,
      role: roles.includes(ADMIN_ROLE) ? "admin" : "member",
      department: departments[0] ?? null,
      readableDocuments: readable,
      lastActive: row.last_active && row.last_active > 0 ? row.last_active : null,
    });
  }
  return { people, total: Number(totalRow?.n ?? 0) };
}

export async function countActiveDocuments(
  corpus: { prepare(query: string): { bind(...values: string[]): { first<T>(): Promise<T | null> } } },
  generationId: string,
): Promise<number> {
  const row = await corpus
    .prepare(`SELECT COUNT(DISTINCT document_id) AS n FROM chunks WHERE generation_id = ?`)
    .bind(generationId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** Groups are derived: the built-in Everyone, every department and every non-standard role. */
export async function listGroups(
  operations: OperationsDatabase,
  corpus: CorpusCounter | undefined,
  generationId: string | null,
): Promise<GroupView[]> {
  const probe = async (roles: string[], departments: string[]) =>
    corpus && generationId
      ? countReadableDocuments(corpus, generationId, { userId: "", roles, departments })
      : 0;
  const everyone = await probe([], []);
  const [totalRow, departmentRows, roleRows] = await Promise.all([
    operations
      .prepare(`SELECT COUNT(*) AS n FROM principals p JOIN auth_users u ON u.id = p.id WHERE p.kind = 'user'`)
      .first<{ n: number }>(),
    operations
      .prepare(
        `SELECT d.department AS key, COUNT(DISTINCT d.principal_id) AS n
         FROM departments d JOIN auth_users u ON u.id = d.principal_id GROUP BY d.department`,
      )
      .all<{ key: string; n: number }>(),
    operations
      .prepare(
        `SELECT r.role AS key, COUNT(DISTINCT r.principal_id) AS n
         FROM roles r JOIN auth_users u ON u.id = r.principal_id GROUP BY r.role`,
      )
      .all<{ key: string; n: number }>(),
  ]);
  const deptCount = new Map(departmentRows.results.map((row) => [row.key, Number(row.n)]));
  const roleCount = new Map(roleRows.results.map((row) => [row.key, Number(row.n)]));
  const groups: GroupView[] = [
    {
      id: "everyone",
      name: "Everyone",
      type: "built_in",
      people: Number(totalRow?.n ?? 0),
      addsDocuments: everyone,
      rule: "all members",
    },
  ];
  for (const department of NORTHWIND_DEPARTMENTS) {
    groups.push({
      id: `department:${department}`,
      name: department,
      type: "department",
      people: deptCount.get(department) ?? 0,
      addsDocuments: (await probe([], [department])) - everyone,
      rule: `department = ${department}`,
    });
  }
  for (const role of NORTHWIND_ROLES) {
    if (role === "standard") {
      continue;
    }
    groups.push({
      id: `role:${role}`,
      name: role,
      type: "role",
      people: roleCount.get(role) ?? 0,
      addsDocuments: (await probe([role], [])) - everyone,
      rule: `role = ${role}`,
    });
  }
  return groups;
}
