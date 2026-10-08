// Repeats selected Northwind questions against a live Brain and records each
// scored outcome. Usage:
//   npx jiti ab-repeat.ts <brainUrl> <repeats> <outJson> <label> q028 q088 ...
// Run from the repo root so the corpus loader resolves.
import { writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const { loadNorthwindCorpus } = await import(path.join(root, "src/lib/eval/northwind-loader.ts"));
const { scoreNorthwindAnswer } = await import(path.join(root, "src/lib/eval/score-northwind-answer.ts"));

const [brainUrl, repeatsArg, outJson, label, ...ids] = process.argv.slice(2);
const repeats = Number(repeatsArg);
const { questions } = loadNorthwindCorpus();
const selected = questions.filter((q: { questionId: string }) => ids.includes(q.questionId));
if (selected.length !== ids.length) throw new Error(`unknown question id in ${ids.join(",")}`);

const rows: unknown[] = [];
for (let round = 0; round < repeats; round += 1) {
  for (const question of selected) {
    const started = Date.now();
    const response = await fetch(`${brainUrl}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: question.query,
        requestId: `eval-ab-${label}-${question.questionId}-${round}-${Date.now()}`,
        persistConversation: false,
        assumePrincipal: {
          userId: question.principal.userId,
          roles: question.principal.roles,
          departments: question.principal.departments,
        },
      }),
    });
    if (!response.ok) throw new Error(`${question.questionId}: Brain returned ${response.status}`);
    const body = await response.json();
    if (body.assumedPrincipal?.userId !== question.principal.userId) {
      throw new Error(`${question.questionId}: assumed principal not confirmed`);
    }
    const scored = scoreNorthwindAnswer(question, {
      answer: body.answer,
      structuredAnswer: body.structuredAnswer,
      retrieval: {
        results: body.retrieval.results.map((r: Record<string, unknown>) => ({
          source: r.source,
          section: r.section,
          citationLabel: r.citationLabel,
          documentId: r.documentId,
        })),
      },
      vectorDegradedCount: body.vectorDegradedCount,
      refusalReason: body.refusalReason,
    });
    rows.push({ label, round, promptVersion: body.promptVersion, model: body.answerModel, ms: Date.now() - started, ...scored });
    process.stderr.write(`${label} r${round} ${question.questionId} ${scored.status}\n`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
const tally: Record<string, { pass: number; total: number }> = {};
for (const row of rows as Array<{ questionId: string; status: string }>) {
  tally[row.questionId] ??= { pass: 0, total: 0 };
  tally[row.questionId].total += 1;
  if (row.status === "pass") tally[row.questionId].pass += 1;
}
writeFileSync(outJson, JSON.stringify({ label, brainUrl, repeats, ids, tally, rows }, null, 2));
console.log(label, JSON.stringify(tally));
