---
document_id: nw_engineering_on_call
title: On-Call Rotation
source_name: Northwind Engineering On-Call Rotation
source_path: northwind/engineering/on-call-rotation.md
department: engineering
access_scope: public
allowed_roles: []
allowed_departments: []
version: "1.6"
effective_date: "2025-12-01"
---

# On-Call Rotation

## Purpose

The on-call rotation provides 24/7 coverage for incidents at Northwind
Systems. On-call engineers respond to SEV-1 and SEV-2 incidents (see
the Incident Escalation Matrix) and to P0 and P1 support tickets (see
the Support SLA Policy), outside and inside business hours. The
rotation is owned by engineering and is open to engineers at L3 and
above who have completed the on-call training. This policy is public
because support and operations work with the rotation daily. The
on-call calendar is published on the engineering calendar and in the
operations portal, and every engineer can see who is on call at any
time.

## Rotation Structure

The rotation is weekly: an engineer is on primary call for one week,
from Wednesday 10:00 CT to the following Wednesday 10:00 CT. The
handoff is Wednesday 10:00 CT, with a 30-minute handoff meeting
between the outgoing and incoming engineers, covering open incidents,
known issues, and the state of the environment. Every primary slot
has a backup on-call engineer, who covers when the primary is
unavailable or is already engaged on an incident. No engineer is
primary more than one week in four, and no engineer is primary in two
consecutive weeks. The schedule is built three months in advance, and
swaps are managed in the on-call calendar with manager approval.

## Response Requirements

The primary on-call engineer acknowledges pages within 5 minutes and
responds within 15 minutes for SEV-1, and within 30 minutes for
SEV-2, around the clock. The backup responds if the primary does not
acknowledge within 10 minutes. The response standard is the same on
weekends and holidays; holiday coverage follows the Channel and Hours
Policy's holiday rules. On-call engineers must be able to reach a
computer with production access within 30 minutes of a SEV-1 page;
being at a location without connectivity is declared in the on-call
calendar in advance. The incident response itself follows the
Incident Escalation Matrix: the on-call engineer decides severity,
and the on-call lead (a manager or director on the same rotation)
acts as incident commander for SEV-1 and SEV-2.

## On-Call Pay and Time Off

On-call engineers receive a stipend of $150 per day on call, paid
monthly with the normal payroll. Hours actually worked during an
incident are compensated as time off in lieu: one hour of time off
per hour worked on an incident, banked and usable within 90 days,
per the Leave and Time Off Policy's manager approval rules. A SEV-1
incident that runs more than 4 hours past midnight grants the
engineer the following business day off automatically, arranged with
the manager. On-call duty does not change the Remote Work and
Flexible Hours Policy: the on-call week is still a normal working
week, and the stipend is compensation for the availability, not for
hours.

## Escalation Chain

If the primary cannot resolve or the severity warrants it, the
escalation chain is: primary, backup, on-call lead (incident
commander), the CTO, then the CEO for SEV-1 incidents past the
4-hour mark. The support manager is on the chain for customer-facing
incidents, and the CISO joins for security incidents. The chain is
published in the on-call calendar with contact details, and the
Channel and Hours Policy's out-of-hours escalation path (on-call
engineer, support manager on call, VP of Support) runs in parallel
for customer communication. Escalation decisions are logged in the
incident record (INC-####).

## Readiness and Training

Engineers join the rotation after completing: the on-call training
(incident response, communication, the escalation matrix), a
shadow week with a primary, and a supervised first week. The
engineering manager tracks readiness and can pull an engineer from
the rotation if their incident response reviews show gaps. The
on-call training is refreshed annually, in line with the security
awareness training in the Regulatory Compliance Calendar. The
rotation includes engineers from all product teams, so the on-call
engineer for a service is always backed by the owning team's manager
via the escalation chain; the owning team is on the calendar too.

## Metrics and Review

The on-call metrics are reviewed monthly by the engineering manager:
page-to-acknowledge time, page-to-response time, incidents per week,
and stipend spend. The targets: 95% of pages acknowledged within 5
minutes, and 95% of SEV-1 responses within 15 minutes. Missed pages
are reviewed in the weekly engineering meeting, and repeated misses
are handled by the manager. The on-call stipend budget is part of the
engineering budget in the Budget Planning and Forecasting cycle.
The on-call calendar is archived at the end of each year and retained
for three years under the System Log Retention Policy's operational
records.
