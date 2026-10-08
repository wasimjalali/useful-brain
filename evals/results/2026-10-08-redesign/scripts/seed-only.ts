// Seeds and promotes the Northwind generation on a fresh eval Brain, the same
// flow as ensureSeeded in live-northwind-eval.ts. Usage: npx jiti seed-only.ts <brainUrl>
import path from "node:path";
const brainUrl = process.argv[2];
const { northwindSeedDocuments } = await import(path.join(process.cwd(), "src/lib/eval/northwind-seed.ts"));
const status = await (await fetch(`${brainUrl}/knowledge`)).json();
let id = status.embeddingStorageStatus?.activeVersionId;
if (!id) {
  const seeded = await fetch(`${brainUrl}/knowledge/seed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documents: northwindSeedDocuments() }),
    signal: AbortSignal.timeout(900_000),
  });
  if (!seeded.ok) throw new Error(`seed returned ${seeded.status}: ${await seeded.text()}`);
  id = (await seeded.json()).generationId;
  const promoted = await fetch(`${brainUrl}/knowledge/promote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ generationId: id }),
  });
  if (!promoted.ok) throw new Error(`promote returned ${promoted.status}`);
}
console.log("active", id);
