import { describe, expect, it } from "vitest";

import type { CitedRetrievalResult } from "../answer/contract";
import {
  documentTitleTokens,
  figureTokens,
  hintedPointerGroups,
  hintedUncitedDocuments,
} from "./pointer-completion";

function item(
  citationLabel: string,
  documentId: string,
  source: string,
  section: string,
  text: string,
): CitedRetrievalResult {
  return {
    rank: Number(citationLabel.replace(/\D/g, "")),
    score: 0.5,
    chunkId: `${documentId}-chunk`,
    source,
    section,
    text,
    tokenEstimate: 10,
    citationLabel,
    documentId,
  };
}

const DSAR_ARRIVE = item(
  "[6]",
  "nw_support_dsar_process",
  "customer-data-access-requests.md",
  "How Requests Arrive",
  "Requests arrive through privacy@northwind.example, the portal, or a support ticket. A request is not a ticket: it does not run on the Support SLA Policy clock, it runs on the 30-day response window.",
);

const PRIVACY_RIGHTS = item(
  "[3]",
  "nw_legal_privacy_policy",
  "privacy-policy.md",
  "Individual Rights",
  "Northwind responds within 30 days; where a request is complex or the volume is large, the response can be extended by up to 60 days, with notice to the requester. Deletion requests are completed within 30 days.",
);

const HIRING_BONUS = item(
  "[1]",
  "nw_hr_recruiting_interview",
  "recruiting-and-interview-policy.md",
  "Employee Referral Bonus",
  "Employees can refer candidates through the referral portal. The referral bonus is $1,000 per successful hire, paid in the first paycheck after the new hire completes 90 days of service.",
);

const REFERRAL_PURPOSE = item(
  "[3]",
  "nw_sales_referral_program",
  "referral-program.md",
  "Purpose",
  "The referral program pays Northwind employees for introducing new customers. The payout is a flat $2,000 per new customer, and the program is open to all employees.",
);

const REFERRAL_RELATIONSHIP = item(
  "[4]",
  "nw_sales_referral_program",
  "referral-program.md",
  "Relationship to Other Policies",
  "The Recruiting and Interview Policy's referral bonus ($1,000 for hires) is a different program with a different payout, and the two are not interchangeable.",
);

const REFUND_DATA = item(
  "[3]",
  "nw_finance_refund_policy",
  "refund-policy.md",
  "Refund and Data",
  "When a refund is granted for a full plan termination, the customer's data is scheduled for deletion 30 days after the refund is processed, under the Privacy Policy's deletion rules. Customers can request earlier deletion through the Customer Data Access Requests process (DSAR-####, 30-day response window).",
);

const DSAR_RESPONSE = item(
  "[10]",
  "nw_support_dsar_process",
  "customer-data-access-requests.md",
  "Response Windows",
  "Deletion requests are completed within 30 days: the data is deleted from production and from backups no later than the next backup cycle, per the Data Retention Policy.",
);

const SICK_LEAVE = item(
  "[2]",
  "nw_hr_leave_policy",
  "leave-and-time-off-policy.md",
  "Sick Leave",
  "Employees receive ten paid sick days per calendar year, renewed on January 1. Sick days do not roll over.",
);

describe("documentTitleTokens", () => {
  it("drops extensions, generic words and single letters", () => {
    expect(documentTitleTokens("referral-program.md")).toEqual(["referral", "program"]);
    expect(documentTitleTokens("privacy-policy.md")).toEqual(["privacy"]);
  });
});

