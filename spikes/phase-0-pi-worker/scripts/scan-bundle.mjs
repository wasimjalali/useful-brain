#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../dist");
const forbidden = [
  /better-sqlite3/,
  /node:sqlite/,
  /pi-session-backend-sqlite/,
  /bun-oauth/,
  /pi-ai\/dist\/oauth\.js/,
  /node:child_process/,
  /node:readline/,
];

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

const files = walk(dist).filter((file) => /\.(js|mjs|map)$/.test(file));
const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      hits.push(`${file}: ${pattern}`);
    }
  }
}

if (hits.length > 0) {
  console.error("Forbidden Node-only or session dependencies in bundle:");
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}

console.log(
  `Scanned ${files.length} bundle files. No sqlite, OAuth, or Node session backends found.`,
);
