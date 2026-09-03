import { sha256Hex } from "../ingest/digests";
import type { DirectoryRecord } from "./principal";
import { hashPassword, verifyPassword } from "./password";
import {
  AuthConflictError,
  AuthInvalidCredentialsError,
  AuthRateLimitedError,
  AuthValidationError,
} from "./session-errors";
import { SESSION_TTL_SECONDS } from "./session-cookie";
import { newBoundedId, type OperationsDatabase } from "../store/conversations";
import { LOAD_PRINCIPAL_SQL, type PrincipalDirectoryRow } from "../store/principal-directory";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 80;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;

export type AuthUserView = {
  id: string;
  email: string;
  name: string;
};

export type AuthSessionResult = {
  user: AuthUserView;
  sessionToken: string;
};

type AuthUserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
};

function parseJsonList(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  return JSON.parse(value) as string[];
}

function directoryFromRow(row: PrincipalDirectoryRow): DirectoryRecord {
  return {
    id: row.id,
    subject: row.subject,
    kind: row.kind,
    roles: parseJsonList(row.roles),
    departments: parseJsonList(row.departments),
  };
}

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new AuthValidationError("Enter an email address.");
  }
  const email = raw.trim().toLowerCase();
  if (!email) {
    throw new AuthValidationError("Enter an email address.");
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    throw new AuthValidationError("That email is too long.");
  }
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) {
    throw new AuthValidationError("Enter a valid email address.");
  }
  if (email.includes(" ")) {
    throw new AuthValidationError("Enter a valid email address.");
  }
  return email;
}

export function normalizePassword(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new AuthValidationError("Enter a password.");
  }
  if (raw.length < MIN_PASSWORD_LENGTH) {
    throw new AuthValidationError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (raw.length > MAX_PASSWORD_LENGTH) {
    throw new AuthValidationError("That password is too long.");
  }
  return raw;
}

export function nameFromEmail(email: string, rawName: unknown): string {
  if (typeof rawName === "string" && rawName.trim()) {
    const name = rawName.trim().slice(0, MAX_NAME_LENGTH);
    if (name) {
      return name;
    }
  }
  const local = email.slice(0, email.indexOf("@")).replace(/[._-]+/g, " ").trim();
  return (local || "Account").slice(0, MAX_NAME_LENGTH);
}

async function tokenHash(token: string): Promise<string> {
  return sha256Hex(token);
}

function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function failedLoginCount(
  db: OperationsDatabase,
  email: string,
  now: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM auth_login_attempts
       WHERE email = ? AND attempted_at > ?`,
    )
    .bind(email, now - LOGIN_WINDOW_MS)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function recordFailedLogin(db: OperationsDatabase, email: string, now: number): Promise<void> {
  await db
    .prepare(`INSERT INTO auth_login_attempts (email, attempted_at) VALUES (?, ?)`)
    .bind(email, now)
    .run();
}

export async function createAccount(
  db: OperationsDatabase,
  input: { email: unknown; password: unknown; name?: unknown },
  now = Date.now(),
): Promise<AuthSessionResult> {
  const email = normalizeEmail(input.email);
  const password = normalizePassword(input.password);
  const name = nameFromEmail(email, input.name);
  const existing = await db
    .prepare(`SELECT id FROM auth_users WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();
  if (existing) {
    throw new AuthConflictError();
  }
  const principalId = newBoundedId("p");
  const sessionId = newBoundedId("s");
  const sessionToken = newSessionToken();
  const passwordHash = await hashPassword(password);
  const hashedToken = await tokenHash(sessionToken);
  const expiresAt = now + SESSION_TTL_SECONDS * 1000;
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO principals (id, kind, subject, created_at)
           VALUES (?, 'user', ?, ?)`,
        )
        .bind(principalId, email, now),
      db
        .prepare(
          `INSERT INTO auth_users (id, email, name, password_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(principalId, email, name, passwordHash, now, now),
      db
        .prepare(
          `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(sessionId, principalId, hashedToken, expiresAt, now),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique/i.test(message)) {
      throw new AuthConflictError();
    }
    throw error;
  }
  return {
    user: { id: principalId, email, name },
    sessionToken,
  };
}

export async function authenticateAccount(
  db: OperationsDatabase,
  input: { email: unknown; password: unknown },
  now = Date.now(),
): Promise<AuthSessionResult> {
  let email: string;
  try {
    email = normalizeEmail(input.email);
  } catch {
    throw new AuthInvalidCredentialsError();
  }
  if (typeof input.password !== "string" || input.password.length === 0 || input.password.length > MAX_PASSWORD_LENGTH) {
    throw new AuthInvalidCredentialsError();
  }
  const password = input.password;
  if ((await failedLoginCount(db, email, now)) >= MAX_FAILED_LOGINS) {
    throw new AuthRateLimitedError();
  }
  const user = await db
    .prepare(
      `SELECT id, email, name, password_hash FROM auth_users WHERE email = ?`,
    )
    .bind(email)
    .first<AuthUserRow>();
  if (!user) {
    await verifyPassword(password, await hashPassword("timing-pad"));
    await recordFailedLogin(db, email, now);
    throw new AuthInvalidCredentialsError();
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await recordFailedLogin(db, email, now);
    throw new AuthInvalidCredentialsError();
  }
  const sessionId = newBoundedId("s");
  const sessionToken = newSessionToken();
  const hashedToken = await tokenHash(sessionToken);
  const expiresAt = now + SESSION_TTL_SECONDS * 1000;
  await db
    .prepare(
      `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(sessionId, user.id, hashedToken, expiresAt, now)
    .run();
  return {
    user: { id: user.id, email: user.email, name: user.name },
    sessionToken,
  };
}

export async function revokeSession(
  db: OperationsDatabase,
  token: string | null,
): Promise<void> {
  if (!token) {
    return;
  }
  const hashedToken = await tokenHash(token);
  await db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).bind(hashedToken).run();
}

export async function resolveSessionPrincipal(
  db: OperationsDatabase,
  token: string | null,
  now = Date.now(),
): Promise<DirectoryRecord | null> {
  if (!token) {
    return null;
  }
  const hashedToken = await tokenHash(token);
  const row = await db
    .prepare(
      `SELECT p.id AS id, p.subject AS subject, p.kind AS kind,
              COALESCE((
                SELECT json_group_array(role) FROM roles WHERE principal_id = p.id
              ), '[]') AS roles,
              COALESCE((
                SELECT json_group_array(department) FROM departments WHERE principal_id = p.id
              ), '[]') AS departments
       FROM auth_sessions s
       JOIN auth_users u ON u.id = s.user_id
       JOIN principals p ON p.id = u.id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(hashedToken, now)
    .first<PrincipalDirectoryRow>();
  if (!row) {
    return null;
  }
  return directoryFromRow(row);
}

export async function loadDirectoryBySubject(
  db: OperationsDatabase,
  subject: string,
  kind: "user" | "service_token",
): Promise<DirectoryRecord | null> {
  const row = await db
    .prepare(LOAD_PRINCIPAL_SQL)
    .bind(subject, kind)
    .first<PrincipalDirectoryRow>();
  if (!row) {
    return null;
  }
  return directoryFromRow(row);
}