describe("hintedUncitedDocuments", () => {
  it("hints the privacy policy when cited evidence names its address", () => {
    const question = "How long do we have to respond to a customer data access request?";
    const draft = "It runs on the 30-day response window. [6]";
    const groups = hintedUncitedDocuments(question, draft, [DSAR_ARRIVE, PRIVACY_RIGHTS]);
    expect(groups.map((group) => group[0]?.documentId)).toEqual(["nw_legal_privacy_policy"]);
  });

  it("hints a single-word title on one match", () => {
    // Regression guard: the old >= 2 match rule could never fire for
    // single-token titles such as privacy-policy.md.
    const question = "What does the privacy rule say about the response window?";
    const draft = "It runs on the 30-day response window. [6]";
    const groups = hintedUncitedDocuments(question, draft, [DSAR_ARRIVE, PRIVACY_RIGHTS]);
    expect(groups.map((group) => group[0]?.documentId)).toEqual(["nw_legal_privacy_policy"]);
  });

  it("hints the referral program through its contrast with the cited hiring bonus", () => {
    const question =
      "A sales manager wants to explain to a rep how an employee referral payout works and how commission is calculated on a new deal. What are both numbers?";
    const draft = "The referral bonus is $1,000 per successful hire. [1]";
    const groups = hintedUncitedDocuments(question, draft, [HIRING_BONUS, REFERRAL_PURPOSE, REFERRAL_RELATIONSHIP]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it("hints the DSAR process when the cited refund chunk names it", () => {
    const question =
      "A customer received a full refund on a terminated annual plan and now wants their data deleted right away. What timelines apply?";
    const draft = "Data is scheduled for deletion 30 days after the refund is processed. [3]";
    const groups = hintedUncitedDocuments(question, draft, [REFUND_DATA, DSAR_RESPONSE]);
    expect(groups.map((group) => group[0]?.documentId)).toEqual(["nw_support_dsar_process"]);
  });

  it("hints nothing when no title is named and nothing contrasts", () => {
    const question = "What happens to my unused sick days if I transfer from Austin to Singapore?";
    const draft = "Sick days do not roll over. [2]";
    expect(hintedUncitedDocuments(question, draft, [SICK_LEAVE, DSAR_RESPONSE])).toEqual([]);
  });
});

// Twin documents that restate a rule without naming each other. Ways the
// "same figures" detection could go wrong:
// 1. the owner states the same two figures as the cited process document
//    but is never hinted because no title is named (the 2026-10-08 miss);
// 2. one shared figure ("30 days") hints every neighbor in evidence;
// 3. citation labels such as [8] are read as figures;
// 4. "30-day" and "30 days", or "$2,000" split by normalization, fail to
//    match the same figure;
// 5. named-title neighbors fill the hint cap and evict the restating owner;
// 6. a chunk of an already cited document is hinted as its own twin.
const PROCESS_WINDOWS = item(
  "[8]",
  "acme_request_process",
  "records-request-process.md",
  "Response Windows",
  "The standard response window is 30 days from the request date. Complex requests can be extended by up to 60 days, with written notice to the requester.",
);

const OWNER_RIGHTS = item(
  "[2]",
  "acme_rights_policy",
  "customer-rights-policy.md",
  "Rights",
  "Acme responds within 30 days; where a request is complex, the response can be extended by up to 60 days, with notice.",
);

const NEIGHBOR_ONE_FIGURE = item(
  "[4]",
  "acme_ticket_policy",
  "ticket-targets.md",
  "Relationship to Other Policies",
  "Records requests have a 30-day response window regardless of ticket priority.",
);

function namedNeighbor(label: string, documentId: string, source: string): CitedRetrievalResult {
  return item(label, documentId, source, "Overview", "General guidance without figures.");
}

describe("hintedPointerGroups: restated figures", () => {
  const question = "How long do we have to answer a records request?";
  const draft =
    "The standard response window is 30 days from the request date. [8]\n\nComplex requests can be extended by up to 60 days, with written notice to the requester within the first 30 days. [8]";

  it("hints an uncited document that states the same two figures as one cited paragraph", () => {
    const groups = hintedPointerGroups(question, draft, [
      PROCESS_WINDOWS,
      OWNER_RIGHTS,
      NEIGHBOR_ONE_FIGURE,
    ]);
    expect(groups.map((group) => [group.reason, group.items[0]?.documentId])).toEqual([
      ["restates", "acme_rights_policy"],
    ]);
  });

  it("does not hint on a single shared figure or on citation labels", () => {
    expect(
      hintedPointerGroups(question, "The standard response window is 30 days from the request date. [8]", [
        PROCESS_WINDOWS,
        NEIGHBOR_ONE_FIGURE,
      ]),
    ).toEqual([]);
    // [2] and [4] are labels, not figures: no paragraph carries two figures.
    expect(figureTokens("The window applies. [2] [4]")).toEqual([]);
  });

  it("matches hyphenated units and thousands separators", () => {
    expect(figureTokens("a 30-day window and 30 days later")).toEqual(["30 day"]);
    expect(figureTokens("a flat $2,000 payout, 4 business hours, 8% of ACV")).toEqual([
      "2000",
      "4 hour",
      "8 percent",
    ]);
  });

  it("ranks restating twins ahead of named neighbors under the hint cap", () => {
    const evidence = [
      PROCESS_WINDOWS,
      namedNeighbor("[3]", "acme_alpha", "alpha.md"),
      namedNeighbor("[5]", "acme_beta", "beta.md"),
      namedNeighbor("[6]", "acme_gamma", "gamma.md"),
      OWNER_RIGHTS,
    ];
    const groups = hintedPointerGroups(`${question} alpha beta gamma`, draft, evidence);
    expect(groups).toHaveLength(3);
    expect(groups[0]?.reason).toBe("restates");
    expect(groups[0]?.items[0]?.documentId).toBe("acme_rights_policy");
  });

  it("never hints a chunk of a cited document as its own twin", () => {
    const sameDocument = { ...OWNER_RIGHTS, documentId: "acme_request_process", citationLabel: "[9]" };
    expect(hintedPointerGroups(question, draft, [PROCESS_WINDOWS, sameDocument])).toEqual([]);
  });

  it("keeps the flat group list for existing callers", () => {
    expect(hintedUncitedDocuments(question, draft, [PROCESS_WINDOWS, OWNER_RIGHTS])).toEqual([
      [OWNER_RIGHTS],
    ]);
  });
});
