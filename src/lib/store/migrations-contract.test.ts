import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("D1 migrations", () => {
  it("keeps corpus and operations histories independent and forbids INSERT OR REPLACE", () => {
    const root = path.join(process.cwd(), "migrations");
    const corpusFiles = readdirSync(path.join(root, "corpus"));
    const operationsFiles = readdirSync(path.join(root, "operations"));
    expect(corpusFiles).toContain("0001_init.sql");
    expect(operationsFiles).toContain("0001_init.sql");
    const corpusSql = readFileSync(path.join(root, "corpus", "0001_init.sql"), "utf8");
    const operationsSql = readFileSync(path.join(root, "operations", "0001_init.sql"), "utf8");
    expect(corpusSql).not.toEqual(operationsSql);
    expect(corpusSql).toMatch(/corpus_generations/);
    expect(operationsSql).toMatch(/principals/);

    for (const directory of ["corpus", "operations"]) {
      for (const file of readdirSync(path.join(root, directory))) {
        const sql = readFileSync(path.join(root, directory, file), "utf8");
        expect(sql).not.toMatch(/INSERT\s+OR\s+REPLACE/i);
      }
    }
  });
});
