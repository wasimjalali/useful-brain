---
document_id: nw_support_agent_scorecard
title: Agent Performance Scorecard
source_name: Northwind Support Agent Performance Scorecard
source_path: northwind/support/agent-performance-scorecard.md
department: support
access_scope: role
allowed_roles: [support_manager, director]
allowed_departments: []
version: "1.0"
effective_date: "2026-01-10"
---

# Agent Performance Scorecard

## Purpose

The agent performance scorecard measures support agent performance at
Northwind Systems. It is a management tool: it is visible only to
support managers and directors, and it is not shared with agents
directly; agents receive their individual feedback in their quarterly
check-in. The scorecard is owned by the VP of Customer Support and is
recalculated monthly, on the first business day of the month, for the
prior month. It feeds the quarterly business review and the
performance review cycle (March reviews per the Performance Review
Policy). The scorecard is not the only input to reviews; the
calibration process still applies.

## Scorecard Metrics

The scorecard tracks five metrics. Customer Satisfaction (CSAT): the
percentage of closed tickets rated 4 or 5 out of 5 on the post-closure
survey; the company target is 90%. First Response Time: median time to
first human response, measured against the Support SLA Policy
targets; the target is 4 business hours median for P2 and P3 tickets,
and 15 minutes for P0 tickets. Resolution Time: median time to
resolution; the target is 2 business days for P2 and P3 tickets.
Reopening Rate: the percentage of tickets reopened within 7 days of
closure; the target is below 8%. Knowledge Base Contribution: the
number of articles published or substantially updated by the agent in
the month, per the Knowledge Base Article Guidelines; the target is
one contribution per quarter, tracked monthly.

## Scoring and Weights

Each metric is scored 0 to 100 against the target. CSAT is scored
linearly: 90% scores 100, and each point below 90% costs 10 points,
with a floor of 0. First Response Time scores 100 at or below the
target and loses 10 points per hour over the target, for P2 and P3;
P0 response is a pass/fail gate (a P0 response over 15 minutes caps
the agent's overall score at 70 for that month). Resolution Time
scores 100 at or below 2 business days and loses 5 points per day
over. Reopening Rate scores 100 at or below 8% and loses 5 points per
point over. Knowledge Base Contribution scores 100 for one or more
contributions in the quarter-to-date, and 0 otherwise. The overall
score is a weighted average: CSAT 30%, First Response Time 25%,
Resolution Time 20%, Reopening Rate 15%, Knowledge Base 10%.

## Rating Bands

Overall scores map to four bands. 90 and above: exceeds (eligible for
the top rating in the March review). 75 to 89: meets. 60 to 74: needs
development, with a written improvement plan from the support manager,
reviewed after 60 days. Below 60: at risk, which triggers a review
with the VP of Support and, if repeated for two consecutive months,
the Performance Improvement Plan process under the Performance Review
Policy. Bands are calibrated across the team quarterly: the support
manager compares scores to the calibration outcomes to catch scoring
drift. No more than 25% of a team may land in "exceeds" in any month.

## Reporting and Use

Monthly scorecard reports go to the support managers, and a
team-level summary (no individual names) goes to the VP of Support
and operations leadership. Individual scorecards are discussed in the
quarterly check-in with each agent, alongside the qualitative feedback
from the ticket sampling in the Ticket Handling and Priority Policy.
The scorecard is not used for disciplinary decisions on its own; a
score below 60 for two consecutive months is what starts the formal
process. Scorecard data is retained for two years, per the Data
Retention Policy's exit interview note rule, and the monthly reports
feed the April and October SOC 2 audit evidence.

## Data Sources

CSAT comes from the post-closure survey in the support system. First
Response and Resolution times come from the ticket timestamps, using
the same clock rules as the Support SLA Policy (business hours for P2
and P3, 24/7 for P0 and P1). Reopening counts tickets reopened within
7 days of closure per the Ticket Handling and Priority Policy.
Knowledge Base contributions come from the knowledge base editor.
Automated data is reviewed by the support manager before the monthly
report is final; manual adjustments require a note in the report.
Disputed metrics are resolved by the support manager, and the agent
can request a review of their own metrics through their manager.

## Relationship to Other Policies

The Support SLA Policy defines the targets the scorecard measures, and
the Ticket Handling and Priority Policy defines the ticket rules. The
Customer Complaint Escalation Path is separate: complaints are not
scored as tickets, but an agent with more than three ESC-2 or higher
complaints in a quarter has their CSAT weighting reviewed. The
Performance Review Policy governs how the scorecard feeds the annual
review, and the scorecard does not override the calibration process.
The Knowledge Base Article Guidelines define the contribution metric.
The scorecard is confidential and its existence is not mentioned in
customer-facing materials.
