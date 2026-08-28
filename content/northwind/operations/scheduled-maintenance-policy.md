---
document_id: nw_operations_scheduled_maintenance
title: Scheduled Maintenance Policy
source_name: Northwind Operations Scheduled Maintenance Policy
source_path: northwind/operations/scheduled-maintenance-policy.md
department: operations
access_scope: department
allowed_roles: []
allowed_departments: [operations, engineering]
version: "1.4"
effective_date: "2026-01-20"
---

# Scheduled Maintenance Policy

## Purpose

This policy governs scheduled maintenance that requires downtime or
that risks customer impact at Northwind Systems: infrastructure
maintenance, database maintenance, and environment work that cannot
run inside the normal change windows. It is owned by operations and
is shared with engineering, which performs the work. The Change
Management Policy covers code changes and configuration changes,
which run in the Tuesday and Thursday 10:00-14:00 CT windows; this
policy covers the separate maintenance window and its notice rules.
Maintenance is logged with change codes (CHG-####) and maintenance
codes (MT-####).

## Maintenance Window

The standard maintenance window is Saturday, 02:00 to 04:00 UTC
(which is Friday 21:00 to 23:00 CT and Saturday 10:00 to 12:00
Singapore time). All downtime maintenance runs in this window.
Maintenance outside the window requires the COO's approval, and
out-of-window maintenance is limited to: emergency maintenance
(see below) and maintenance that cannot wait, approved case by
case. The window exists because it is the lowest-traffic period
across the three regions; the Saturday window is not changed for
regional holidays, but maintenance that falls on a major holiday
in two of the three regions is moved to the next Saturday.

## Notice Requirements

Customers receive 72 hours of notice for scheduled maintenance,
through the status page and email, with the start time, the
expected duration, and the impact. The customer notification is
sent 24 hours before the window starts, once the maintenance is
confirmed. Maintenance that affects a specific customer's data
(an account-level operation) is additionally announced to that
customer by their CSM 5 business days in advance. The notice
includes the maintenance code (MT-####). Maintenance is
cancelled or rescheduled with 24 hours of notice if the
pre-checks fail; a reschedule moves to the next Saturday window
unless the COO approves an earlier slot.

## Emergency Maintenance

Emergency maintenance is maintenance required to protect service
(imminent failure, security patch that cannot wait for a
Saturday window, or recovery from an incident). Emergency
maintenance requires the COO's approval, or the CTO's approval if
the COO is unavailable, and it is logged with a CHG-#### code
and the emergency designation. The customer impact is announced
as soon as the maintenance is approved: the status page is
updated within 1 hour, and affected customers are emailed with
the impact and the expected duration. Emergency maintenance that
runs longer than 2 hours is reviewed by the COO, and a
post-maintenance review is attached within 5 business days.
Three emergency maintenances in a quarter trigger a review of
the infrastructure backlog by the COO and the CTO.

## Maintenance Types

Maintenance falls into three types. Infrastructure: hardware,
network, and cloud service maintenance, with no data impact.
Database: index rebuilds, archive moves, and version upgrades,
with possible brief read-only periods. Environment: staging and
non-production work that does not need a window (staging work
runs any time), and production-adjacent work (monitoring,
logging) that runs in the window. Database maintenance is
scheduled first-come in the window, and the operations team
queues the month's maintenance on the last Friday of the prior
month. Maintenance that can run without downtime (rolling
updates) runs in the Tuesday and Thursday change windows under
the Change Management Policy instead of the maintenance window.

## Maintenance Records

Maintenance records (the MT-#### code, the window, the notice
sent, the outcome, and the post-review) are kept in the change
system and retained for three years under the System Log
Retention Policy's operational records. The monthly maintenance
report (count, duration, incidents caused) goes to the COO, and
maintenance that causes an incident is reviewed under the
Incident Escalation Matrix. The April and October SOC 2 audits
include the maintenance records and the notice evidence. The
maintenance calendar is published quarterly, and the status page
shows the upcoming maintenance 72 hours in advance per the
notice rules.

## Relationship to Other Policies

The Change Management Policy covers code and configuration
changes in the Tuesday and Thursday windows; this policy covers
downtime maintenance in the Saturday window, and the two
policies cross-reference each other's windows. The Channel and
Hours Policy governs how maintenance notices reach customers
through the status page. The Incident Escalation Matrix governs
maintenance that causes incidents. The Business Continuity
Policy covers maintenance during a disaster declaration (the
COO can suspend all maintenance). The On-Call Rotation covers
who is on call during the maintenance window.
