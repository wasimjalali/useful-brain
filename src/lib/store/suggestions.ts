import { aclFilterFor, aclSqlAndParams, type Principal } from "../acl/access";
import type { Suggestion } from "../contracts/chat";
import type { SqlExecutor } from "./corpus-d1";

export const MAX_SUGGESTIONS = 4;

/**
 * Curated starter questions, each tied to the Northwind document that answers
 * it. The first four are the redesign handoff's questions; the rest are
 * fallbacks so a member who cannot read some targets still sees four. Only the
 * text and department label ever leave the server.
 */
export const CURATED_SUGGESTIONS: ReadonlyArray<{
  text: string;
  department: string;
  documentId: string;
}> = [
  {
    text: "How much parental leave do I get, and when am I eligible?",
    department: "HR",
    documentId: "nw_hr_parental_leave",
  },
  {
    text: "What is the first-response target for a P1 ticket?",
    department: "Support",
    documentId: "nw_support_sla_policy",
  },
  {
    text: "How long are system logs kept?",
    department: "Engineering",
    documentId: "nw_engineering_log_retention",
  },
  {
    text: "Can I keep my laptop when I leave Northwind?",
    department: "Operations",
    documentId: "nw_operations_equipment_return",
  },
  {
    text: "How many days of annual leave do I accrue each year?",
    department: "HR",
    documentId: "nw_hr_leave_policy",
  },
  {
    text: "Can I work remotely, and what are the core hours?",
    department: "HR",
    documentId: "nw_hr_remote_work",
  },
  {
    text: "What expenses can I claim, and by when?",
    department: "Finance",
    documentId: "nw_finance_employee_expense",
  },
  {
    text: "How does the on-call rotation work?",
    department: "Engineering",
    documentId: "nw_engineering_on_call",
  },
  {
    text: "How long does Northwind keep customer data?",
    department: "Legal",
    documentId: "nw_legal_data_retention",
  },
];

/**
 * Up to four curated questions whose target document the principal can read in
 * the active generation. Readability comes from the document catalog through
 * the same ACL predicate retrieval uses, so a suggestion can never name a
 * document the asker could not retrieve.
 */
export async function loadSuggestions(
  db: SqlExecutor,
  generationId: string,
  principal: Principal,
): Promise<Suggestion[]> {
  const { sql, params } = aclSqlAndParams(aclFilterFor(principal));
  const ids = CURATED_SUGGESTIONS.map((item) => item.documentId);
  const rows = await db
    .prepare(
      `SELECT c.document_id FROM document_catalog c
       WHERE c.generation_id = ? AND c.document_id IN (${ids.map(() => "?").join(",")}) AND ${sql}`,
    )
    .bind(generationId, ...ids, ...params)
    .all<{ document_id: string }>();
  const readable = new Set(rows.results.map((row) => row.document_id));
  return CURATED_SUGGESTIONS.filter((item) => readable.has(item.documentId))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ text, department }) => ({ text, department }));
}
