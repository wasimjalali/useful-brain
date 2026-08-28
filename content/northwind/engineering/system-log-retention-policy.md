---
document_id: nw_engineering_log_retention
title: System Log Retention Policy
source_name: Northwind Engineering System Log Retention Policy
source_path: northwind/engineering/system-log-retention-policy.md
department: engineering
access_scope: department
allowed_roles: []
allowed_departments: [engineering]
version: "1.2"
effective_date: "2026-01-15"
---

# System Log Retention Policy

## Purpose and Scope

This policy defines how long Northwind Systems retains system logs:
application logs, access logs, API logs, database logs, and security
logs from the products (Northwind Core, Atlas, Meridian) and from
internal systems. It is an engineering policy; the Data Retention
Policy covers business records (contracts, invoices, HR records,
customer data) and is owned by legal. Logs are not personal data in
the sense of the Privacy Policy and are not returned in data access
requests, but logs that contain personal data (for example, an email
address in a log line) are subject to the Privacy Policy's handling
rules while they exist. Questions go to the CTO's office.

## Retention Schedule

Logs are retained in three tiers. Raw logs (unaggregated application
and access logs) are kept for 90 days. Aggregated logs (metrics,
dashboards, rollups) are kept for 1 year. Security and audit logs
(authentication events, admin actions, permission changes, incident
logs) are kept for 7 years. The 7-year tier exists because the
security records feed investigations, audits, and the April and
October SOC 2 evidence. The tiers apply to production and staging
alike; development environments keep logs for 30 days. Logs are
deleted by the retention job at the end of their tier, and deletion
runs daily. Logs under a litigation hold (HLD-####) are exempt until
the hold is lifted, per the Data Retention Policy.

## What Counts as Security Logs

The 7-year tier covers: authentication events (successes and
failures), admin and permission changes, data export events, API key
creation and revocation, incident response records (INC-####), and
backup access records. Everything else falls in the 90-day raw tier
or the 1-year aggregated tier. When in doubt, engineering classifies
a log as security-related: the cost of keeping a log is small, and
the cost of missing an audit trail is not. Classification is set at
the logging source, reviewed annually, and documented in the log
registry. The CISO approves the classification list, and changes to
the list are logged.

## Access to Logs

Access to logs is role-based. Raw and aggregated logs: engineers,
support engineers for customer incidents, and the on-call rotation.
Security and audit logs: the CISO's team, the CTO, and engineering
managers; support engineers get read access to security logs only for
the customer they are working, and the access is logged. Log access
is granted per the access request process in the Security and
Vulnerability Policy, reviewed quarterly, and revoked on role change
or departure (see the Termination and Offboarding Policy's access
revocation). Logs are not copied to personal devices, and bulk exports
of security logs require the CISO's approval. Log access events
themselves are logged.

## Deletion and Backups

The retention job deletes raw logs older than 90 days and aggregated
logs older than 1 year daily, and the deletion is logged. Backups
containing logs expire on the backup schedule, which means log
deletion from backups can lag by up to 30 days; this lag is accepted
and documented. Security and audit logs are never excluded from
backups: the 7-year tier is backed up with the same schedule as the
rest of production data, per the Business Continuity Policy's RPO of
30 minutes. Log deletion is verified monthly by the engineering
manager, and the verification report is part of the SOC 2 evidence.

## Relationship to Other Policies

The Data Retention Policy covers business records; this policy covers
logs, and where a record is both (for example, an invoice sent by
email, whose delivery log is a log), the longer period applies to the
record and the log tier applies to the log. The Privacy Policy
governs personal data found in logs while it exists. The Incident
Escalation Matrix sets the incident record requirements, which feed
the 7-year security tier. The Security and Vulnerability Policy
governs log access controls and the access request process. The
Customer Data Access Requests process does not return logs; DSAR
exports cover personal data, not log lines.
