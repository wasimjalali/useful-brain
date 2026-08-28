---
document_id: nw_engineering_incident_escalation
title: Incident Escalation Matrix
source_name: Northwind Engineering Incident Escalation Matrix
source_path: northwind/engineering/incident-escalation-matrix.md
department: engineering
access_scope: department
allowed_roles: []
allowed_departments: [engineering, support, operations]
version: "3.0"
effective_date: "2026-04-01"
---

# Incident Escalation Matrix

## Overview

This matrix defines how Northwind Systems responds to technical
incidents: system outages, data loss, security events, and severe
degradation affecting Northwind Core, Atlas, or Meridian. It is owned
by engineering and is read by support and operations because they are
on the response teams. Incident severities are SEV-1 through SEV-4.
These are not the same as ticket priorities (P0 through P3), which
support assigns in the Support SLA Policy, and not the same as
complaint levels (ESC-1 through ESC-4) in the Customer Complaint
Escalation Path. A P0 ticket opens an incident, but the incident
severity is decided by the on-call engineer using this matrix.
Incidents are logged with codes in the format INC-####.

## SEV-1: Critical Incident

SEV-1 is a complete service outage, confirmed data loss, or a security
breach with confirmed impact. Response: the on-call engineer responds
within 15 minutes, around the clock. The incident commander (the
on-call lead) is appointed within 30 minutes. The CTO and the CISO are
notified within 15 minutes of confirmation. Customer communication
goes out within 1 hour of confirmation, via the status page and email,
per the Channel and Hours Policy. Resolution target: 4 hours; if the
incident is not resolved in 4 hours, the CEO is briefed and the
incident is reviewed by the executive team. A SEV-1 requires a
postmortem within 5 business days, led by the incident commander, with
the CTO approving the action items.

## SEV-2: Major Incident

SEV-2 is a major feature unavailable or severe degradation affecting a
significant portion of users, with no reasonable workaround; or a
suspected security issue under investigation. Response: 30 minutes.
The incident commander is appointed within 1 hour, and the CTO is
notified within 1 hour; the CISO is notified for security-related
SEV-2s. Customer communication within 4 hours. Resolution target: 24
hours. A postmortem is required within 5 business days for SEV-2 as
well, with the engineering manager owning the action items. SEV-2
incidents are summarized in the weekly operations review, and a SEV-2
that lasts more than 24 hours is reclassified as SEV-1 by the CTO.

## SEV-3: Minor Incident

SEV-3 is a partial feature issue, degraded performance for a subset of
users, or a data issue with a workaround. Response: 4 hours, within
business hours. The on-call engineer owns the incident; no commander
is appointed and no executive notification is required. Resolution
target: 72 hours. Customer communication: a status page note if the
issue is visible to customers, otherwise no communication is required.
Postmortems are not required for SEV-3, but the fix is logged in the
change system (CHG-####). A SEV-3 that affects a customer who has
escalated a complaint (ESC-3 or above) is reviewed by the VP of
Support to coordinate the customer response.

## SEV-4: Cosmetic or Minor Issue

SEV-4 is a cosmetic defect, a minor bug with a workaround, or an
internal issue with no customer impact. Response: next business day.
The ticket or bug tracker entry is the record; no incident commander,
no executive notification, and no customer communication. Resolution
target: the next release, per the Software Development Lifecycle's
release cadence. SEV-4 issues are triaged in the next sprint and do
not count as incidents in the monthly incident report, but they are
counted in the bug metrics. SEV-4 issues found by a customer are
logged as P2 or P3 tickets by support under the Ticket Handling and
Priority Policy.

## Roles and Responsibilities

The on-call engineer responds first and decides the severity using
this matrix; when in doubt, they classify one level higher. The
incident commander (on-call lead) runs the response for SEV-1 and
SEV-2: they own the timeline, the communication, and the resolution
effort, and they can pull in engineers from any team. The CTO is the
escalation owner for SEV-1 and SEV-2 and decides reclassifications.
The CISO is the escalation owner for security incidents and leads the
security response under the Security and Vulnerability Policy. The VP
of Support coordinates customer communication for incidents affecting
named customers, and operations runs the status page updates. The
incident commander role rotates with the On-Call Rotation.

## Communication Rules

All incident communication uses the incident code (INC-####). The
status page and customer emails are updated: within 1 hour for SEV-1,
within 4 hours for SEV-2, and as needed for SEV-3. Updates continue
every 4 hours until resolution for SEV-1, and every 12 hours for
SEV-2. Internal updates go to the #incidents channel with the code,
the severity, the impact, and the next update time. Nobody posts
customer-facing incident updates except the incident commander or the
communication owner they appoint; support agents refer customers to
the status page. Post-incident, the postmortem for SEV-1 and SEV-2
is shared company-wide in summary form, with the technical detail kept
internal.

## Incident Records

Incident records (timeline, communication, postmortem, action items)
are kept in the incident system and retained per the System Log
Retention Policy's security record rule: seven years for security
incidents, three years for other incidents. The monthly incident
report (counts by severity, time to resolve, postmortem completion)
goes to the CTO and is included in the April and October SOC 2 audit
evidence. Recurring incident patterns (the same root cause twice in
six months) are escalated to the CTO, who assigns a corrective change
under the Change Management Policy. Incident action items are tracked
to closure in the change system.
