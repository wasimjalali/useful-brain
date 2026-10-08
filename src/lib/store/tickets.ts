import { parseMutatingIdempotencyKey } from "../cf/bounded-id";
import { formatTicketId, type CreateTicketArguments } from "../contracts/approvals";
import type { OperationsDatabase } from "./conversations";

export type StoredTicket = CreateTicketArguments & {
  id: string;
  seq: number;
  runId: string;
  principalId: string;
  createdAt: number;
};

type TicketRow = {
  seq: number;
  run_id: string;
  principal_id: string;
  desk: CreateTicketArguments["desk"];
  priority: CreateTicketArguments["priority"];
  customer: string;
  subject: string;
  created_at: number;
};

export async function loadTicketByKey(
  db: OperationsDatabase,
  idempotencyKey: string,
): Promise<StoredTicket | null> {
  const row = await db
    .prepare(
      `SELECT seq, run_id, principal_id, desk, priority, customer, subject, created_at
       FROM tickets WHERE idempotency_key = ?`,
    )
    .bind(parseMutatingIdempotencyKey(idempotencyKey))
    .first<TicketRow>();
  if (!row) {
    return null;
  }
  return {
    id: formatTicketId(row.seq),
    seq: row.seq,
    runId: row.run_id,
    principalId: row.principal_id,
    desk: row.desk,
    priority: row.priority,
    customer: row.customer,
    subject: row.subject,
    createdAt: row.created_at,
  };
}

/** Insert once per idempotency key. A replay returns the ticket already stored. */
export async function insertTicketOnce(
  db: OperationsDatabase,
  input: {
    idempotencyKey: string;
    runId: string;
    principalId: string;
    args: CreateTicketArguments;
    now: number;
  },
): Promise<StoredTicket> {
  const key = parseMutatingIdempotencyKey(input.idempotencyKey);
  await db
    .prepare(
      `INSERT INTO tickets (
         idempotency_key, run_id, principal_id, desk, priority, customer, subject, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .bind(
      key,
      input.runId,
      input.principalId,
      input.args.desk,
      input.args.priority,
      input.args.customer,
      input.args.subject,
      input.now,
    )
    .run();
  const stored = await loadTicketByKey(db, key);
  if (!stored) {
    throw new Error("ticket is missing after insert");
  }
  return stored;
}

/** Read one ticket by its SUP-#### id. Null when the id is malformed or unknown. */
export async function loadTicketById(
  db: OperationsDatabase,
  ticketId: string,
): Promise<StoredTicket | null> {
  const match = /^SUP-([1-9][0-9]{0,9})$/.exec(ticketId);
  if (!match) {
    return null;
  }
  const row = await db
    .prepare(
      `SELECT seq, run_id, principal_id, desk, priority, customer, subject, created_at
       FROM tickets WHERE seq = ?`,
    )
    .bind(Number(match[1]))
    .first<TicketRow>();
  if (!row) {
    return null;
  }
  return {
    id: formatTicketId(row.seq),
    seq: row.seq,
    runId: row.run_id,
    principalId: row.principal_id,
    desk: row.desk,
    priority: row.priority,
    customer: row.customer,
    subject: row.subject,
    createdAt: row.created_at,
  };
}
