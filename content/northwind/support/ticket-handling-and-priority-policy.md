---
document_id: nw_support_ticket_priority
title: Ticket Handling and Priority Policy
source_name: Northwind Support Ticket Handling and Priority Policy
source_path: northwind/support/ticket-handling-and-priority-policy.md
department: support
access_scope: public
allowed_roles: []
allowed_departments: []
version: "1.9"
effective_date: "2025-12-10"
---

# Ticket Handling and Priority Policy

## Ticket Lifecycle

Every customer request at Northwind Systems becomes a ticket in the
support system. Tickets are created from email, chat, phone, and the
customer portal (see the Channel and Hours Policy), and each ticket
gets a code in the format TK-####. The lifecycle is: triage,
assignment, work, resolution confirmation, and closure. Triage happens
within the first response window of the Support SLA Policy: the agent
classifies the ticket priority (P0 through P3), the product area, and
the ticket type (question, bug, request, or issue). Classification
errors are corrected by the support manager within one business day
when they are found, and the SLA clock is adjusted from the original
creation time, not the reclassification time.

## Priority Definitions

P0: total service outage or complete data loss affecting a customer;
no workaround exists. P1: a major feature is down or performance is
severely degraded for a significant portion of a customer's users; no
reasonable workaround. P2: a feature is partially broken or degraded
for a subset of users, or a workaround exists; also any security or
data question that needs investigation. P3: questions, how-tos,
feature requests, and minor cosmetic issues. Priority is set by the
customer's impact, not by the customer's tone or contract value,
though enterprise customers (annual value above $100,000) get an
automatic review of any P2 classification within one business day.
When in doubt, the agent assigns the higher priority and the support
manager reclassifies.

## Assignment and Ownership

P0 and P1 tickets are assigned to the on-call support engineer within
15 minutes, and the support manager is copied automatically. P2
tickets are assigned to the next available agent in the product
specialty. P3 tickets are assigned by the queue rotation. The assigned
agent owns the ticket end to end: they do the work, they communicate
status, and they close it. Ownership transfers are logged in the
ticket, and a ticket cannot change owner more than twice without the
support manager reviewing. Tickets that need engineering are
transferred with a handover note; the Support SLA clock continues to
run against support, and engineering works under the Software
Development Lifecycle's bug process.

## Status Rules

Ticket statuses are: new, in progress, waiting on customer, waiting on
engineering, resolved, and closed. "Waiting on customer" pauses the
SLA clock (see the Support SLA Policy) and is used only when the
customer has been asked a question that blocks progress. A ticket left
in "waiting on customer" for 10 business days without a reply is
closed as "closed-no-response," after three follow-ups. "Waiting on
engineering" does not pause the clock. Resolved tickets are closed
after the customer confirms, or after 5 business days without
objection. Reopening: a customer can reopen a closed ticket within 7
days of closure, and the reopened ticket keeps its original code and
its original SLA position.

## Communication Standards

The first response includes: the ticket code, the priority, the
expected next step, and a named owner. Status updates are sent every
2 business days for P2 tickets and every 5 business days for P3
tickets; P0 and P1 tickets get updates at every status change, and a
status update at least every 4 hours for P0. Updates are written in
plain language, without jargon, and include what is happening and when
the next update will come. The Knowledge Base Article Guidelines
apply to ticket responses that link articles. Customers who ask for a
manager are routed to the Customer Complaint Escalation Path: the
ticket stays open and the complaint is logged separately with an
ESC-#### code.

## Bugs and Feature Requests

Bugs found in tickets are logged in the engineering tracker with a
link to the ticket, and the priority mapping is: P0 and P1 tickets
open SEV-1 or SEV-2 incidents under the Incident Escalation Matrix;
P2 bugs become engineering bugs with a target fix in the next release
or the release after; P3 bugs are triaged in the next sprint.
Feature requests are logged as requests, not bugs, and are reviewed
quarterly by product. A bug fix is not a ticket resolution: the ticket
resolves only when the customer confirms the fix works. The
Engineering SLAs for fixes are in the Software Development Lifecycle
policy.

## Quality and Audit

The support manager samples 10% of closed tickets each week against
the standards in this policy: classification accuracy, communication
quality, and closure rules. Findings feed the Agent Performance
Scorecard. Ticket data is retained per the Data Retention Policy
(customer relationship records, seven years), and the April and
October SOC 2 audits include the ticket handling controls. Ticket
volume and classification trends are reported monthly to the VP of
Support and feed the support staffing plan in the Budget Planning and
Forecasting cycle.
