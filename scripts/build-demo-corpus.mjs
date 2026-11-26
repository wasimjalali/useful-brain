/**
 * Builds the demo corpus (the 65 Northwind documents, keyword-only, promoted)
 * in a LOCAL demo D1 with the app's own seeding code and no model, so its
 * rows can be loaded into the remote demo database. See
 * docs/runbooks/demo.md for the full sequence.
 *   npm run build:demo-corpus -- <persist-dir> <output.sql>
 * The persist dir must already hold the corpus migrations
 * (wrangler d1 migrations apply ... --local --persist-to <persist-dir>).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createJiti } from "jiti";
import { getPlatformProxy } from "wrangler";

const [persistDir, outputFile] = process.argv.slice(2);
if (!persistDir || !outputFile) {
  throw new Error("usage: npm run build:demo-corpus -- <persist-dir> <output.sql>");
}

// The seeding code is the app's TypeScript; wrangler stays a native import.
const jiti = createJiti(import.meta.url);
const { northwindSeedDocuments } = await jiti.import("../src/lib/eval/northwind-seed.ts");
const { activeGenerationId, promoteGeneration } = await jiti.import("../src/lib/store/corpus-d1.ts");
const { seedNorthwindCorpus } = await jiti.import("../src/lib/store/corpus-seed.ts");

const { env, dispose } = await getPlatformProxy({
  configPath: "workers/brain/wrangler.jsonc",
  environment: "demo",
  persist: { path: join(persistDir, "v3") },
});
try {
  if (env.AI !== undefined) {
    throw new Error("the demo config binds Workers AI; the demo corpus is built without a model");
  }
  if (await activeGenerationId(env.CORPUS_DB)) {
    throw new Error("this local demo corpus already has an active generation; use a fresh persist dir");
  }
  const seeded = await seedNorthwindCorpus({ db: env.CORPUS_DB, documents: northwindSeedDocuments() });
  if (seeded.vectorize !== "skipped") {
    throw new Error("the demo corpus must be keyword-only");
  }
  await promoteGeneration(env.CORPUS_DB, seeded.generationId);
  const sql = await dataOnlySql(env.CORPUS_DB);
  writeFileSync(outputFile, sql);
  console.log(
    `demo corpus ready: generation ${seeded.generationId}, ${seeded.chunkCount} chunks, rows written to ${outputFile}`,
  );
} finally {
  await dispose();
}

/**
 * The corpus rows as INSERTs, parents before children. Migration bookkeeping
 * and the FTS tables are left out: the remote database has its own migrations,
 * and its triggers rebuild both FTS indexes as chunks and catalog rows land.
 */
async function dataOnlySql(db) {
  const skip = (name) =>
    name === "d1_migrations" || name === "sqlite_sequence" || name.startsWith("_cf_") || name.includes("_fts");
  const { results: tables } = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all();
  const names = tables.map((row) => row.name).filter((name) => !skip(name));
  const parents = new Map();
  for (const name of names) {
    const { results } = await db.prepare(`SELECT "table" AS target FROM pragma_foreign_key_list(?)`).bind(name).all();
    parents.set(name, results.map((row) => row.target).filter((target) => target !== name));
  }
  const ordered = [];
  const visit = (name, path = []) => {
    if (ordered.includes(name)) return;
    if (path.includes(name)) throw new Error(`foreign key cycle: ${[...path, name].join(" -> ")}`);
    for (const parent of parents.get(name) ?? []) visit(parent, [...path, name]);
    ordered.push(name);
  };
  names.forEach((name) => visit(name));
  const literal = (value) => {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
    if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
    throw new Error(`unsupported column value: ${typeof value}`);
  };
  const lines = [];
  for (const name of ordered) {
    const { results: rows } = await db.prepare(`SELECT * FROM "${name}"`).all();
    for (const row of rows) {
      const columns = Object.keys(row);
      lines.push(
        `INSERT INTO "${name}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns
          .map((column) => literal(row[column]))
          .join(", ")});`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
