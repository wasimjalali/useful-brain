/** Titles of the documents that failed campaign questions expect, from the Northwind front matter.
 * The Worker cannot read the corpus files, so this is the fallback when the active catalog lacks a document. */
export const CAMPAIGN_DOCUMENT_TITLES: Record<string, string> = {
  nw_engineering_atlas_catalog: "Atlas Connector Catalog",
  nw_engineering_error_code_reference: "Northwind Core Error Code Reference",
  nw_legal_dpa_handbook: "Data Processing Addendum Handbook",
  nw_legal_privacy_policy: "Privacy Policy",
  nw_operations_dr_runbook: "Disaster Recovery Runbook",
  nw_sales_commission_plan: "Sales Commission Plan",
  nw_sales_referral_program: "Referral Program",
  nw_support_complaint_escalation: "Customer Complaint Escalation Path",
  nw_support_sla_policy: "Support SLA Policy",
};
