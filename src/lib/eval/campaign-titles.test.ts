import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import questionsFile from "../../../content/northwind/questions.json";
import { CAMPAIGN_DOCUMENT_TITLES } from "./campaign-titles";
import { NORTHWIND_CAMPAIGN } from "./campaign-snapshot";

const ROOT = path.join(process.cwd(), "content", "northwind");

function frontMatterTitles(): Map<string, string> {
  const titles = new Map<string, string>();
  for (const department of readdirSync(ROOT, { withFileTypes: true })) {
    if (!department.isDirectory()) continue;
    for (const file of readdirSync(path.join(ROOT, department.name))) {
      const head = readFileSync(path.join(ROOT, department.name, file), "utf8").split("\n").slice(0, 12);
      const id = head.find((line) => line.startsWith("document_id:"))?.slice("document_id:".length).trim();
      const title = head.find((line) => line.startsWith("title:"))?.slice("title:".length).trim();
      if (id && title) titles.set(id, title);
    }
  }
  return titles;
}

describe("campaign document titles", () => {
  const truth = frontMatterTitles();

  it("match the corpus front matter", () => {
    for (const [id, title] of Object.entries(CAMPAIGN_DOCUMENT_TITLES)) {
      expect(truth.get(id), id).toBe(title);
    }
  });

  it("cover every document expected by a failure in every run", () => {
    const byId = new Map(questionsFile.questions.map((q) => [q.id, q]));
    for (const run of NORTHWIND_CAMPAIGN.runs) {
      for (const failure of run.failures) {
        for (const documentId of byId.get(failure.id)!.expected_document_ids) {
          expect(CAMPAIGN_DOCUMENT_TITLES[documentId], `${run.key} ${failure.id} ${documentId}`).toBeTruthy();
        }
      }
    }
  });
});
