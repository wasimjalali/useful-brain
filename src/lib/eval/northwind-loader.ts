import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { AccessScope } from "../acl/acl-group";
import type { Principal } from "../acl/access";

export class EvalCorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalCorpusError";
  }
}

export const EVAL_CATEGORIES = [
  "factual",
  "trap",
  "permission",
  "unanswerable",
  "multi_hop",
  "multi_hop_expanded",
] as const;

export type EvalCategory = (typeof EVAL_CATEGORIES)[number];
export const ABSTENTION_CATEGORIES = new Set<EvalCategory>(["permission", "unanswerable"]);
export const QUESTION_FIELDS = new Set([
  "id",
  "category",
  "query",
  "principal",
  "expected_document_ids",
  "expected_sections",
  "forbidden_document_ids",
  "note",
]);

export type NorthwindDocument = {
  documentId: string;
  title: string;
  sourceName: string;
  sourcePath: string;
  department: string;
  accessScope: AccessScope;
  allowedRoles: string[];
  allowedDepartments: string[];
  version: string;
  effectiveDate: string;
  body: string;
  metadata: Record<string, unknown>;
};

export type EvalQuestion = {
  questionId: string;
  category: EvalCategory;
  query: string;
  principal: Principal;
  expectedDocumentIds: string[];
  expectedSections: string[];
  forbiddenDocumentIds: string[];
  note: string;
};

const SCOPES = new Set(["public", "role", "department", "private"]);

function walkMarkdown(root: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === "README.md" || name === "questions.json") {
      continue;
    }
    const full = path.join(root, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkMarkdown(full));
    } else if (name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files.sort();
}

export function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const header = raw.match(/^---\r?\n/);
  if (!header) {
    throw new EvalCorpusError("document is missing YAML frontmatter");
  }
  const end = raw.indexOf("\n---", header[0].length - 1);
  if (end < 0) {
    throw new EvalCorpusError("document frontmatter is not closed");
  }
  const block = raw.slice(header[0].length, end).replace(/\r/g, "");
  const closer = raw.slice(end + 1).match(/^---\r?\n?/);
  const body = raw.slice(end + 1 + (closer?.[0].length ?? 3)).replace(/^\r?\n/, "");
  const meta: Record<string, unknown> = {};
  for (const line of block.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const idx = line.indexOf(":");
    if (idx < 0) {
      throw new EvalCorpusError(`invalid frontmatter line: ${line}`);
    }
    const key = line.slice(0, idx).trim();
    meta[key] = parseScalar(line.slice(idx + 1).trim());
  }
  return { meta, body };
}

function parseScalar(value: string): unknown {
  if (value === "[]") {
    return [];
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner.split(",").map((item) => unquote(item.trim()));
  }
  return unquote(value);
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadDocuments(root: string): NorthwindDocument[] {
  const documents: NorthwindDocument[] = [];
  const seen = new Set<string>();
  for (const file of walkMarkdown(root)) {
    const parsed = parseFrontmatter(readFileSync(file, "utf8"));
    const documentId = String(parsed.meta.document_id ?? "");
    if (!documentId) {
      throw new EvalCorpusError(`${file} is missing document_id`);
    }
    if (seen.has(documentId)) {
      throw new EvalCorpusError(`duplicate document_id ${documentId}`);
    }
    seen.add(documentId);
    const accessScope = String(parsed.meta.access_scope ?? "");
    if (!SCOPES.has(accessScope)) {
      throw new EvalCorpusError(`${documentId} has invalid access_scope ${accessScope}`);
    }
    documents.push({
      documentId,
      title: String(parsed.meta.title ?? ""),
      sourceName: String(parsed.meta.source_name ?? ""),
      sourcePath: String(parsed.meta.source_path ?? ""),
      department: String(parsed.meta.department ?? ""),
      accessScope: accessScope as AccessScope,
      allowedRoles: Array.isArray(parsed.meta.allowed_roles) ? parsed.meta.allowed_roles.map(String) : [],
      allowedDepartments: Array.isArray(parsed.meta.allowed_departments)
        ? parsed.meta.allowed_departments.map(String)
        : [],
      version: String(parsed.meta.version ?? ""),
      effectiveDate: String(parsed.meta.effective_date ?? ""),
      body: parsed.body,
      metadata: parsed.meta,
    });
  }
  return documents;
}

export function loadQuestions(
  file: string,
  documents: NorthwindDocument[],
): { principals: Record<string, Principal>; questions: EvalQuestion[] } {
  const payload = JSON.parse(readFileSync(file, "utf8")) as {
    principals?: Record<string, { user_id?: string; roles?: string[]; departments?: string[] }>;
    questions?: Array<Record<string, unknown>>;
  };
  const documentIds = new Set(documents.map((document) => document.documentId));
  const principals: Record<string, Principal> = {};
  for (const [key, value] of Object.entries(payload.principals ?? {})) {
    principals[key] = {
      userId: String(value.user_id ?? key),
      roles: value.roles ?? [],
      departments: value.departments ?? [],
    };
  }
  const questions: EvalQuestion[] = [];
  const seen = new Set<string>();
  for (const raw of payload.questions ?? []) {
    for (const key of Object.keys(raw)) {
      if (!QUESTION_FIELDS.has(key)) {
        throw new EvalCorpusError(`unknown question field ${key}`);
      }
    }
    const questionId = String(raw.id ?? "");
    if (!questionId) {
      throw new EvalCorpusError("question is missing id");
    }
    if (seen.has(questionId)) {
      throw new EvalCorpusError(`duplicate eval key ${questionId}`);
    }
    seen.add(questionId);
    const category = String(raw.category ?? "") as EvalCategory;
    if (!EVAL_CATEGORIES.includes(category)) {
      throw new EvalCorpusError(`${questionId} has invalid category ${category}`);
    }
    const principalKey = String(raw.principal ?? "");
    const principal = principals[principalKey];
    if (!principal) {
      throw new EvalCorpusError(`${questionId} names unknown principal ${principalKey}`);
    }
    const expected = Array.isArray(raw.expected_document_ids) ? raw.expected_document_ids.map(String) : [];
    for (const documentId of expected) {
      if (!documentIds.has(documentId)) {
        throw new EvalCorpusError(`${questionId} names missing document ${documentId}`);
      }
    }
    const forbidden = Array.isArray(raw.forbidden_document_ids) ? raw.forbidden_document_ids.map(String) : [];
    questions.push({
      questionId,
      category,
      query: String(raw.query ?? ""),
      principal,
      expectedDocumentIds: expected,
      expectedSections: Array.isArray(raw.expected_sections) ? raw.expected_sections.map(String) : [],
      forbiddenDocumentIds: forbidden,
      note: String(raw.note ?? ""),
    });
  }
  return { principals, questions };
}

export function loadNorthwindCorpus(root = path.join(process.cwd(), "content/northwind")) {
  const documents = loadDocuments(root);
  const loaded = loadQuestions(path.join(root, "questions.json"), documents);
  return { documents, ...loaded };
}
