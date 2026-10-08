import { sha256Hex } from "../ingest/digests";
import { hashPassword } from "../auth/password";
import { SESSION_TTL_SECONDS } from "../auth/session-cookie";
import {
  normalizeEmail,
  normalizePassword,
  nameFromEmail,
  type AuthSessionResult,
} from "../auth/session-account";
import { AuthValidationError } from "../auth/session-errors";
import {
  INVITE_TTL_MS,
  NORTHWIND_DEPARTMENTS,
  NORTHWIND_ROLES,
  type CreateInviteResponse,
  type InviteReason,
} from "../contracts/people";
import { newBoundedId, type OperationsDatabase } from "./conversations";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** One generic failure for replayed, expired and unknown tokens. */
export class InviteInvalidError extends Error {
  constructor() {
    super("This invite link is no longer valid.");
    this.name = "InviteInvalidError";
  }
}

/** A rejected invite request. Maps to VALIDATION_FAILED like any auth validation error. */
export class InviteRequestError extends AuthValidationError {
  constructor(
    readonly reason: InviteReason,
    message: string,
  ) {
    super(message);
    this.name = "InviteRequestError";
  }
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function changesOf(result: unknown): number {
  return Number((result as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
}

export async function createInvite(
  db: OperationsDatabase,
  input: { email: unknown; role: unknown; department: unknown; createdBy: string },
  now = Date.now(),
): Promise<CreateInviteResponse> {
  let email: string;
  try {
    email = normalizeEmail(input.email);
  } catch (error) {
    if (error instanceof AuthValidationError) {
      throw new InviteRequestError("invalid_email", error.message);
    }
    throw error;
  }
  if (typeof input.role !== "string" || !(NORTHWIND_ROLES as readonly string[]).includes(input.role)) {
    throw new InviteRequestError("invalid_role", "Choose a valid role.");
  }
  if (
    typeof input.department !== "string" ||
    !(NORTHWIND_DEPARTMENTS as readonly string[]).includes(input.department)
  ) {
    throw new InviteRequestError("invalid_department", "Choose a valid department.");
  }
  // A user principal can exist without an auth_users row (loopback operator,
  // directory-loaded users). Accepting would then always hit UNIQUE(kind, subject).
  const existing = await db
    .prepare(
      `SELECT 1 AS found FROM auth_users WHERE email = ?
       UNION ALL SELECT 1 FROM principals WHERE kind = 'user' AND subject = ?
       LIMIT 1`,
    )
    .bind(email, email)
    .first<{ found: number }>();
  if (existing) {
    throw new InviteRequestError("account_exists", "That email is already registered.");
  }
  // An expired, never-accepted invite must not block a fresh one forever.
  await db
    .prepare(`DELETE FROM invites WHERE email = ? AND accepted_at IS NULL AND expires_at <= ?`)
    .bind(email, now)
    .run();
  const token = randomHex(32);
  const expiresAt = now + INVITE_TTL_MS;
  try {
    await db
      .prepare(
        `INSERT INTO invites (id, email, role, department, token_hash, expires_at, accepted_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .bind(
        newBoundedId("i"),
        email,
        input.role,
        input.department,
        await sha256Hex(token),
        expiresAt,
        input.createdBy,
        now,
      )
      .run();
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : String(error))) {
      throw new InviteRequestError("invite_open", "An invite is already open for that email.");
    }
    throw error;
  }
  return { url: `/invite/${token}`, expiresAt };
}

type InviteRow = { id: string; email: string; role: string; department: string };

export async function acceptInvite(
  db: OperationsDatabase,
  input: { token?: unknown; name?: unknown; password?: unknown },
  now = Date.now(),
): Promise<AuthSessionResult> {
  // Input checks that say nothing about whether the token exists come first.
  const password = normalizePassword(input.password);
  if (typeof input.token !== "string" || !TOKEN_PATTERN.test(input.token)) {
    throw new InviteInvalidError();
  }
  // No failure counter: a miss writes nothing, so an unauthenticated caller cannot
  // grow the database. Tokens are 256-bit random, so guessing is not the defence;
  // volume is limited at the edge (WAF rate limit on /api/auth/invite).
  const tokenDigest = await sha256Hex(input.token);
  const invite = await db
    .prepare(
      `SELECT id, email, role, department FROM invites
       WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?`,
    )
    .bind(tokenDigest, now)
    .first<InviteRow>();
  if (!invite) {
    throw new InviteInvalidError();
  }
  const name = nameFromEmail(invite.email, input.name);
  const principalId = newBoundedId("p");
  const sessionToken = randomHex(32);
  const passwordHash = await hashPassword(password);
  const sessionHash = await sha256Hex(sessionToken);
  // The claim is the first statement. Every later insert is guarded by
  // changes() > 0, which cascades: if the claim matched no row (replay, expiry
  // or a concurrent accept), nothing else is written.
  let results: unknown[];
  try {
    results = (await db.batch([
      db
        .prepare(
          `UPDATE invites SET accepted_at = ?
           WHERE id = ? AND accepted_at IS NULL AND expires_at > ?`,
        )
        .bind(now, invite.id, now),
      db
        .prepare(
          `INSERT INTO principals (id, kind, subject, created_at)
           SELECT ?, 'user', ?, ? WHERE changes() > 0`,
        )
        .bind(principalId, invite.email, now),
      db
        .prepare(
          `INSERT INTO auth_users (id, email, name, password_hash, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0`,
        )
        .bind(principalId, invite.email, name, passwordHash, now, now),
      db
        .prepare(`INSERT INTO roles (principal_id, role) SELECT ?, ? WHERE changes() > 0`)
        .bind(principalId, invite.role),
      db
        .prepare(`INSERT INTO departments (principal_id, department) SELECT ?, ? WHERE changes() > 0`)
        .bind(principalId, invite.department),
      db
        .prepare(
          `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
           SELECT ?, ?, ?, ?, ? WHERE changes() > 0`,
        )
        .bind(
          newBoundedId("s"),
          principalId,
          sessionHash,
          now + SESSION_TTL_SECONDS * 1000,
          now,
        ),
    ])) as unknown[];
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : String(error))) {
      throw new InviteInvalidError();
    }
    throw error;
  }
  if (changesOf(results[0]) !== 1 || changesOf(results[results.length - 1]) !== 1) {
    throw new InviteInvalidError();
  }
  return { user: { id: principalId, email: invite.email, name }, sessionToken };
}
