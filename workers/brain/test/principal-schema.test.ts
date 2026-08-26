import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("operations principal schema", () => {
  it("enforces unique (kind, subject) and disjoint namespaces", async () => {
    await env.OPERATIONS_DB.prepare(
      `INSERT INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
    )
      .bind("principal-user", "user", "schema@karkoai.com", 1)
      .run();
    await env.OPERATIONS_DB.prepare(
      `INSERT INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
    )
      .bind("principal-token", "service_token", "schema-bot.access", 1)
      .run();

    await expect(
      env.OPERATIONS_DB.prepare(
        `INSERT INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
      )
        .bind("principal-user-dup", "user", "schema@karkoai.com", 1)
        .run(),
    ).rejects.toThrow();

    await expect(
      env.OPERATIONS_DB.prepare(
        `INSERT INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
      )
        .bind("principal-bad-token", "service_token", "schema@karkoai.com", 1)
        .run(),
    ).rejects.toThrow();

    await env.OPERATIONS_DB.prepare(
      `INSERT INTO roles (principal_id, role) VALUES (?, ?)`,
    )
      .bind("principal-user", "operator")
      .run();
    const tokenRoles = await env.OPERATIONS_DB.prepare(
      `SELECT role FROM roles WHERE principal_id = ?`,
    )
      .bind("principal-token")
      .all<{ role: string }>();
    expect(tokenRoles.results).toEqual([]);
  });

  it("attaches grants to principal id and rejects a missing principal", async () => {
    await env.OPERATIONS_DB.prepare(
      `INSERT INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
    )
      .bind("principal-service", "service_token", "grant-bot.access", 1)
      .run();
    await env.OPERATIONS_DB.prepare(
      `INSERT INTO roles (principal_id, role) VALUES (?, ?)`,
    )
      .bind("principal-service", "reader")
      .run();
    await env.OPERATIONS_DB.prepare(
      `INSERT INTO departments (principal_id, department) VALUES (?, ?)`,
    )
      .bind("principal-service", "ops")
      .run();

    const grants = await env.OPERATIONS_DB.prepare(
      `SELECT p.kind, r.role, d.department
       FROM principals p
       JOIN roles r ON r.principal_id = p.id
       JOIN departments d ON d.principal_id = p.id
       WHERE p.id = ?`,
    )
      .bind("principal-service")
      .first<{ kind: string; role: string; department: string }>();
    expect(grants).toEqual({
      kind: "service_token",
      role: "reader",
      department: "ops",
    });

    await expect(
      env.OPERATIONS_DB.prepare(
        `INSERT INTO roles (principal_id, role) VALUES (?, ?)`,
      )
        .bind("missing-principal", "operator")
        .run(),
    ).rejects.toThrow();
  });
});
