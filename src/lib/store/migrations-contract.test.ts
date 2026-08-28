import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("D1 migrations", () => {
  it("keeps corpus and operations histories independent and forbids INSERT OR REPLACE", () => {
    const root = path.join(process.cwd(), "migrations");
    const corpusFiles = readdirSync(path.join(root, "corpus"));
    const operationsFiles = readdirSync(path.join(root, "operations"));
    expect(corpusFiles).toContain("0001_init.sql");
    expect(corpusFiles).toContain("0002_lifecycle.sql");
    expect(corpusFiles).toContain("0003_fts5.sql");
    expect(operationsFiles).toContain("0001_init.sql");
    expect(operationsFiles).toContain("0002_conversations.sql");
    expect(operationsFiles).toContain("0003_agent_runs.sql");
    expect(operationsFiles).toContain("0004_idempotent_effects.sql");
    expect(operationsFiles).toContain("0005_turn_completion_token.sql");
    const corpusSql = readFileSync(path.join(root, "corpus", "0001_init.sql"), "utf8");
    const operationsSql = readFileSync(path.join(root, "operations", "0001_init.sql"), "utf8");
    expect(corpusSql).not.toEqual(operationsSql);
    expect(corpusSql).toMatch(/corpus_generations/);
    expect(operationsSql).toMatch(/principals/);
    expect(operationsSql).toMatch(/UNIQUE \(kind, subject\)/);
    expect(operationsSql).toMatch(/principal_id/);
    expect(operationsSql).not.toMatch(/user_id/);
    expect(operationsSql).toMatch(/No remote D1 has applied this migration/);
    const conversationsSql = readFileSync(path.join(root, "operations", "0002_conversations.sql"), "utf8");
    expect(conversationsSql).toMatch(/CREATE TABLE conversations/);
    expect(conversationsSql).toMatch(/evidence_snapshots/);
    const agentRunsSql = readFileSync(path.join(root, "operations", "0003_agent_runs.sql"), "utf8");
    expect(agentRunsSql).toMatch(/CREATE TABLE agent_runs/);
    expect(agentRunsSql).toMatch(/CREATE TABLE tool_calls/);
    expect(agentRunsSql).toMatch(/CREATE TABLE approvals/);
    const idempotencySql = readFileSync(
      path.join(root, "operations", "0004_idempotent_effects.sql"),
      "utf8",
    );
    expect(idempotencySql).toMatch(/normalized_arguments_json/);
    expect(idempotencySql).toMatch(/approvals_by_run/);
    expect(idempotencySql).toMatch(/CREATE TABLE idempotent_effects/);
    const completionSql = readFileSync(
      path.join(root, "operations", "0005_turn_completion_token.sql"),
      "utf8",
    );
    expect(completionSql).toMatch(/ADD COLUMN completion_token/);
    expect(completionSql).toMatch(/UNIQUE INDEX messages_by_completion_token/);
    expect(completionSql).toMatch(/CREATE TABLE turn_completion_claims/);

    for (const directory of ["corpus", "operations"]) {
      for (const file of readdirSync(path.join(root, directory))) {
        const sql = readFileSync(path.join(root, directory, file), "utf8");
        expect(sql).not.toMatch(/INSERT\s+OR\s+REPLACE/i);
      }
    }
  });

  it("fails the FTS rebuild if legacy chunks exist and rebuilds the external index", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "migrations/corpus/0003_fts5.sql"),
      "utf8",
    );
    expect(migration).toMatch(/CHECK\s*\(legacy_chunk_count\s*=\s*0\)/i);
    expect(migration).toMatch(/INSERT INTO chunks_fts\s*\(chunks_fts\)\s*VALUES\s*\('rebuild'\)/i);
  });
});
