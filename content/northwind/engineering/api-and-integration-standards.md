---
document_id: nw_engineering_api_standards
title: API and Integration Standards
source_name: Northwind Engineering API and Integration Standards
source_path: northwind/engineering/api-and-integration-standards.md
department: engineering
access_scope: public
allowed_roles: []
allowed_departments: []
version: "1.8"
effective_date: "2026-02-15"
---

# API and Integration Standards

## Purpose

These standards define how Northwind Systems builds, documents, and
supports APIs and integrations for Northwind Core, Atlas, and
Meridian. They apply to: public APIs used by customers and partners,
internal APIs between our own services, and integrations built with
our partners under the Partner Program Policy. The standards are
owned by engineering and are public to the company because sales,
support, and partners reference them. The API documentation lives on
the developer portal, and the support team uses it to answer
integration questions. The standards are reviewed annually by the
engineering manager.

## API Design Rules

APIs follow REST conventions with JSON payloads. Resources are
plural nouns, actions use HTTP methods, and errors use the standard
error format with a code, a message, and a correlation ID. Versioning
is in the URL path (v1, v2), and a version is supported for at least
12 months after the next version ships; deprecation is announced 6
months before removal. Pagination is required on list endpoints
(default 100 per page, max 1,000), and rate limits are 60 requests
per minute per API key by default, with higher limits available on
enterprise plans. Idempotency keys are supported on create and
payment endpoints. Every API change goes through the change process
in the Change Management Policy.

## Authentication and Security

All APIs authenticate with API keys or OAuth 2.0. API keys are issued
through the developer portal and are managed per the API Key
Management rules in the Security and Vulnerability Policy: keys are
scoped to the minimum permissions, rotated at least every 90 days,
and revoked on customer offboarding. OAuth 2.0 is used for user-level
access, with the authorization code flow and PKCE for public clients.
TLS 1.2 or higher is required for every connection, and payloads
containing personal data are encrypted in transit and at rest.
Webhooks are signed with HMAC and support retries with exponential
backoff for 24 hours. Secrets are never placed in URLs, logs, or
documentation examples; examples use placeholder values.

## Integration Requirements

Integrations with Northwind products must: use the documented APIs
(the developer portal is the only supported interface), handle rate
limits with retry and backoff, include the correlation ID in support
requests, and pass a pre-release compatibility test before a partner
integration is listed. Customer data flowing through integrations is
subject to the Privacy Policy and the data processing addendum, and
integrations that process personal data must support the deletion
requirements of the Customer Data Access Requests process. Partners
building integrations sign the partner agreement under the Partner
Program Policy, and their integrations are reviewed by engineering
against these standards before listing.

## Documentation Standards

API documentation is generated from the API descriptions and
published to the developer portal. Every endpoint documents: the
authentication required, the rate limit, the parameters, the example
requests and responses, and the error codes. Documentation changes
are reviewed like code changes, and the developer portal version is
published with the release. Deprecated endpoints are marked in the
documentation with the sunset date. The knowledge base articles
about integrations follow the Knowledge Base Article Guidelines and
link the developer portal rather than restating the reference.
Documentation accuracy is checked in the annual standards review.

## Support and Lifecycle

Integration questions are answered by support using the developer
portal and the knowledge base; questions that reveal a documentation
gap are logged as P2 tickets and fixed by engineering. A customer
integration that breaks after an API change is treated as a P1
ticket if it blocks the customer's use of the product, and the
12-month version support window is the commitment engineering makes
to customers. Deprecated APIs are listed on the developer portal
with the sunset date, and the sunset is announced by email to
affected customers 6 months before. The API uptime is measured under
the Support SLA Policy's P0 and P1 targets, and the incident process
of the Incident Escalation Matrix applies to API outages.

## Relationship to Other Policies

The Security and Vulnerability Policy governs API keys, authentication
controls, and the vulnerability process. The Partner Program Policy
governs partner integrations and listing. The Software Development
Lifecycle governs how API code is built, tested, and released. The
Change Management Policy governs API changes, and the Code Deployment
Policy governs how API releases are deployed. The Privacy Policy and
the Customer Data Access Requests process govern personal data in
API payloads. The Knowledge Base Article Guidelines govern the
support articles about APIs.
