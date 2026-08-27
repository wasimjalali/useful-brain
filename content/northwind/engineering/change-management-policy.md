---
document_id: nw_engineering_change_management
title: Change Management Policy
source_name: Northwind Engineering Change Management Policy
source_path: northwind/engineering/change-management-policy.md
department: engineering
access_scope: public
allowed_roles: []
allowed_departments: []
version: "2.4"
effective_date: "2026-01-05"
---

# Change Management Policy

## Purpose

This policy governs changes to Northwind's production environment:
code deployments, configuration changes, infrastructure changes, and
customer-facing changes (for example, go-live deployments and feature
rollouts). It is owned by engineering, and it is public to the company
because every department schedules work around the change windows.
The change system assigns every change a code in the format CHG-####,
and a change is not valid without a code. The Code Deployment Policy
covers the technical deployment rules; this policy covers the process,
the windows, and the approvals.

## Change Windows

Standard change windows are Tuesday and Thursday, 10:00 to 14:00
Central Time. All non-emergency changes run inside these windows.
Changes outside the windows require the CTO's approval and are logged
as exceptions; exceptions are reviewed monthly for patterns. The
windows apply to production and to customer-facing staging. Go-live
deployments for customers (see the Customer Onboarding Checklist)
schedule into the same windows, and a go-live that cannot fit a
window is an exception change. Support and operations plan their
maintenance around the windows; infrastructure maintenance that
requires downtime is scheduled separately under the Scheduled
Maintenance Policy, which uses Saturday 02:00-04:00 UTC.

## Change Freeze

The annual change freeze runs December 15 to January 5. During the
freeze, no production changes are made: no deployments, no
infrastructure changes, no customer go-lives, and no configuration
changes that affect production traffic. The only exceptions are
SEV-1 and SEV-2 incident fixes and critical security patches, both
requiring the CTO's approval and an emergency change record. The
freeze is enforced by the deployment pipeline, which rejects changes
during the freeze without the emergency approval. Teams plan their
release schedules so that all work for the year lands before
December 15, and the engineering calendar marks the freeze start and
end every year.

## Change Advisory Board

The Change Advisory Board (CAB) reviews all changes of type "major":
customer go-lives, infrastructure changes, dependency upgrades with
breaking changes, and any change with an estimated impact above 30
minutes of downtime. The CAB meets Wednesdays at 14:00 CT, reviews
the change list for the coming week, and approves or sends changes
back with comments. The CAB is made up of: the CTO (chair), one
engineering manager, the operations manager, the VP of Support, and
the CISO or a security representative. Standard changes (routine
deployments, config changes with no customer impact) do not go to the
CAB; they are approved by the owning engineering manager under the
Code Deployment Policy.

## Change Requests and Approvals

A change request includes: the description, the risk assessment, the
rollback plan, and the owner. Approvals: standard changes are
approved by the owning engineering manager. Major changes are
approved by the CAB. Emergency changes are approved by the CTO, with
the approval logged after the fact within 24 hours (the emergency is
acted on first, the paperwork is completed within 24 hours). No
change runs without the required approval, and the change system
enforces the chain. A change that fails or rolls back is logged with
the outcome, and the team that owns it reviews the failure within 5
business days.

## Change Records

Change records are kept in the change system with the CHG-#### code,
the type, the window, the approvals, and the outcome. Records are
retained for three years, and the April and October SOC 2 audits
include the change records as evidence. The monthly change report
(counts by type, exception rate, failure rate) goes to the CTO and is
reviewed in the weekly engineering meeting. A failure rate above 5%
in a month triggers a process review. The change system is the
single source of truth: changes discussed in email or chat but never
logged are treated as not planned, and work that was not planned is
reported to the CTO.

## Relationship to Other Policies

The Code Deployment Policy covers the technical deployment rules
inside these windows. The Scheduled Maintenance Policy covers
downtime maintenance, which uses different windows (Saturday
02:00-04:00 UTC) and its own 72-hour notice rule. The Incident
Escalation Matrix defines the severities that justify emergency
changes, and the Security and Vulnerability Policy defines the patch
schedule that emergency changes implement. The Customer Onboarding
Checklist schedules customer go-lives into these windows, and the
Business Continuity Policy covers what happens when a change causes
an incident. The on-call lead role is defined in the On-Call
Rotation.
