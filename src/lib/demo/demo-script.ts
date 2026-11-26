/**
 * The public demo's scripted questions. The demo has no model: each question
 * runs the real search over the Northwind corpus, then answers with sentences
 * copied verbatim from the document that states them, each cited with the
 * evidence label search returned. Any other question gets the app's own
 * not-enough-evidence answer.
 */
export type DemoQuestion = {
  question: string;
  department: string;
  /** The Northwind document that answers it, and the only one quoted. */
  documentId: string;
  /** The query the scripted model passes to search_knowledge. */
  searchQuery: string;
  /** Sentences copied verbatim from the document, one paragraph each. */
  quotes: string[];
};

export const DEMO_QUESTIONS: readonly DemoQuestion[] = [
  {
    question: "How much parental leave do I get, and when am I eligible?",
    department: "HR",
    documentId: "nw_hr_parental_leave",
    searchQuery: "parental leave weeks eligibility",
    quotes: [
      "Every eligible parent receives sixteen weeks of fully paid parental leave per child.",
      "Eligibility requires six months of continuous service before the leave starts.",
    ],
  },
  {
    question: "What is the first-response target for a P1 ticket?",
    department: "Support",
    documentId: "nw_support_sla_policy",
    searchQuery: "P1 ticket first response target",
    quotes: [
      "P1 tickets are major features down or performance degradation affecting a significant portion of a customer's users; they get a 1-hour response and 24-hour resolution.",
    ],
  },
  {
    question: "How long are system logs kept?",
    department: "Engineering",
    documentId: "nw_engineering_log_retention",
    searchQuery: "system log retention raw aggregated security logs kept",
    quotes: [
      "Raw logs (unaggregated application and access logs) are kept for 90 days.",
      "Aggregated logs (metrics, dashboards, rollups) are kept for 1 year.",
      "Security and audit logs (authentication events, admin actions, permission changes, incident logs) are kept for 7 years.",
    ],
  },
  {
    question: "Can I keep my laptop when I leave Northwind?",
    department: "Operations",
    documentId: "nw_operations_equipment_return",
    searchQuery: "equipment return window departing employees book value final pay",
    quotes: [
      "Equipment must be returned within 30 calendar days of the event that triggers the return: the last working day for departures, the role change date for transfers that change equipment, and the loan end date for loaner equipment.",
      "Departing employees who do not return equipment within the window have the equipment's book value deducted from final pay under the Termination and Offboarding Policy.",
    ],
  },
  {
    question: "What expenses can I claim, and by when?",
    department: "Finance",
    documentId: "nw_finance_employee_expense",
    searchQuery: "reimbursable expenses submission deadline",
    quotes: [
      "Reimbursable expenses are ordinary and necessary business costs: office supplies bought out of pocket, client meals, software subscriptions used for work, books, parking, and work-related mileage.",
      "Expense reports must be submitted within 30 days of the expense date, or within 30 days of the trip's end for travel.",
    ],
  },
  {
    question: "How does the on-call rotation work?",
    department: "Engineering",
    documentId: "nw_engineering_on_call",
    searchQuery: "on-call rotation weekly primary backup handoff",
    quotes: [
      "The rotation is weekly: an engineer is on primary call for one week, from Wednesday 10:00 CT to the following Wednesday 10:00 CT.",
      "Every primary slot has a backup on-call engineer, who covers when the primary is unavailable or is already engaged on an incident.",
    ],
  },
];

/** Case, spacing, curly quotes and closing punctuation don't count. */
export function normalizeDemoQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s?.!]+$/u, "");
}

export function matchDemoQuestion(text: string): DemoQuestion | null {
  const asked = normalizeDemoQuestion(text);
  return DEMO_QUESTIONS.find((item) => normalizeDemoQuestion(item.question) === asked) ?? null;
}
