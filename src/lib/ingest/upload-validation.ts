import type { AccessScope } from "../acl/acl-group";
import { ADMIN_ROLE } from "../auth/admin";
import { BoundedIdError, parseMutatingIdempotencyKey } from "../cf/bounded-id";
import { WorkerValidationError } from "../cf/worker-errors";
import type { UploadReaders, UploadRequest } from "../contracts/sources";
import { sha256Hex } from "./digests";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 25;
export const MAX_FILE_NAME_LENGTH = 200;
export const UPLOAD_EXTENSIONS = ["pdf", "docx", "md", "markdown", "txt"] as const;
export type UploadExtension = (typeof UPLOAD_EXTENSIONS)[number];

/** Department ids the Northwind directory uses. */
export const KNOWN_DEPARTMENTS = [
  "engineering",
  "executive",
  "finance",
  "hr",
  "legal",
  "operations",
  "sales",
  "support",
] as const;

/** Role ids a document can be limited to. `admin` is never a read grant. */
export const KNOWN_READER_ROLES = [
  "director",
  "executive",
  "finance_manager",
  "hr_manager",
  "manager",
  "sales_manager",
  "support_manager",
] as const;

export type UploadAcl = {
  accessScope: Exclude<AccessScope, "private">;
  allowedRoles: string[];
  allowedDepartments: string[];
};

function reject(): never {
  throw new WorkerValidationError();
}

function validNames(value: unknown, vocabulary: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > vocabulary.length) {
    return reject();
  }
  const names = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !vocabulary.includes(item) || item === ADMIN_ROLE) {
      return reject();
    }
    names.add(item);
  }
  return [...names].sort();
}

export function readersToAcl(readers: UploadReaders): UploadAcl {
  const record = readers as { kind?: unknown; names?: unknown } | null;
  if (!record || typeof record !== "object") {
    return reject();
  }
  if (record.kind === "everyone") {
    return { accessScope: "public", allowedRoles: [], allowedDepartments: [] };
  }
  if (record.kind === "departments") {
    return {
      accessScope: "department",
      allowedRoles: [],
      allowedDepartments: validNames(record.names, KNOWN_DEPARTMENTS),
    };
  }
  if (record.kind === "roles") {
    return {
      accessScope: "role",
      allowedRoles: validNames(record.names, KNOWN_READER_ROLES),
      allowedDepartments: [],
    };
  }
  return reject();
}

export function fileExtension(name: string): UploadExtension | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const extension = name.slice(dot + 1).toLowerCase();
  return (UPLOAD_EXTENSIONS as readonly string[]).includes(extension)
    ? (extension as UploadExtension)
    : null;
}

export function normalizedFileName(name: string): string {
  return name.trim().toLowerCase();
}

function validFileName(name: unknown): string {
  if (typeof name !== "string") {
    return reject();
  }
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_FILE_NAME_LENGTH ||
    /[/\\\u0000-\u001f\u007f]/.test(trimmed) ||
    trimmed.startsWith(".") ||
    fileExtension(trimmed) === null
  ) {
    return reject();
  }
  return trimmed;
}

/** Validates the create-batch body. Every failure is the uniform validation error. */
export function parseUploadRequest(body: unknown): UploadRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reject();
  }
  const record = body as Record<string, unknown>;
  let idempotencyKey: string;
  try {
    idempotencyKey = parseMutatingIdempotencyKey(record.idempotencyKey);
  } catch (error) {
    if (error instanceof BoundedIdError) {
      return reject();
    }
    throw error;
  }
  readersToAcl(record.readers as UploadReaders);
  const rawFiles = record.files;
  if (!Array.isArray(rawFiles) || rawFiles.length === 0 || rawFiles.length > MAX_UPLOAD_FILES) {
    return reject();
  }
  const seen = new Set<string>();
  const files = rawFiles.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") {
      return reject();
    }
    const item = raw as { name?: unknown; size?: unknown };
    const name = validFileName(item.name);
    const size = item.size;
    if (
      typeof size !== "number" ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > MAX_UPLOAD_BYTES
    ) {
      return reject();
    }
    const key = normalizedFileName(name);
    if (seen.has(key)) {
      return reject();
    }
    seen.add(key);
    return { name, size };
  });
  return { readers: record.readers as UploadReaders, idempotencyKey, files };
}

/** One stable document id per file name, so re-uploading replaces instead of duplicating. */
export async function uploadDocumentId(fileName: string): Promise<string> {
  return `upl-${(await sha256Hex(normalizedFileName(fileName))).slice(0, 24)}`;
}

export function uploadSourcePath(fileName: string): string {
  return `uploads/${fileName.trim()}`;
}
