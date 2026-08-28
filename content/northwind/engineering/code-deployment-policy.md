---
document_id: nw_engineering_deployment
title: Code Deployment Policy
source_name: Northwind Engineering Code Deployment Policy
source_path: northwind/engineering/code-deployment-policy.md
department: engineering
access_scope: role
allowed_roles: [manager, director]
allowed_departments: []
version: "2.0"
effective_date: "2026-02-01"
---

# Code Deployment Policy

## Purpose and Audience

This policy governs how code is deployed to production at Northwind
Systems. It is written for engineering managers and directors, who are
the approvers in the deployment process; individual engineers
deploy through the pipeline but do not approve. The policy is owned by
the CTO, Ravi Iyer. Deployments are the technical half of production
changes; the Change Management Policy covers the change process
(windows, freeze, approvals) that this policy operates inside, and it
is public to the company. Questions about deployment go to the
engineering manager. Every deployment is recorded with a change code
(CHG-####) from the change system.

## Deployment Pipeline

All deployments run through the CI/CD pipeline; there is no
production access outside the pipeline. The pipeline builds from the
main branch, runs the test suite (the Software Development Lifecycle
policy requires 80% coverage on changed code), scans dependencies for
known vulnerabilities, and produces an immutable artifact with a
build number. Deployments require two approvals: the code owner (the
engineering manager or director of the owning team) and the on-call
lead for the target service. The approvals are recorded in the
pipeline and cannot be added after the fact. The pipeline blocks
deployments outside the approved windows in the Change Management
Policy (Tuesday and Thursday, 10:00 to 14:00 CT), except for emergency
changes approved by the CTO.

## Canary and Rollout

Production rollouts follow a canary pattern: 10% of traffic for 30
minutes, with automated health checks on error rate, latency, and
throughput. A healthy canary expands to 50% for 15 minutes, then to
100%. Any health check failure at any stage rolls the canary back
automatically. Rollback is a first-class action: every deployment
keeps the previous artifact, and rollback completes in under 15
minutes. Database migrations run ahead of the code rollout and are
backward compatible; a migration that is not backward compatible is
rejected at review. Feature flags gate new features, and a feature
behind a flag is not a deployment risk: the flag is the rollback.

## Deployment Freeze and Windows

Deployments run in the standard windows: Tuesday and Thursday, 10:00
to 14:00 CT. No deployments outside those windows except emergency
changes (see below). The annual change freeze runs December 15 to
January 5: no production changes at all during the freeze, including
feature rollouts, except security fixes classified SEV-1 or SEV-2
under the Incident Escalation Matrix, which require the CTO's
approval. The freeze protects the year-end period, and it is enforced
by the pipeline itself: the pipeline rejects changes during the
freeze unless the change carries the CTO's emergency approval.

## Emergency Changes

An emergency change is a fix for a SEV-1 or SEV-2 incident, or a
security fix with a critical rating from the Security and
Vulnerability Policy's patch schedule. Emergency changes bypass the
windows but not the pipeline: they still build, test, and require the
two approvals, and the CTO approves the emergency designation. The
change is logged with a CHG-#### code and a note that it was
emergency; a retrospective is attached within 5 business days. An
emergency change does not count against the team's change quota (see
below), but three emergency changes in a month trigger a review of
the team's testing and review process by the CTO.

## Accountability and Metrics

The deployment dashboard is reviewed weekly by engineering managers:
deployments by team, canary failures, rollbacks, and time to rollback.
The targets: 95% of deployments succeed on the first canary stage,
and rollback time under 15 minutes. Every rollback gets a review
within 5 business days, and rollback causes feed the Software
Development Lifecycle's review process. Deployment records (pipeline
logs, approvals, rollbacks) are retained for three years, and the
April and October SOC 2 audits include the deployment controls.
Engineers who deploy without approvals, or who bypass the pipeline,
face review under the Security and Vulnerability Policy's violation
process.

## Relationship to Other Policies

The Change Management Policy defines the change windows, the freeze,
and the CAB process that this policy operates inside. The Software
Development Lifecycle defines the testing and review requirements
that the pipeline enforces. The Incident Escalation Matrix defines
the severities that trigger emergency changes. The Security and
Vulnerability Policy defines the patch schedule that emergency
security changes implement. The On-Call Rotation defines who the
on-call lead is for the deployment approvals.
