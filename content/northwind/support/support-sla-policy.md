---
document_id: nw_support_sla_policy
title: Support SLA Policy
source_name: Northwind Support SLA Policy
source_path: northwind/support/support-sla-policy.md
department: support
access_scope: public
allowed_roles: []
allowed_departments: []
version: "2.6"
effective_date: "2026-03-20"
---

# Support SLA Policy

## Overview

This policy defines the service level agreements (SLAs) for customer
support at Northwind Systems: how quickly we respond to tickets and how
quickly we resolve them. The SLA applies to Northwind Core, Atlas, and
Meridian customers on paid plans. The priority levels here (P0 through
P3) are ticket priorities, set by the Ticket Handling and Priority
Policy. They are not the same as incident severities (SEV-1 through
SEV-4), which are set by engineering in the Incident Escalation Matrix
for system incidents. This policy is owned by the VP of Customer
Support, and the SLA targets are reviewed quarterly.

## Response and Resolution Targets

SLA targets are measured in business hours and business days. Business
hours are 8:00 to 18:00 Central Time, Monday through Friday; P0 and P1
tickets are covered 24/7. The targets:

| Priority | First response | Resolution |
|---|---|---|
| P0 | 15 minutes | 4 hours |
| P1 | 1 hour | 24 hours |
| P2 | 4 business hours | 3 business days |
| P3 | 1 business day | 5 business days |

First response means a human response from a support agent, not an
auto-reply. Resolution means the customer confirms the issue is
resolved, or the fix is deployed for P0 and P1. The clock stops when
the customer is asked for information that only they can provide, and
restarts when they reply. P0 and P1 targets run around the clock; P2
and P3 targets run in business hours only.

## P0 and P1 Tickets

P0 tickets are total service outages or complete data loss affecting a
customer; they get the 15-minute response and 4-hour resolution
target, 24/7. P1 tickets are major features down or performance
degradation affecting a significant portion of a customer's users;
they get a 1-hour response and 24-hour resolution. P0 and P1 tickets
automatically open an incident under the Incident Escalation Matrix,
and the incident severity is set by engineering; the SLA clock and the
incident response run in parallel. A P0 or P1 ticket that misses its
response target is escalated to the support manager immediately, and
the customer is notified of the delay with a new committed time.

## P2 and P3 Tickets

P2 tickets are partial feature issues, workarounds available, or
performance issues affecting a subset of users; they get a 4-business-
hour response and 3-business-day resolution. P3 tickets are questions,
how-tos, and minor issues; they get a 1-business-day response and
5-business-day resolution. P2 and P3 tickets are covered during
business hours; tickets logged outside business hours start their clock
at 8:00 CT the next business day. P3 tickets that turn out to be bugs
are reclassified to P2 and follow the bug process in the Software
Development Lifecycle. Support agents cannot close a P2 or P3 ticket
without the customer's confirmation of resolution, except after three
unanswered follow-ups over 10 business days, which is recorded as
"closed-no-response."

## SLA Credits

Customers on enterprise plans (annual value above $100,000) are
eligible for SLA credits. A missed P0 response or resolution target
earns a credit of 5% of the monthly fee, capped at 20% per month. A
missed P1 target earns 2% of the monthly fee, capped at 10% per month.
P2 and P3 misses do not earn credits but are logged. Credits are
applied as service credits on the next invoice, and they are approved
by the support manager, not by the agent who missed the target. Credit
requests are handled as goodwill under the Customer Complaint
Escalation Path when the customer asks for more than the SLA table
provides. The SLA credit process is not a refund and does not affect
the Refund Policy.

## Reporting and Accountability

SLA performance is measured weekly and reported monthly: the support
team tracks first response and resolution by priority, and the monthly
report goes to the VP of Support and the operations leadership. The
company targets are: 95% of P0 and P1 tickets within response targets,
and 90% of all tickets within resolution targets. A month below 90%
on P0/P1 response triggers a review with the support manager and the
VP. SLA metrics feed the Agent Performance Scorecard and the Customer
Satisfaction reporting. The April and October SOC 2 audits include the
SLA reports as evidence of the support controls.

## Relationship to Other Policies

The Ticket Handling and Priority Policy defines how tickets are
classified into P0 through P3. The Channel and Hours Policy defines
the channels (email, chat, phone, portal) and the coverage hours.
The Incident Escalation Matrix covers the technical incident response
that runs alongside P0 and P1 tickets, with SEV levels set by
engineering. The Customer Complaint Escalation Path covers complaints,
which are logged with ESC-#### codes and have their own response
times. The Customer Data Access Requests process handles data
requests, which have a 30-day response window regardless of ticket
priority.
