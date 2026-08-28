---
document_id: nw_support_customer_onboarding
title: Customer Onboarding Checklist
source_name: Northwind Support Customer Onboarding Checklist
source_path: northwind/support/customer-onboarding-checklist.md
department: support
access_scope: department
allowed_roles: []
allowed_departments: [support, sales]
version: "1.4"
effective_date: "2026-01-01"
---

# Customer Onboarding Checklist

## Purpose

This checklist defines the onboarding process for new Northwind
customers, from signed contract to go-live. It is owned by support and
is used by the customer success team; it is shared with sales because
the account manager hands the customer to onboarding. The goal is a
go-live within 30 days of the contract start date for standard
implementations. Larger implementations (above $100,000 annual value,
or more than 200 end users) can take up to 60 days, agreed in the
onboarding plan. Every step below is tracked in the onboarding system
with a customer code (OB-####), and a step is not done until it is
checked off by the named owner.

## Week 0: Kickoff

The kickoff call happens within five business days of the contract
start date. Attendees: the customer success manager (CSM), the account
manager from sales, the customer's project lead, and the customer's
technical contact. The kickoff covers: the onboarding timeline, the
data migration plan, the training schedule, and the success metrics.
The CSM sends the onboarding plan within two business days of the
kickoff, and the customer approves it within five business days. The
plan includes the go-live date, the milestones, and the named owners on
both sides. The account manager's involvement ends at kickoff; from
then on the CSM owns the relationship until go-live.

## Weeks 1-2: Setup and Migration

In weeks 1 and 2, the technical team: provisions the customer's
workspace, configures single sign-on, sets up roles and permissions,
and starts the data migration for Atlas (data integration) and
Meridian (customer portal) customers. The customer provides the data
files or source connections, and migration is done in a staging
environment first. Data validation is the customer's sign-off step:
the customer confirms the migrated data is complete and accurate
before production migration. The security review is part of setup:
the Security and Vulnerability Policy's customer checklist (SSO
enforcement, role review, audit log access) is completed by the end of
week 2. Any integration using the API follows the API and Integration
Standards.

## Week 3: Training

Training is scheduled in week 3: two training sessions, one for
administrators and one for end users, delivered by the CSM or a
support trainer. Sessions are recorded and posted to the customer's
portal. Administrator training covers: user management, roles and
permissions, billing settings, and the support channels. End-user
training covers: the core workflows, the portal, and where to get
help. Training completion is tracked against the customer's user list;
customers who miss sessions can request makeups within 30 days of
go-live, scheduled by support. Training materials come from the
knowledge base, which follows the Knowledge Base Article Guidelines.

## Go-Live and Post-Go-Live

Go-live happens on the date in the approved plan, with the CSM
confirming all checklist items are complete. The go-live window is
10:00 to 14:00 CT on a business day, matching the change windows in
the Change Management Policy; a go-live that must happen outside the
window needs a change request (CHG-####) under that policy. After
go-live, the CSM runs a 30-day success check: a review call at day 7,
day 14, and day 30, tracking the success metrics from the kickoff.
The customer is assigned a support tier and enters the Support SLA
Policy. The first invoice already went out under the Invoicing and
Payment Terms Policy at contract start; onboarding does not change
billing.

## Handover to Support

Support takes over from the CSM at day 30 post-go-live for standard
customers, or when the success check completes for larger customers.
The handover includes: the onboarding notes, the customer's
configuration summary, the known issues list, and the escalation
contacts. The customer is told who their support contact is and how to
reach support (see the Channel and Hours Policy). Complaints during
onboarding (for example, a missed go-live date) are logged under the
Customer Complaint Escalation Path with an ESC-#### code, and the
onboarding team fixes the cause, not just the complaint. Onboarding
metrics (kickoff-to-go-live duration, missed milestones) are reported
monthly to the VP of Support.

## Failed or Delayed Onboardings

If a milestone is missed by more than five business days, the CSM
escalates to the support manager, who reviews the plan with the
customer. A go-live delayed beyond 60 days from contract start is
escalated to the VP of Support and reported to finance, because the
customer's first invoice is due under Net 30 terms regardless of
onboarding progress (see the Invoicing and Payment Terms Policy). A
customer who cancels during onboarding is handled under the Refund
Policy: annual plans can request a refund within 14 calendar days of
the invoice date, and the onboarding work to date is documented in the
offboarding notes. Customers who never complete onboarding are
flagged in the quarterly business review.

## Relationship to Other Policies

The Refund Policy and the Invoicing and Payment Terms Policy govern
billing during onboarding. The Change Management Policy governs
production changes, including go-live deployments. The API and
Integration Standards govern technical integrations. The Ticket
Handling and Priority Policy and the Support SLA Policy govern support
from the first ticket. The Customer Data Access Requests process
covers data requests during onboarding, including migration data.
Retention of onboarding records follows the Data Retention Policy
(seven years for customer relationship records).
