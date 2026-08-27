---
document_id: nw_support_kb_guidelines
title: Knowledge Base Article Guidelines
source_name: Northwind Support Knowledge Base Article Guidelines
source_path: northwind/support/knowledge-base-article-guidelines.md
department: support
access_scope: public
allowed_roles: []
allowed_departments: []
version: "1.1"
effective_date: "2025-11-01"
---

# Knowledge Base Article Guidelines

## Purpose

The knowledge base is the self-service library that customers and
support agents use to solve problems with Northwind Core, Atlas, and
Meridian. These guidelines define how articles are written, reviewed,
and maintained. They are public to the company because every department
contributes content: support writes how-tos, engineering writes
integration notes, and product writes feature documentation. The
knowledge base editor is support, and questions about the guidelines go
to the support manager. Articles are stored with codes in the format
KB-####, and every article has an owner who is accountable for keeping
it current.

## Article Structure

Every article follows the same structure: title, summary (two
sentences maximum), the audience (who needs this), the steps or
content, and a "related articles" section. Titles state the task or
problem, not the feature: "How to invite users" rather than "User
invitations." Steps are numbered and start with a verb. Articles over
500 words are split into sections with their own headings, because
the knowledge base search returns sections. Screenshots are
encouraged but must be updated when the product changes; a screenshot
with an outdated interface is worse than none. Articles are written in
plain language at a reading level that a customer's office manager can
follow, not a developer.

## Accuracy Rules

Articles must match the shipped product. If a feature is in beta, the
article says so and links the beta notice. If an article describes a
policy number (refund windows, SLA targets, retention periods), the
number must match the policy document: support articles cannot invent
or update policy. Policy questions are answered by linking the policy,
not by restating it in the article. When a policy changes, the policy
owner notifies the knowledge base editor, and articles citing the
number are updated within five business days. The April and October
SOC 2 audits sample knowledge base articles for accuracy against the
policy set.

## Review and Approval

Articles are drafted in the knowledge base editor and go through two
reviews: a technical review by the product or engineering owner, and
an editorial review by the support manager. Both reviews are required
before an article is published; the exception is urgent incident
articles (SEV-1 or SEV-2), which can be published after the technical
review alone and get the editorial review within five business days.
Published articles are re-reviewed annually, in the month the article
was first published. Articles without a named owner are unpublished
after 90 days. The review history is kept with the article code.

## Maintenance and Retirement

Articles are reviewed for accuracy every 12 months, and the review is
logged. An article that describes a removed feature is retired, not
edited: it is marked "retired" and redirects to the replacement
article or the relevant policy. Retired articles are not deleted for
two years, because customers may still link to them. Articles that
answer the same question as an existing article are merged, and the
merged article keeps the older code with a redirect from the newer
one. The support team runs a duplicate-detection report quarterly.
Articles with zero views in 12 months are flagged for retirement
review.

## Linking to Policies and Tickets

Articles that touch policy link the policy document and never
contradict it. The link conventions: refund questions link the Refund
Policy; SLA questions link the Support SLA Policy; complaint
questions link the Customer Complaint Escalation Path; data questions
link the Privacy Policy and the Customer Data Access Requests process.
Tickets are not linked from articles, but agents can link articles in
tickets. Customer-facing articles must not reference internal
processes: internal codes like RF-####, ESC-####, and CHG-#### appear
only in internal articles, which are marked "internal" and are not
visible to customers in the portal.

## Writing for Agents

Internal articles (agent-only) follow the same structure but can
include internal details: approval thresholds, escalation paths, and
the internal codes. Agent articles are the first place agents look
during triage, so they are written to be scannable: the resolution is
in the first two sentences, and the detail follows. The Agent
Performance Scorecard includes a knowledge base contribution metric:
agents who publish or substantially update an article are credited in
the monthly review. The knowledge base editor runs a monthly
freshness report (articles due for review, articles without owners)
and sends it to the support manager.
