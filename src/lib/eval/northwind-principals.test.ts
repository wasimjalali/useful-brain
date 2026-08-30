import { describe, expect, it } from "vitest";

import { loadNorthwindCorpus } from "./northwind-loader";
import { NORTHWIND_PRINCIPALS } from "./northwind-principals";

describe("northwind principals constant", () => {
  it("stays in sync with content/northwind/questions.json", () => {
    const { principals } = loadNorthwindCorpus();
    const fromCorpus = Object.entries(principals)
      .map(([key, principal]) => ({
        key,
        userId: principal.userId,
        roles: principal.roles,
        departments: principal.departments,
      }))
      .sort((left, right) => left.key.localeCompare(right.key));
    const declared = [...NORTHWIND_PRINCIPALS].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
    expect(declared).toEqual(fromCorpus);
  });
});
