---
document_id: nw_finance_invoicing_payment
title: Invoicing and Payment Terms
source_name: Northwind Finance Invoicing and Payment Terms
source_path: northwind/finance/invoicing-and-payment-terms.md
department: finance
access_scope: department
allowed_roles: []
allowed_departments: [finance, sales, support]
version: "2.7"
effective_date: "2026-04-01"
---

# Invoicing and Payment Terms

## Standard Payment Terms

Northwind Systems invoices customers under standard Net 30 terms: payment
is due 30 calendar days from the invoice date. Annual plans are invoiced
upfront for the full year on the contract start date, and monthly plans
are invoiced on the first of each month. Invoices are issued through the
billing system with codes in the format INV-####, and are sent by email
from billing@northwind.example on the invoice date. The payment terms
are written into every contract (see the Contract Review and Approval
Policy) and cannot be changed by sales at the point of sale; a Net 60
exception exists for enterprise contracts above $250,000 in annual
value, approved by the CFO and noted in the contract.

## Currency and FX

The default invoice currency is USD. UK customers are invoiced in GBP
and Singapore customers in SGD, based on the customer's billing address;
other customers are invoiced in USD. Currency conversion uses the
monthly finance rate, published on the first business day of each month
and applied to all invoices issued that month. The rate is fixed for the
invoice; FX differences on payment are the customer's risk unless the
contract says otherwise. Customers can request USD invoicing regardless
of location, and the request is granted by the billing team without
approval. The Tax Withholding Policy covers how taxes appear on
invoices.

## Late Payment

Payment is late after the due date plus a 15-day grace period. From day
16 past due, a late fee of 1.5% per month applies on the outstanding
balance, calculated daily and added to the next invoice. The billing
system sends reminders at day 0 (due date), day 15 (grace ending), and
day 30 past due. Service suspension happens at 45 days past due: the
customer receives a 7-day written notice before suspension, and
suspension stops access to all Northwind products but does not cancel
the contract. Accounts are unsuspended within 24 hours of payment in
full or an agreed payment plan. Payment plans are approved by the
finance manager and can extend payment by up to 90 days.

## Payment Methods

Customers can pay by card (all major cards, processed through the
billing portal), bank transfer, or direct debit. Card payments on annual
plans incur no surcharge; card payments on monthly plans incur a 2%
processing fee unless the customer is on a prepaid annual plan. Bank
transfers are free and take 2 to 5 business days to clear; the invoice
is marked paid on clearance, not on instruction. Direct debit is
available in the US, UK, and Singapore and is the recommended method for
monthly plans. Refunds to any of these methods follow the Refund Policy:
processing within 5 to 10 business days, returned to the original
payment method.

## Invoicing for Partners and Resellers

Partner-sourced business is invoiced to the partner, not the end
customer, when the partner is the reseller of record; the Partner
Program Policy defines when a partner is the reseller of record. Partner
invoices follow the same Net 30 terms. Partner commissions are not
invoiced: they are paid separately under the Partner Program Policy on a
quarterly cycle. Discounts applied to invoices must match an approved
discount under the Discount Approval Policy; an invoice with an
unapproved discount is rejected by the billing system and returned to
sales. Quotes that led to the order are referenced on the invoice
(QT-####), which lets billing verify the price against the Proposal and
Quote Process.

## Billing Disputes

Invoice disputes are logged through support with a ticket, and the
billing team responds within five business days. A disputed amount is
not late while the dispute is open, but the undisputed portion remains
due under the original terms. Disputes that are not resolved within 30
days move to the Customer Complaint Escalation Path (ESC-3) and, for
amounts above $10,000, to the Dispute Resolution and Arbitration Policy.
Credit notes are issued only by finance, with a code CN-####, and must
reference the original invoice. Billing errors found by the customer
are corrected under the Refund Policy's billing error exception, in
full, with no window.

## Record Keeping

Invoice records are kept for seven years after the invoice date, per
the Data Retention Policy, and the seven-year retention also applies to
credit notes and payment records. The billing system is the system of
record; emailed invoices are for convenience. The Regulatory Compliance
Calendar lists the audit checkpoints for billing records (April and
October SOC 2 audits). Finance reconciles invoices to revenue monthly,
and any invoice older than 90 days that is neither paid nor disputed is
escalated to the CFO in the weekly billing review.
