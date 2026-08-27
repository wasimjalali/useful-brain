---
document_id: nw_operations_business_continuity
title: Business Continuity Policy
source_name: Northwind Operations Business Continuity Policy
source_path: northwind/operations/business-continuity-policy.md
department: operations
access_scope: department
allowed_roles: []
allowed_departments: [operations, engineering, executive]
version: "1.9"
effective_date: "2026-03-01"
---

# Business Continuity Policy

## Purpose and Ownership

This policy defines how Northwind Systems keeps running through
disruptions: natural events, office loss, infrastructure failure,
and vendor failure. It is owned by operations and is shared with
engineering (which runs the technical recovery) and the executive
team (which makes the declaration decisions). The policy sets the
recovery targets and the response structure. It is not the
incident process: technical incidents follow the Incident
Escalation Matrix, and this policy applies when the disruption
threatens the business itself. Questions go to the COO, Victor
Lindqvist.

## Recovery Targets

The recovery targets are: recovery time objective (RTO) of 4 hours
for critical systems (the products, the billing system, the
customer portal, and identity), and a recovery point objective
(RPO) of 30 minutes for data (the maximum data loss accepted on
recovery). Non-critical systems (internal tools, marketing sites)
have an RTO of 24 hours and no RPO commitment. The targets are
measured from the declaration of a disaster to the restoration of
service. The products run in a primary region with a secondary
region standby: the secondary region is tested in the quarterly
DR test, and the failover runbook targets the 4-hour RTO. The RPO
is met by the continuous backup schedule, which the Business
Continuity Policy reviews annually with the engineering team.

## Disruption Levels

Disruptions are classified in three levels. Level 1: a single
office or system affected, handled by the owning team with the
incident process. Level 2: a full office unusable, or a critical
system down beyond its RTO; the COO declares Level 2, the office
manager closes the office (per the Office and Facilities Policy),
and employees work remotely. Level 3: multiple offices or the
company's ability to serve customers affected; the CEO declares
Level 3, the executive team runs the response, and the board is
informed at the next board meeting (see the Board Reporting
Calendar). Declarations are logged with codes in the format
BC-####.

## Response Structure

Each level has a response team. Level 1: the incident commander
from the Incident Escalation Matrix. Level 2: the COO leads, the
office manager runs the office response, and the CTO runs the
technical recovery with engineering. Level 3: the CEO leads, the
executive team meets twice daily, and the COO runs the operations
center. Communication: employees are told through the emergency
channels (email and the facilities portal), customers through the
status page and the Channel and Hours Policy's communication
rules, and vendors through the vendor dependency list. The
response structure is documented in the runbooks, which are
tested in the quarterly DR test and updated after every
activation.

## Office Continuity

Each office has an office continuity plan: the alternate work
arrangement (remote work, which the Remote Work and Flexible
Hours Policy supports), the critical on-site roles (facilities,
IT hardware), and the equipment recovery list (see the Equipment
Return Policy's asset register). When an office is unusable, the
office manager declares it closed, and employees work remotely
under the long-term remote rules; a closure beyond 10 business
days triggers the relocation plan, which moves the critical
on-site roles to the nearest office. The office continuity plans
are reviewed annually and after any Level 2 or Level 3 event.

## Vendor and Data Continuity

Critical vendors (identified in the Vendor and Procurement
Policy's annual review) are on the vendor dependency list, and
their failover plans are tested in the quarterly DR test.
Customer data continuity is covered by the backup schedule (RPO
30 minutes), the secondary region, and the data restoration
tests in the DR test. The DR test is a full failover test of the
products and the billing system, run quarterly, with a written
report to the COO and the CTO. Test failures are tracked to
remediation under the Change Management Policy. Backup and
restore records are retained for three years under the System
Log Retention Policy.

## Insurance and Costs

Business continuity insurance (business interruption and asset
protection) is part of the insurance program renewed each
December 1, per the Regulatory Compliance Calendar. Asset
protection covers the equipment register under the Equipment
Return Policy, and claims are filed by operations with the
COO's approval. Recovery costs during a Level 2 or Level 3 event
are tracked against the BC-#### code and reported to the CFO,
and costs above the insurance coverage are reviewed by the
executive team. The business continuity budget is planned in the
Budget Planning and Forecasting cycle under operations.

## Testing and Review

The quarterly DR test alternates: full failover in February and
August, and tabletop exercises in May and November. The tabletop
exercises cover office loss (Level 2) and a multi-office event
(Level 3). Test reports are reviewed by the COO and the CTO, and
findings are tracked in the change system. The policy itself is
reviewed annually in January, with the runbooks, the vendor
dependency list, and the emergency contact list. The review is
owned by the COO, and the revised policy is distributed to
operations, engineering, and the executive team.
