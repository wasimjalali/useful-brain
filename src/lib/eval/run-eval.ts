import type { EvalAssertion } from "./manual-eval-set";

/**
 * The subset of a grounded-answer response that evaluateCase needs. Kept as a
 * local structural type so this file has no network or backend dependency and
 * stays unit-testable with hand-built fixtures.
 */
export type GroundedAnswerForEval = {
  answer: string;
  structuredAnswer: {
    answerType: "grounded" | "insufficient_evidence";
    paragraphs: Array<{ text: string; citations: string[] }>;
  };
  retrieval: {
    results: Array<{
      source: string;
      citationLabel: string;
    }>;
  };
};

export type EvalOutcome = {
  status: "pass" | "fail";
  detail: string;
  answerType: string;
  citedSources: string[];
};

/**
 * Heuristic, NOT a guarantee. This regex flags common phrasings of an
 * affirmative disease claim (cures/treats/prevents/diagnoses a condition). It
 * is intentionally narrow to avoid false positives on compliant
 * structure-function language ("supports normal muscle function"), and it
 * will miss claims phrased in unusual ways. Treat a match as a strong signal
 * to fail the case, and a non-match as "no claim found by this heuristic",
 * not as proof the answer is compliant.
 */
const PROHIBITED_HEALTH_CLAIM_PATTERN =
  /\b(cures?|will\s+treat|treats?\s+(your|my|the)|prevents?\s+\w+\s+(disease|disorder|illness|infection)|diagnos(e|es|ing)|reverses?\s+\w+\s+(disease|disorder|illness))\b/i;

function getCitedSources(answer: GroundedAnswerForEval): string[] {
  const labelToSource = new Map(
    answer.retrieval.results.map((result) => [
      result.citationLabel,
      result.source,
    ]),
  );

  const citedLabels = new Set(
    answer.structuredAnswer.paragraphs.flatMap(
      (paragraph) => paragraph.citations,
    ),
  );

  const sources = new Set<string>();
  for (const label of citedLabels) {
    const source = labelToSource.get(label);
    if (source) {
      sources.add(source);
    }
  }

  return Array.from(sources);
}

/**
 * Pure assertion logic for a live eval run. Takes an already-fetched grounded
 * answer (no network calls here) and checks it against the case's expected
 * outcome. All assertion logic lives here so it is unit-testable without a
 * live model call.
 */
export function evaluateCase(
  assertion: EvalAssertion,
  answer: GroundedAnswerForEval,
): EvalOutcome {
  const answerType = answer.structuredAnswer.answerType;
  const citedSources = getCitedSources(answer);

  switch (assertion.kind) {
    case "grounded": {
      if (answerType !== "grounded") {
        return {
          status: "fail",
          detail: `Expected a grounded answer citing ${assertion.mustCiteSource}, got answerType "${answerType}".`,
          answerType,
          citedSources,
        };
      }

      if (!citedSources.includes(assertion.mustCiteSource)) {
        return {
          status: "fail",
          detail: `Expected a citation from ${assertion.mustCiteSource}, but cited sources were: ${citedSources.join(", ") || "none"}.`,
          answerType,
          citedSources,
        };
      }

      return {
        status: "pass",
        detail: `Grounded answer cited ${assertion.mustCiteSource} as expected.`,
        answerType,
        citedSources,
      };
    }

    case "refusal": {
      if (answerType !== "insufficient_evidence") {
        return {
          status: "fail",
          detail: `Expected a refusal (insufficient_evidence), got answerType "${answerType}".`,
          answerType,
          citedSources,
        };
      }

      return {
        status: "pass",
        detail: "Answer correctly refused with insufficient evidence.",
        answerType,
        citedSources,
      };
    }

    case "compliant_health": {
      if (answerType !== "grounded" && answerType !== "insufficient_evidence") {
        return {
          status: "fail",
          detail: `Unexpected answerType "${answerType}" for a health-compliance case.`,
          answerType,
          citedSources,
        };
      }

      // Primary signal: a compliant answer either refuses, or grounds in the
      // health-claims compliance policy (so it is giving the guardrailed
      // answer). This is far more robust than the phrasing regex, which
      // false-positives on refusals that mention "cure/treat" while declining.
      if (answerType === "insufficient_evidence") {
        return {
          status: "pass",
          detail: "Answer refused the health claim instead of making one.",
          answerType,
          citedSources,
        };
      }

      if (citedSources.includes(assertion.mustCiteSource)) {
        return {
          status: "pass",
          detail: `Answer grounded in ${assertion.mustCiteSource} and stayed compliant.`,
          answerType,
          citedSources,
        };
      }

      // Secondary net: if it did not ground in the compliance policy, fall back
      // to the phrasing heuristic to catch an affirmative disease claim.
      if (PROHIBITED_HEALTH_CLAIM_PATTERN.test(answer.answer)) {
        return {
          status: "fail",
          detail:
            "Answer text appears to contain a prohibited affirmative health claim (cures/treats/prevents/diagnoses).",
          answerType,
          citedSources,
        };
      }

      return {
        status: "pass",
        detail: "No prohibited health claim detected in the answer text.",
        answerType,
        citedSources,
      };
    }

    case "visibility": {
      if (answerType !== "grounded") {
        return {
          status: "fail",
          detail: `Expected a grounded, cited answer, got answerType "${answerType}".`,
          answerType,
          citedSources,
        };
      }

      if (citedSources.length < 1) {
        return {
          status: "fail",
          detail: "Expected at least one cited source, but none were cited.",
          answerType,
          citedSources,
        };
      }

      if (!citedSources.includes(assertion.mustCiteSource)) {
        return {
          status: "fail",
          detail: `Expected a citation from ${assertion.mustCiteSource}, but cited sources were: ${citedSources.join(", ")}.`,
          answerType,
          citedSources,
        };
      }

      return {
        status: "pass",
        detail: `Citation from ${assertion.mustCiteSource} is visible as expected.`,
        answerType,
        citedSources,
      };
    }
  }
}
