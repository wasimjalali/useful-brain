---
document_id: nw_operations_procurement
title: Vendor and Procurement Policy
source_name: Northwind Operations Vendor and Procurement Policy
source_path: northwind/operations/vendor-and-procurement-policy.md
department: operations
access_scope: department
allowed_roles: []
allowed_departments: [operations, finance]
version: "2.2"
effective_date: "2026-02-25"
---

# Vendor and Procurement Policy

## Purpose

This policy governs how Northwind Systems buys from vendors: vendor
onboarding, purchase approvals, and vendor management. It is owned
by operations and shared with finance, which pays the invoices.
The policy applies to goods and services for internal use
(software, equipment, office supplies, contractors, professional
services). It does not apply to customer contracts (see the
Contract Review and Approval Policy) or to the Partner Program.
Every purchase is a purchase order with a code in the format
PO-####, and purchases without a PO are not paid.

## Purchase Approval Thresholds

Purchase orders are approved by value. Purchase orders below $5,000
are approved by the requesting manager. Purchase orders from
$5,000 to $50,000 are approved by the operations director.
Purchase orders above $50,000 require the CFO's approval. The
thresholds apply to the PO total, and splitting a purchase into
multiple POs to stay under a threshold is prohibited and is
reviewed in the quarterly audit. Recurring purchases (monthly
subscriptions) are approved once per year at the annual value and
then flow monthly without re-approval. The approval chain is
separate from the budget check: the PO system checks the
department budget (Budget Planning and Forecasting Policy) before
the approval chain runs, and a PO without budget is blocked.

## Vendor Onboarding

New vendors are onboarded before the first PO: the vendor completes
the vendor application with tax registration details (per the Tax
Withholding Policy), banking information, and a signed vendor NDA
(per the NDA Policy). Vendors processing personal data sign the
data processing terms under the Privacy Policy, and their data
handling is assessed by the CISO's team. Onboarding takes up to 10
business days, and vendors are registered with codes in the format
VD-####. Contractors are onboarded as vendors with their agreement
(CT-####) attached, per the Contractor Expense Policy. Vendors
with a compliance failure (a security finding or a failed
reference check) are not onboarded, and the decision is logged.

## Quotes and Competition

Competitive quotes are required: two quotes for purchases of
$10,000 or more, and three quotes for purchases of $50,000 or
more. The quotes are attached to the PO, and the operations
director reviews the comparison for the $50,000 tier. Single
source purchases (one vendor can supply) need a written
justification from the requester and are approved at one level
above the PO threshold. The quote requirement does not apply to:
renewals of existing vendors within 10% of the prior price,
regulated utilities, and emergency purchases under the emergency
rules of this policy. Quote documents are retained with the PO
records.

## Contractors

Contractors are engaged through this policy and the Contractor
Expense Policy: the engagement is a PO with a statement of work,
the contractor's agreement is registered (CT-####), and the
contractor's expenses follow the Contractor Expense Policy.
Contractor rates are set at engagement and reviewed annually; a
rate increase above 5% requires the operations director's
approval. Contractor engagements follow the NDA Policy (vendor
NDA) and the IP and Confidentiality Policy's assignment clause,
which must be signed before work starts. Contractors are
onboarded and offboarded by operations with IT, and their access
is revoked within 24 hours of the engagement end (see the
Security and Vulnerability Policy).

## Vendor Management

Vendors are reviewed annually: security posture (via the CISO's
team), performance, and price. The annual review produces a
vendor scorecard, and vendors below the threshold are put on a
30-day improvement plan or replaced. Critical vendors (those whose
failure would break customer service) are identified with the
Business Continuity Policy's vendor dependency list, and their
failover plans are tested in the quarterly DR test. Vendor
invoices are paid under Net 30 terms per the Invoicing and
Payment Terms Policy, and the PO is matched to the invoice before
payment: an invoice without a matching PO is returned. Late vendor
payments are reported to the CFO, and vendor disputes follow the
Dispute Resolution and Arbitration Policy.

## Records and Audits

PO and vendor records are retained for seven years under the Data
Retention Policy's financial records rule. The quarterly
procurement audit reviews: PO approvals against thresholds,
splitting, quote compliance, and vendor onboarding completion.
The audit findings feed the SOC 2 audit evidence (April and
October). The procurement report (spend by category, vendor
concentration, quote compliance) goes to the COO and the CFO
quarterly, and vendor concentration above 30% of spend in a
single vendor is flagged to the CFO for a diversification
review.

## Relationship to Other Policies

The Contractor Expense Policy governs contractor expenses and
payment. The Vendor NDA comes from the NDA Policy, and vendor
contracts follow the Contract Review and Approval Policy's
thresholds (a vendor agreement above $100,000 needs legal
review). The Budget Planning and Forecasting Policy funds the
POs. The Tax Withholding Policy governs the tax forms vendors
complete. The Business Continuity Policy covers critical vendor
failover. The Dispute Resolution and Arbitration Policy governs
vendor disputes. The Office and Facilities Policy covers
facilities purchases within this policy's thresholds.
