---
document_id: nw_sales_proposal_quote
title: Proposal and Quote Process
source_name: Northwind Sales Proposal and Quote Process
source_path: northwind/sales/proposal-and-quote-process.md
department: sales
access_scope: department
allowed_roles: []
allowed_departments: [sales, finance]
version: "2.0"
effective_date: "2026-01-30"
---

# Proposal and Quote Process

## Purpose

This process governs how Northwind Systems builds, prices, and
issues proposals and quotes. It is owned by sales and is shared with
finance, which validates quotes at billing time. Every quote gets a
code in the format QT-####, and every order references its quote.
The process applies to new business, renewals, and expansion. The
pricing source of truth is the price list in the pricing system,
maintained by finance; sales does not set prices, it applies the
list and the approved discounts from the Discount Approval Policy.
Questions go to the sales operations team.

## Quote Structure

A quote contains: the customer, the products and quantities, the
term (annual or monthly), the list price, the discount (with its
approval code), the services (setup fees and professional services
days), the payment terms, and the quote validity. Quotes are built in
the pricing system, which applies the price list automatically and
blocks invalid combinations (for example, a discount without an
approval, or partner pricing on a direct quote). Setup fees are fixed
at $2,500 for Core, $1,500 for Atlas, and $1,000 for Meridian, and
are not discountable. Professional services days are quoted at the
published daily rate and are discounted under the same tiers as
products.

## Quote Validity

Quotes are valid for 30 days from the issue date. After 30 days, the
quote expires and a new quote must be issued with the current price
list; the pricing system marks expired quotes automatically. A
customer who accepts an expired quote is re-quoted, and the
re-quote can be at a different price if the list changed. The
validity period is written on the quote, and sales cannot extend a
quote's validity manually; an extension requires the sales manager's
approval and is limited to 15 additional days. Quotes for annual
plans are valid for the term quoted; a customer who signs after the
validity period but before re-quoting has no price guarantee.

## Approval Chain

Quotes require approval before issue: the sales manager approves
quotes up to $100,000 ACV, the sales VP approves quotes from
$100,000 to $250,000, and the CFO approves quotes above $250,000.
These thresholds mirror the contract thresholds in the Contract
Review and Approval Policy, and the two chains run in parallel: a
quote above $100,000 also flags the contract for legal review. The
discount approval (Discount Approval Policy) is attached to the
quote before the quote approval; the quote approval checks that the
discount is approved, and the billing system re-checks at
invoicing. A quote cannot be issued with a pending discount or a
pending approval.

## From Quote to Order

When the customer accepts, the acceptance is recorded in the pricing
system, and the order is created with the quote reference. The
contract is then executed under the Contract Review and Approval
Policy, and the customer is onboarded under the Customer Onboarding
Checklist. The first invoice is generated at contract start under
the Invoicing and Payment Terms Policy, using the quote's prices and
terms; an invoice that does not match its quote is rejected by
billing. Changes after acceptance (add-ons, term changes) are new
quotes. Cancellations after acceptance follow the Refund Policy:
annual plans can request a refund within 14 calendar days of the
invoice, monthly plans within 7 days.

## Renewals and Expansion

Renewals are quoted 90 days before the renewal date, and the renewal
quote follows the same process: new quote code, current price list,
new discount approval (prior approvals do not carry over), and the
same validity period. The contract auto-renews under the standard
terms, but the price is set by the renewal quote: an unsigned
renewal quote at a higher price is billed at the higher price after
the renewal date, with a 15-day notice to the customer. Expansion
(add-ons) is quoted at list price with its own discount approval,
per the Discount Approval Policy's rules. Renewal quotes above
$250,000 trigger the contract review chain like new business.

## Quote Records

Quotes are retained in the pricing system with their QT-#### codes,
including expired and declined quotes. Quote records are contract
records under the Data Retention Policy: seven years after the
contract ends, or seven years from the quote date for quotes that
never became contracts. The quote-to-close rate and the average
discount are reported monthly to the sales VP and feed the pricing
review in the Discount Approval Policy. The April and October SOC 2
audits sample quote approvals as part of the billing controls.

## Relationship to Other Policies

The Discount Approval Policy sets the discount tiers that quotes
apply. The Contract Review and Approval Policy sets the contract
thresholds that quotes above $100,000 flag. The Invoicing and
Payment Terms Policy bills from the quote. The Partner Program
Policy sets partner pricing for partner deals, which use partner
quotes with the partner price model. The Refund Policy governs
cancellations after acceptance. The Territory and Account Assignment
Policy determines who owns the quote and the deal.
