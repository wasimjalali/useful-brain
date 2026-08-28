---
document_id: nw_engineering_sdlc
title: Software Development Lifecycle
source_name: Northwind Engineering Software Development Lifecycle
source_path: northwind/engineering/software-development-lifecycle.md
department: engineering
access_scope: department
allowed_roles: []
allowed_departments: [engineering]
version: "3.1"
effective_date: "2026-03-10"
---

# Software Development Lifecycle

## Purpose

This policy defines how software is built at Northwind Systems: from
idea to production. It covers planning, development, testing, review,
and release, and it applies to every product (Northwind Core, Atlas,
Meridian) and to internal tooling. It is an engineering policy, and
it is shared only within engineering because it contains internal
quality targets and review rules. The CTO owns the lifecycle, and the
engineering manager for each team runs it. The Code Deployment
Policy covers the deployment mechanics, and the Change Management
Policy covers the production change process; this policy covers what
happens before deployment.

## Planning and Estimation

Work is planned in sprints of two weeks. Every piece of work has a
ticket in the tracker with a size estimate (S, M, L, XL), and work
larger than XL is split before it enters a sprint. Each sprint starts
with planning on Monday and ends with a review and retrospective on
the second Friday. Features follow the roadmap, which the CTO reviews
quarterly; bugs and incidents (SEV-3 and SEV-4) are triaged into
sprints by the engineering manager. Work that is not in the tracker
is not worked on during the sprint, except for incidents and
emergency changes under the Change Management Policy. The roadmap is
confidential per the IP and Confidentiality Policy and is not shared
outside engineering without the CTO's approval.

## Development and Code Review

Code lives in the main branch, and all work happens on short-lived
feature branches. Every change is a pull request with: a description
of the change, the ticket reference, test coverage for changed code,
and a changelog entry. Pull requests require two approvals: one from
a peer and one from the owning engineering manager or director (the
same approval chain as the Code Deployment Policy). No pull request
is merged with unresolved review comments. The review checks:
correctness, test quality, security (using the security checklist in
the Security and Vulnerability Policy), and performance. Code review
turnaround target is one business day; reviews waiting more than two
business days are escalated to the engineering manager.

## Testing Requirements

Test coverage of 80% is required on changed code, enforced by the CI
pipeline. The test suite runs on every pull request: unit tests,
integration tests, and the contract tests for APIs (see the API and
Integration Standards). Critical paths (authentication, billing,
data export) require integration tests in addition to unit tests.
Performance tests run for changes to hot paths, and the results are
reviewed by the engineering manager. Test flakiness is treated as a
bug: a test that fails intermittently is fixed or quarantined within
one sprint, and quarantined tests are tracked. The CI pipeline blocks
merges on test failure, coverage failure, or dependency scan findings.

## Releases and Cadence

Releases ship on the change windows in the Change Management Policy:
Tuesday and Thursday, 10:00 to 14:00 CT, with the annual freeze from
December 15 to January 5. The release cadence is: Core ships every
two weeks, Atlas every month, Meridian every two weeks; hotfixes
ship as emergency changes under the Code Deployment Policy. Each
release has a release owner (the engineering manager of the owning
team), a release notes entry, and a rollback plan. Releases follow
the canary pattern (10% for 30 minutes) in the Code Deployment
Policy. A release that rolls back is reviewed within 5 business
days, and the review findings feed the next sprint's planning.

## Quality Metrics

The quality metrics are reviewed monthly by the engineering manager:
rollback rate (target under 5%), canary failure rate (under 5%),
SEV-2 and above incidents per month, open bug count by severity, and
time to fix for P0 and P1 bugs (the Support SLA Policy's resolution
targets apply to the support side; engineering's fix target is 4
hours for P0 and 24 hours for P1, matching the incident targets).
The metrics feed the monthly engineering report to the CTO and the
April and October SOC 2 audit evidence. A team with two SEV-2
incidents in a quarter gets a process review led by the CTO.

## Relationship to Other Policies

The Code Deployment Policy governs deployment mechanics and
approvals. The Change Management Policy governs windows, the freeze,
and the CAB. The Incident Escalation Matrix governs incidents and
postmortems. The Security and Vulnerability Policy governs the
security checks in review and the patch schedule. The API and
Integration Standards govern API work specifically. The IP and
Confidentiality Policy governs the code itself, and the Data
Retention Policy governs how long development records are kept
(three years for operational records, seven years for security
records).
