---
document_id: nw_support_dsar_process
title: Customer Data Access Requests
source_name: Northwind Support Customer Data Access Requests
source_path: northwind/support/customer-data-access-requests.md
department: support
access_scope: department
allowed_roles: []
allowed_departments: [support, legal]
version: "1.3"
effective_date: "2026-03-05"
---

# Customer Data Access Requests

## What Is a Data Access Request

A data access request is a customer or individual request to access,
correct, export, or delete personal data that Northwind processes.
Requests come in two forms: account-level requests from the customer
(as the data controller for their end users) and individual requests
from a person whose data we hold (an end user, a contact, or an
employee). Both are handled through this process, which is owned by
support and supervised by legal. Every request gets a code in the
format DSAR-#### and is tracked in the privacy system. The process
implements the rights in the Privacy Policy, and the response window
comes from that policy.

## How Requests Arrive

Requests arrive through privacy@northwind.example, the portal, or a
support ticket. Support agents who see a data request in any channel
create a DSAR record within one business day and do not answer the
request themselves; the privacy team answers. A request is not a
ticket: it does not run on the Support SLA Policy clock, it runs on
the 30-day response window. The agent notes the request type (access,
correction, export, deletion, or objection), the requester, and the
data scope. Requests that are really something else (a refund request,
a complaint) are routed to the right process: the Refund Policy or
the Customer Complaint Escalation Path, and the DSAR record is closed
as routed.

## Verification of Identity

Before responding, the privacy team verifies the requester. For an
account-level request, the request must come from a verified account
administrator, and the customer's admin list is checked. For an
individual request about end-user data, the request goes through the
customer's administrator, who verifies the individual, unless the
individual is a contact of Northwind's own (an employee, a prospect, a
billing contact), in which case Northwind verifies them directly.
Verification can require a copy of identification for high-risk
requests (deletion or large exports). If identity cannot be verified,
the request is paused and the requester is told what is missing;
the 30-day clock pauses during verification, and the pause is logged.

## Response Windows

The standard response window is 30 days from the request date (the
date the request is logged with all required information). Complex or
voluminous requests can be extended by up to 60 days, with written
notice to the requester within the first 30 days. Deletion requests
are completed within 30 days: the data is deleted from production and
from backups no later than the next backup cycle, per the Data
Retention Policy. Export requests deliver data in a machine-readable
format (CSV or JSON) within 30 days. Correction requests are applied
within 30 days and the requester is told what changed. Refusals are
rare and are answered with the legal basis; a refused requester can
complain to the General Counsel.

## Roles and Approvals

The privacy team (in support, under the VP of Support) owns the
request work. Legal approves: refusals, requests from regulators,
requests covering more than 100 end users, and any request where the
customer is in dispute with Northwind. The CISO is copied on deletion
requests that touch backups or logs, because the System Log Retention
Policy may apply to log data that is not personal data. Finance is
not involved in DSAR work; billing data is personal data only when it
identifies an individual, and requests covering billing records are
answered by the privacy team with finance's data. Approval decisions
are logged with the DSAR-#### code.

## Escalation and Disputes

A request that is not answered within the 30-day window is escalated
to the privacy team lead the same day it is missed, and to the VP of
Support if it reaches day 45. A requester who disputes a refusal
follows the Privacy Policy's complaint route, and a customer who
escalates a data handling concern to a complaint follows the Customer
Complaint Escalation Path; the ESC-#### and DSAR-#### codes are linked.
Requests from regulators are handled by legal directly, outside this
process, with the General Counsel as the owner. Data subject requests
that reveal a data breach are reported under the Privacy Policy's
breach notification rules and the Incident Escalation Matrix.

## Metrics and Audits

The privacy team tracks: requests by type, response times, extension
rate, and refusal rate. The metrics are reported quarterly to legal
and the CISO, and they feed the annual privacy review in June, per the
Regulatory Compliance Calendar. DSAR records are retained for three
years after the request closes, under the Data Retention Policy, and
the records include the request, the verification, and the response.
The April and October SOC 2 audits sample DSAR handling as part of the
privacy controls. The DSAR process is referenced by the Privacy
Policy, the Data Retention Policy, and the Refund Policy (for data
deletion after refunds).

## Relationship to Other Policies

The Privacy Policy defines the rights and the 30/60-day windows that
this process implements. The Data Retention Policy defines what
happens to data after deletion and the 90-day post-contract
retention. The System Log Retention Policy governs log data, which is
not personal data and is not returned in DSAR exports. The Refund
Policy schedules data deletion 30 days after a refund is processed
for a terminated account. The Customer Complaint Escalation Path
handles customers who escalate data concerns beyond this process.
