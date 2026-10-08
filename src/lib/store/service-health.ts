import {
  HEALTH_DETAIL_CODES,
  type HealthDetailCode,
  type HealthStatus,
} from "../contracts/admin-metrics";
import type { OperationsDatabase } from "./conversations";

export type ServiceHealthEvent = {
  service: string;
  status: HealthStatus;
  code: HealthDetailCode;
  at: number;
};

export async function recordServiceHealth(
  db: OperationsDatabase,
  event: ServiceHealthEvent,
): Promise<void> {
  await db
    .prepare(`INSERT INTO service_health_events (service, status, code, at) VALUES (?, ?, ?, ?)`)
    .bind(event.service, event.status, event.code, event.at)
    .run();
}

type EventRow = { status: string; code: string; at: number };

/** The newest event for a service. An unknown stored code is reported as last_call_failed. */
export async function loadLatestServiceHealth(
  db: OperationsDatabase,
  service: string,
): Promise<ServiceHealthEvent | null> {
  const row = await db
    .prepare(
      `SELECT status, code, at FROM service_health_events WHERE service = ? ORDER BY at DESC, seq DESC LIMIT 1`,
    )
    .bind(service)
    .first<EventRow>();
  if (!row) {
    return null;
  }
  const known = (HEALTH_DETAIL_CODES as readonly string[]).includes(row.code);
  return {
    service,
    status: row.status as HealthStatus,
    code: known ? (row.code as HealthDetailCode) : "last_call_failed",
    at: row.at,
  };
}
