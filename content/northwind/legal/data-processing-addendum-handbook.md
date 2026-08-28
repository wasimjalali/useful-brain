---
document_id: nw_legal_dpa_handbook
title: Data Processing Addendum Handbook
source_name: Northwind Legal Data Processing Addendum Handbook
source_path: northwind/legal/data-processing-addendum-handbook.md
department: legal
access_scope: department
allowed_roles: []
allowed_departments: [legal, sales, finance]
version: "5.0"
effective_date: "2026-06-01"
---

# Data Processing Addendum Handbook

## When a Data Processing Addendum Is Required

A Data Processing Addendum, or DPA, is a separate legal
document that governs how customer data flows between
Northwind and our customers under data protection laws.
Unlike most contract amendments, the DPA is not optional
negotiation material for every deal. It is mandatory only
when the laws that protect personal data in your customer's
jurisdiction require it. The specificity and formality of the
requirement depends on the data types and jurisdictions
involved, not on negotiation appetite or sales momentum.
Understanding when a DPA is required protects both the
company and the customer from legal exposure and sets clear
expectations about data handling from day one. It also
protects Northwind from the risk of a contract that cannot
be executed due to regulatory restrictions.

The legal test is straightforward and turns on a simple
distinction between roles in data processing. A DPA is
required when a customer is a data controller and Northwind
acts as a data processor on their behalf. A controller is the
entity that determines the purposes and means of processing
personal data, making strategic decisions about what data to
collect, how to use it, and for how long to retain it. A
processor is a service provider acting under the controller's
instructions and bound by their directives. The distinction
is critical because processor obligations under GDPR and
similar laws in the UK, Singapore and other markets are
narrower than controller obligations but still legally
binding and consequential. If your customer owns the data
and Northwind stores, indexes or retrieves it on their
instruction, Northwind is a processor and a DPA is
necessary. This is not a negotiable question in the deals
that require one. The legal status of processor is protective
in some ways (narrower scope) but also binding (no flexibility
on customer requirements).

Some transactions are genuinely neither controller nor
processor relationships and do not need a DPA. If Northwind
owns the data outright, we are not a processor, and the
standard contract terms apply without modification. Examples
include competitive analysis we perform with our own web
crawler, or industry benchmarking data we collect and model
independently. In these cases, Northwind is the controller
and the customer is a recipient of analysis or insights, not
a data source. If a customer is a joint controller with
Northwind and the data is co-owned or jointly managed, the
contract may need to document the joint relationship, but the
DPA alone does not settle the question of shared liability
and governance. When joint control is involved, document the
ownership and control split clearly and escalate to legal for
a joint controller addendum if the deal is large enough to
justify one. The line between joint control and processor
relationships can blur when a customer has some control over
processing and Northwind has some autonomy, so legal review
is warranted when roles are unclear.

The controller-processor distinction also determines what a
customer template changes about the approval path and
signature authority. Our standard contract template assumes a
processor relationship and includes basic processor
obligations in the main terms. When a customer proposes
their own DPA instead of accepting ours, the document often
reflects their own legal template from other vendors and may
assume different scopes, regimes or liabilities than
Northwind's standard. This is where approval authority
shifts significantly. A minor change to our standard DPA,
such as clarifying language or adding a specific region to
the data residency schedule, can be approved by Amelia
Brooks, our General Counsel, or Ravi Iyer, our CTO, in
coordination. A customer's custom DPA that differs materially
from ours in scope, liability caps or data location
commitments requires General Counsel sign-off and often legal
review time that should be flagged to the sales team upfront.
Material changes might include liability caps that are
extraordinarily low, data deletion timelines that are shorter
than our technical ability to execute, or processing
restrictions that prevent core product functionality.

The most important rule for sales representatives and
customer success managers is this: never accept a customer's
data protection language directly into any binding
communication without routing it through legal first. This
includes signed emails, statements of work, data
specification documents, and any addendum the customer
provides. Even if the customer's language is titled "for
Northwind's reference only" or comes as an informal pdf, if
it becomes part of the deal record or is referenced in any
signed agreement, it is binding. A sales rep who signs or
agrees to a customer's DPA unilaterally creates a contract
the company may not be able to honor. The result is a rogue
obligation that legal discovers only after a breach allegation
or an audit, at which point remediation is far more costly.
Route customer data protection language to Amelia Brooks or
her team before acknowledging it in writing. This is a bright
line rule that has no exceptions for time pressure or deal
size. Even informal communications that reference data
handling can become binding.

The trigger for obtaining a DPA from us is when a customer
explicitly asks for one, when your contract includes any
data location guarantee, when the customer is subject to
GDPR or UK GDPR in their jurisdiction, or when the
customer's own data protection policy requires their service
providers to sign a processing agreement. Increasingly,
customers in regulated industries require this as a
procurement gate regardless of the actual data sensitivity.
If you are unsure whether a customer qualifies, ask legal
rather than guessing or pushing back. If the customer is
small or the deal is under $50k and covers only non-sensitive
data like usage logs or basic usage metrics, a simple data
processing amendment may suffice instead of a full DPA.
Northwind can offer a streamlined processor amendment for
these cases that protects both parties without the complexity
of a full DPA. Legal can advise on the right scope for the
risk and the customer's jurisdiction. In all cases, the
decision to use our standard DPA versus a custom document
or simplified amendment should come from legal, not from
sales pragmatism.

Regional compliance also influences DPA requirements. If a
customer is headquartered in the EU, UK, or a jurisdiction
with strict data protection laws, a DPA is almost always
required. If a customer is in the United States or other
jurisdictions with less stringent frameworks, a DPA may be
optional depending on what data they are handling. However,
do not assume the absence of a requirement; many US
companies now require DPAs from their service providers as a
standard practice, even if not legally mandated. Industry
regulations also matter. Healthcare providers, financial
institutions, and payment processors often require DPAs
regardless of jurisdiction. If you are unsure, ask legal
during the discovery call rather than learning about the
requirement after a term sheet is signed. Getting clarity on
DPA requirements early prevents deal delays and sets the
right expectations.

Industry and data sensitivity are also important factors in
the DPA decision. If a customer handles particularly sensitive
data such as health information, financial records, or
government data, a DPA is appropriate regardless of the
customer's size or jurisdiction. Northwind's policy is to
require a DPA whenever sensitive data processing is involved.
Sensitive data categories include personally identifiable
information like SSNs, health and biometric data, financial
account information, government IDs, and any data that if
disclosed would cause material harm to individuals. If you
are unsure whether customer data is sensitive, ask legal or
the customer directly. Better to require a DPA than to
discover later that you committed to processing sensitive
data without proper safeguards.

Timeline and contract integration also affect DPA
requirements and approval authority. If a customer requests
a DPA after a contract has been signed, the DPA becomes an
amendment that must be approved by the same signatories who
signed the original agreement. Adding a DPA after deal
closure can be contentious if terms conflict with the main
contract. Clarify DPA requirements before a term sheet is
signed to avoid this friction. If a customer requests a DPA
at the last minute, flag the delay to legal and allow extra
time for review. A rushed DPA review that misses a material
issue creates compliance risk. The timing of DPA requests
should be managed during deal pipeline management.

Common misconceptions about when a DPA is not required can
create compliance exposure. Some teams mistakenly believe
that anonymized or pseudonymized data does not require a DPA.
This is incorrect; if Northwind processes data that can be
linked back to individuals even through a key held by the
customer, that is still personal data and a DPA is required.
Other teams assume that service agreements for purely internal
Northwind data (like our own analytics or usage tracking) need
a DPA. They do not; Northwind's own data collection about
product usage, system performance or customer behavior falls
outside the processor framework and does not require a DPA
unless the customer's data is involved. Another misconception
is that DPAs are only for large enterprise customers. In
practice, any customer subject to GDPR or similar laws may
need one regardless of deal size, so the decision must be made
on legal grounds rather than commercial pragmatism. When in
doubt, consult legal; a clarifying conversation takes minutes
and prevents a costly compliance misstep later.

## Clause-by-Clause Walkthrough

The Data Processing Addendum Northwind provides is a
comprehensive document covering the core obligations and
mechanics of processing customer personal data. It is broken
into functional sections, each addressing a specific aspect
of the data lifecycle from ingestion to deletion. Understanding
each clause is essential for both execution and defense. When
a customer requests changes, knowing the purpose of each
provision allows you to negotiate confidently without
reopening settled issues. Each clause serves a specific
function in protecting both the customer's data rights and
Northwind's operational ability to deliver the product. The
DPA is not a negotiable-on-every-point document; some clauses
are non-negotiable for legal and operational reasons. The
distinction between negotiable and non-negotiable provisions
should be documented in legal guidance.

The first set of clauses establishes the scope of the
relationship and the data involved. Subject matter and
duration define what data is in scope and for how long
Northwind processes it. The typical language states that
Northwind processes customer personal data for the duration
of the contract and for a defined period afterward to comply
with legal hold or retention requirements. This post-term
processing period is usually defined as 90 days after
termination but may be shorter if the customer requests
deletion. The nature and purpose of processing specifies the
categories of data, the types of processing activities
Northwind performs, and the lawful basis for each. For
Northwind Core, this typically includes storage, search
indexing, analytics on anonymized metrics, and delivery of
results to the customer's end users. It may also include
backup and disaster recovery processes and anonymized
research on product usage patterns. Customers often ask to
exclude specific processing types, such as analytics or
machine learning. If a customer wants to exclude a processing
purpose that is fundamental to the product, the contract may
not align with what the product delivers. Flag this to
product and sales before agreeing to a narrower scope,
because accepting a processing restriction you cannot honor
creates future compliance liability. Some processing
purposes can be excluded without affecting core product
function, such as marketing analytics.

Categories of personal data are an important specification
point and require careful documentation. The DPA should
identify the types of personal data processed, such as names,
email addresses, phone numbers, usage data, content data, and
IP addresses. Some customers have very restrictive
definitions of what data they consider sensitive. If a
customer wants to exclude certain data types from processing
that Northwind technically touches, the contract must reflect
that restriction. Document which data types are in scope and
which are excluded. This prevents disputes later when the
customer discovers that data they thought was excluded is
being used in backups or analytics. The scope of data types
can significantly constrain what Northwind can do with the
product. For example, if a customer excludes content data
from analytics, Northwind cannot generate insights on usage
patterns that depend on content characteristics.

Security measures are the operational backbone of processor
obligations and the most frequently audited section. Our DPA
commits Northwind to implementing and maintaining appropriate
technical and organizational security controls. These controls
cover encryption in transit and at rest, access logging,
authentication mechanisms, intrusion detection, employee
background screening, and security training for staff. The
specific requirements are documented in our Data Security
Policy, which is incorporated by reference and updated
regularly. A customer may ask to audit our security controls
or require annual security certifications such as SOC 2
compliance. We complete SOC 2 audits in April and October
each year, and the audit reports are available to customers
upon request. If a customer has an audit requirement with a
specific timeline, verify that our audit schedule overlaps
before committing to a delivery date. Some customers require
quarterly or semi-annual audits, which is an operational
burden that should be escalated to Priya Raman, our Chief
Information Security Officer, for assessment.

Encryption requirements deserve special attention in
security discussions because they have operational
implications. Customers often demand encryption of data in
transit and at rest without understanding the performance
implications. Encryption in transit is standard and
uncontroversial; Northwind uses TLS 1.2 or higher for all
data transmission. This is non-negotiable and applies to all
customers. Encryption at rest is more complex because it
affects system performance and backup procedures. Northwind
supports encryption at rest for most customers and all
Northwind Core deployments use it. However, some customers
demand customer-managed encryption keys, which limits
Northwind's ability to perform diagnostics or recover data in
case of failure. If a customer requires this level of
encryption, discuss with Ravi Iyer about technical
feasibility and support implications. Customer-managed keys
mean that Northwind cannot access customer data even for
legitimate operational reasons, which can create support
limitations.

Access controls and authentication are critical security
provisions. Northwind commits to using multi-factor
authentication for all administrative access to systems
processing customer personal data. Access logs must be
retained for audit purposes. Customers may require that
Northwind implement role-based access controls where
employees access only the data necessary for their role.
Northwind implements this for most customers. Some customers
request that specific geographic regions be restricted from
accessing their data, which may not always be feasible
depending on system architecture. Document any access
restrictions that cannot be met and escalate them to the
security team for technical review.

Confidentiality of personnel is a standard processor clause
that is sometimes overlooked but frequently negotiated by
sophisticated customers. It requires that anyone with access
to customer personal data, including Northwind employees and
contractors, be bound by confidentiality obligations either
through employment agreements or contracts. This clause
protects the customer against unauthorized disclosure by our
staff, whether intentional or accidental. We commit that our
employees sign confidentiality agreements as a condition of
employment and that contractors working on customer data
sign non-disclosure agreements before access is granted.
Temporary staff, interns, and vendors who have access to
systems containing customer data are also bound by
confidentiality. Customers occasionally want to require
background checks for all personnel with data access or
annual security certifications. These requests should be
escalated to our Chief Information Security Officer, Priya
Raman, for feasibility review. In some industries, such as
financial services or healthcare, customers require
fingerprint-based background checks and ongoing monitoring,
which is a significant operational requirement. The extent
of background checks is influenced by industry norms and
customer risk tolerance.

Audit rights reserve the customer's legal right to audit
Northwind's processing activities and security practices and
are a critical control for data controllers. Most customers do
not exercise this right in practice, but some require regular
third-party audits or direct audits of our infrastructure.
The DPA permits audits subject to prior notice (usually 30
days) and reasonable scheduling to avoid operational
disruption. Audit scope is typically limited to systems that
process the customer's data, not our entire infrastructure.
Audits can be performed by the customer's internal team, an
external audit firm, or a compliance body. If a customer
demands real-time, unannounced audit access or requests
monthly audits, this is an operational burden worth flagging
to our Chief Technical Officer, Ravi Iyer, for technical
feasibility assessment. Some large enterprises retain
dedicated audit firms to perform continuous monitoring or
require that Northwind grant remote access to audit tools
throughout the year. These requirements must be approved by
executive leadership and scoped to avoid performance impact.
Audit scope should be clearly defined so audits do not become
fishing expeditions into unrelated systems.

Breach notification is the clause most often negotiated and
the one with the highest business impact. When personal data
is compromised or potentially compromised, Northwind must
notify the customer without undue delay. Clause 7.3(b)
specifies that Northwind will notify the customer of any
confirmed personal data breach within 48 hours of
confirmation. This 48-hour window is the single most
negotiated line in our DPA. It is negotiated so heavily
because it is genuinely difficult to meet operationally and
carries significant legal weight. A confirmed breach requires
investigation to determine the scope of data affected, the
access patterns that occurred, the timing of the unauthorized
access, and remediation steps. For a large dataset or a
breach affecting multiple customers, gathering this
information and communicating it accurately within 48 hours
is operationally challenging. Northwind must coordinate
between security, engineering, product, legal and customer
success to provide accurate notification. Some customers
request immediate notification or notification within 24
hours, which may be impossible if the breach is complex.
Others request notification "as soon as reasonably possible"
without a specific timeline, which gives more flexibility.
Our commitment is 48 hours. If a customer pushes for a
tighter timeline, escalate to Amelia Brooks and our Chief
Information Security Officer. Do not accept a timeline of
less than 24 hours without executive approval, as the
company cannot reliably meet faster timelines.

The definition of breach itself is important and should be
clearly documented. Northwind defines a breach as any
unauthorized access, disclosure, or loss of personal data.
This includes internal misuse by employees, external hacker
access, and accidental disclosure. Some customers want to
exclude certain access scenarios from breach requirements,
such as access by authorized personnel. Do not accept such
carve-outs; any unauthorized access must be treated as a
potential breach and reported. The investigation process
determines whether the exposure was real and material, but
the initial notification cannot be delayed pending
investigation findings. The 48-hour clock starts when the
breach is confirmed, not when it is discovered. Confirmation
typically requires evidence of actual data access or exposure,
not just a vulnerability.

Return and deletion of data at contract termination is
another core processor obligation that must be carefully
implemented. When a customer contract ends, the DPA requires
Northwind to either return all customer personal data in an
extractable format or delete it within a specified period,
typically 30 days after termination. Some customers request
destruction certification or proof of deletion by a third
party. Northwind's commitment is deletion within 30 days,
per our Data Retention Policy. The customer may request
shorter timeframes (for example, within 7 days) or may
require that Northwind certify destruction in writing by
executive leadership. Shorter deletion timelines should be
escalated to our Chief Technical Officer to assess technical
feasibility, as distributed systems may need time to
propagate deletions across all replicas and backups. The
deletion process must account for data in active storage,
backups, disaster recovery instances, and logs that may
contain extracted personal data. Complete deletion across all
systems is complex and must be coordinated across teams.
Some customers will accept a phased deletion plan if
immediate deletion is not possible.

Return of data is an alternative to deletion if the customer
prefers to retain control of their data. The customer may
request that Northwind return all data in a portable format
such as CSV or JSON instead of deleting it. Northwind must
be able to export data in a format the customer can use with
other systems. If the customer requests data return, confirm
that the technical team can meet the export format and
timeline before committing to it. Data export requires that
customer personal data be separated from Northwind's
operational data and exported in a clean format. For large
customers with years of data, this can require significant
engineering effort. Data export timelines typically range
from 15 to 45 days depending on data volume.

Liability and limitations of liability are heavily negotiated
in every processor DPA and require careful cost modeling. A
processor DPA typically limits Northwind's liability for data
breaches to the fees paid by the customer in the 12 months
preceding the breach, or some multiple of annual fees. This
cap is standard in the industry and reflects the fact that the
processor is not in control of many factors that influence
risk. Customers sometimes request unlimited liability,
carve-outs from liability caps for certain breach types, or
liability floors that ensure compensation exceeds the cap
for high-value breaches. Liability negotiations require
General Counsel review and often involve the Chief Financial
Officer, Marcus Webb, if significant liability exposure is
being proposed. Very large customers sometimes negotiate for
liability caps of two or three times annual fees instead of
one times fees. These negotiations are complex and require
legal to model the exposure carefully. The liability cap
should be reflected in the main contract and the DPA should
reference it consistently.

Data subject rights are an important feature that bridges
the DPA and customer obligations. The DPA requires that
Northwind cooperate with customer requests from data
subjects exercising their rights under data protection laws.
These rights typically include the right to access their
data, to correct inaccurate data, to request deletion, and to
object to certain processing. When a data subject sends a
request to Northwind, the company must respond in accordance
with the Privacy Policy. Northwind typically routes data
subject requests to the customer unless the customer
explicitly authorizes Northwind to respond directly. For
deletion requests, Northwind must coordinate with the
customer to delete the data in accordance with the Privacy
Policy. Some customers ask Northwind to handle data subject
requests directly, which shifts the response obligation to
Northwind. If a customer requests this, the DPA must
explicitly authorize Northwind to respond to data subjects
on the customer's behalf.

## Subprocessor Management

Northwind often engages subprocessors, which are third-party
vendors that process customer personal data on Northwind's
behalf. Common examples include cloud infrastructure
providers like the major cloud platforms, email and
communication vendors, backup and disaster recovery services,
payment processors, analytics platforms, and content
delivery networks. When Northwind uses a subprocessor to
handle any portion of customer personal data, the DPA
requires that the subprocessor be approved by the customer
and bound by equivalent data protection obligations. This
protects the customer by ensuring that data does not flow to
vendors without oversight and that each vendor in the supply
chain is held to the same standards Northwind commits to.
Subprocessor transparency is a core principle of processor
accountability. The list of subprocessors is often a
significant discovery point for customers evaluating
Northwind as a vendor.

The subprocessor approval process follows a formal flow that
is designed to be efficient while protecting customer rights.
When Northwind on-boards a new vendor or changes an existing
vendor that will process customer personal data, the
subprocessor is added to a published list called the
Subprocessor Register. This register is updated and provided
to all customers on a regular schedule, at least quarterly
and more often when changes occur. The current version of
the published Subprocessor Register is SPR-2026. Customers
are notified of the register and the URL where it is published
at contract inception and whenever the register is updated.
The register is public and can be accessed by any customer
or prospective customer to understand the full vendor
ecosystem that Northwind relies on. Registration is a
prerequisite to processing; no vendor begins processing data
before being added to the register. The register is maintained
by Northwind's Data Protection Officer with updates
coordinated across operations and security teams.

When a new subprocessor is added to the register, customers
have a defined objection window to review the change and
raise concerns about vendor practices or locations. The
standard objection window is 30 days from the date the
register is published with the new subprocessor listed. If a
customer objects to a particular subprocessor, the company
works with the customer to find an alternative arrangement
that meets both parties' requirements. The objection process
is not a veto power, but rather a negotiation opportunity.
If no alternative exists and the customer's objection cannot
be resolved through discussion, the customer may terminate
the contract for that customer's convenience with 90 days
notice. This termination right is the customer's primary
remedy for an unacceptable subprocessor. In practice,
objections are rare because Northwind maintains high
standards for the vendors it selects. When objections do
occur, they usually relate to vendor location, data
protection practices, or industry concerns rather than
fundamental unsuitability. Northwind coordinates with
objecting customers to understand their concerns and find
mutually acceptable solutions.

Flow-down obligations ensure that subprocessors are legally
bound by the same data protection commitments Northwind
makes to customers and cannot circumvent those protections.
When Northwind contracts with a subprocessor, the contract
must include data processing terms that are no weaker than
the terms in our customer DPA. This includes security
obligations, confidentiality of personnel, audit rights, and
breach notification timelines. Northwind is responsible for
enforcing these obligations against subprocessors and for
monitoring their compliance. If a subprocessor fails to meet
a data protection requirement, Northwind remains liable to
the customer for the failure. This is why due diligence on
subprocessors is critical. Before a new vendor is on-boarded,
our procurement team or the business owner proposing the
vendor must complete a vendor security assessment that
confirms the vendor has equivalent controls to ours. The
assessment includes a review of the vendor's security
certifications, data practices, and contract terms. Vendors
that do not meet our security standards are not approved,
regardless of business convenience. The procurement process
is a gate that prevents risky vendors from accessing customer
data. Subprocessor contracts are reviewed by legal to ensure
flow-down language is included.

Annual subprocessor review is a governance checkpoint that
ensures the subprocessor list remains accurate, current, and
compliant with evolving standards. Each year, Northwind
reviews the complete list of subprocessors, confirms that
each subprocessor is still necessary and meets our security
standards, and publishes an updated register. Subprocessors
that no longer process customer data or that have been
replaced are removed. The updated register is distributed to
customers before January 31 each year to allow time for
objection before the new fiscal year begins. This annual
cycle is documented in the Data Protection Framework Policy
and is overseen by our Chief Information Security Officer,
Priya Raman, in coordination with our Chief Technical
Officer, Ravi Iyer. The process ensures that the register
reflects reality and that customers are not surprised by
vendor changes mid-year. Customers that request custom
subprocessor approval processes often negotiate for direct
notice of new additions or exclusion requirements.

Customers sometimes request the right to pre-approve
subprocessors before they are added to the register, or to
require individual approval for each subprocessor that
processes their data. These requests should be treated as
custom requirements and escalated to Amelia Brooks for
review. A blanket pre-approval requirement could slow our
vendor on-boarding process and make it difficult to respond
to operational needs or security incidents that may require
rapid vendor changes. However, some large or compliance-
sensitive customers justify a custom approval process. Document
any such agreement in a separate addendum to the DPA and
ensure that legal, product, and operations teams understand
the approval gates and timelines. Pre-approval agreements
must define a timeline for customer response (usually 15
days) to avoid creating deployment blockers. The timeline
should account for customer review cycles and time zones.
Pre-approval agreements also need to specify what happens if
the customer does not respond within the timeline.

Subprocessor notifications are triggered whenever a new
subprocessor is about to begin processing customer data, not
when a contract is merely signed with the vendor. This
distinction matters significantly for timing and operational
planning. A vendor can be contracted weeks before it
processes live data. The notification and objection window
begins only when the vendor is actually added to the register
and begins handling customer personal data. This timing
should be communicated clearly to customers when new
subprocessors are announced. Northwind does not hold data
pending subprocessor notification; the notification follows
closely after on-boarding begins. Some customers may request
a longer notice period before a subprocessor begins
processing their data, which should be documented in a side
letter or contract amendment.

Transparency is a key principle in subprocessor management
and builds customer trust in Northwind's vendor ecosystem.
The Subprocessor Register is public and includes the
subprocessor name, location, and processing purpose. This
transparency allows customers to make informed decisions
about data residency, vendor concentration, and regulatory
alignment. Customers can review the register at any time on
the Northwind website or by requesting a copy in accordance
with the Privacy Policy. The registry is updated whenever the
register version changes, not on a daily or weekly cycle. Each
version update is tracked so customers can see historical
changes and understand how the vendor ecosystem has evolved.
Some customers download the register periodically to track
changes for their own compliance purposes. Northwind also
provides change logs showing which subprocessors were added
and removed in each release.

Subprocessor vendor risk management is an ongoing process
that extends beyond the initial on-boarding. Northwind
monitors subprocessor security practices through audit
reports, certifications, and periodic security assessments.
If a subprocessor experiences a significant security
incident, Northwind evaluates whether to continue the
relationship or replace the vendor. Changes in subprocessor
security posture should trigger a risk re-assessment.
Northwind also tracks industry consolidation and acquisition
activity that might change subprocessor control or practices.
If a subprocessor is acquired by a vendor that does not meet
Northwind's standards, the relationship may be terminated or
modified. Northwind considers subprocessor concentration risk;
if multiple critical functions depend on a single vendor,
Northwind may reduce that dependency to minimize business
continuity risk. Subprocessor risk management is part of
Northwind's broader business continuity planning.

Subprocessor location and jurisdiction have legal and
commercial implications for customers and should be
documented clearly in the register. Some customers exclude
subprocessors from certain countries due to regulatory or
geopolitical concerns. The Subprocessor Register documents
the subprocessor's principal place of business so customers
can identify and object to subprocessors in excluded
jurisdictions. Northwind communicates subprocessor location
clearly in the register and allows customers to object if a
subprocessor's location conflicts with their compliance
requirements. If a subprocessor is acquired and moved to a
new jurisdiction, this is treated as a subprocessor change
and requires updated register notification. Some customers
require that certain subprocessors remain in specific
regions, which constrains Northwind's vendor choices. These
requirements should be documented in the DPA residency or
subprocessor addendum.

Subprocessor exit management is an important consideration
when a vendor relationship ends. When a subprocessor is
replaced or retired, Northwind ensures that the subprocessor
deletes or returns all customer personal data within the
timeframe specified in the subprocessor's contract. The
exiting subprocessor must confirm data deletion or return and
must not retain copies for any purpose. Northwind verifies
that data deletion is complete before removing the vendor
from the register. If a subprocessor is acquired by another
company, the new owner is treated as a new subprocessor and
must go through the approval process. Northwind does not
automatically transfer customer data from an acquired
subprocessor to a new owner; customer approval is required.
Subprocessor transitions must be planned to avoid data loss
or disruption to service.

## Cross-Border Transfers

Personal data collected from individuals in one country and
processed or stored in another country is a cross-border
transfer and is subject to heightened regulation. Cross-border
transfers are highly regulated under GDPR and UK GDPR, which
apply to data of EU and UK residents, Singapore's Personal
Data Protection Act, and similar laws in other markets where
Northwind operates. Without a lawful mechanism for
cross-border transfer, Northwind cannot legally process
customer data if the data originates from a jurisdiction with
stricter data protection laws than the destination country.
The DPA addresses this by specifying approved transfer
mechanisms and data residency commitments. Transfer
compliance is not optional and is a foundational requirement
for any contract involving personal data from protected
jurisdictions. Violations of transfer restrictions can result
in substantial fines and legal liability. Understanding
transfer mechanisms is essential for legal compliance and
for customer due diligence.

The primary transfer mechanisms approved for Northwind
operations are documented in Schedule C-2, which lists the
mechanisms for each region and the countries or regions
covered by each mechanism. The mechanisms include contractual
clauses, transfer impact assessments, and adequacy decisions
recognized by data protection authorities. This schedule is
reviewed annually and updated if transfer mechanisms change
due to regulatory developments or court rulings. For
transfers to the United States, the primary mechanism is
standard contractual clauses combined with a documented
transfer impact assessment. For transfers within the United
Kingdom, transfers are permitted under UK GDPR to countries
deemed adequate or using approved transfer mechanisms such as
UK Standard Contractual Clauses. For transfers to Singapore,
Northwind relies on contractual clauses and transfer
agreements that have been assessed under Singapore's Personal
Data Protection Act. Each region may have different
requirements based on local law and regulatory guidance.
Transfer schedules cover subprocessor transfers outside
Northwind's core regions and regional transfer arrangements.
These documents are the authoritative source for determining
whether a transfer is compliant.

Data residency commitments are specific guarantees about
where customer personal data will be stored or processed and
are often a key purchase decision for regulated customers.
Northwind operates data centers in three regions: Austin
(United States), London (United Kingdom), and Singapore
(Asia-Pacific). Customers often want to commit their data to
a specific region for compliance, performance, latency, or
preference reasons. When a customer requires data residency
in a specific region, the DPA is amended to include a
residency schedule that names the committed region and
limits processing to that region. This commitment is a
binding obligation that shapes infrastructure decisions. If
Northwind later needs to move data due to infrastructure
changes, expansion of services, or disaster recovery, the
customer's consent is required in writing. Some customers
require that the customer's data never leave the specified
region, even temporarily for backup or disaster recovery,
which must be honored through technical controls. This is a
strict requirement that must be built into systems. Residency
commitments limit Northwind's operational flexibility and may
prevent failover to other regions in case of emergency.

Austin is our primary US region and hosts most North
American customers. The Austin data center is fully managed
by Northwind and located in Texas. London is our EMEA region
and serves customers that must comply with UK GDPR and EU
regulations. The London facility is also internally operated
and meets UK data residency requirements. Singapore is our
Asia-Pacific region and serves customers in that geography.
The Singapore center supports customers in APAC and meets
local regulatory requirements. Backups are maintained in the
same region as primary data unless the customer agrees
otherwise. Disaster recovery may require cross-region failover,
but this is communicated to the customer and documented in
the DPA. If a customer demands residency with no backup or
replication outside the region, this creates a single-point-
of-failure risk that should be communicated to the customer.
Northwind also offers regional subprocessor arrangements for
customers requiring residency Northwind cannot provide.

Transfer impact assessments are mandatory risk analyses that
evaluate whether a specific cross-border transfer complies
with data protection laws and regulations in all affected
jurisdictions. An impact assessment examines the legal
framework in the destination country, including government
surveillance laws and data access requirements; the technical
and organizational safeguards Northwind has in place to
protect data; and the risk that government authorities in
the destination country could require disclosure of the data
in violation of the customer's rights. For larger customers
or sensitive data types, customers often request that
Northwind share the transfer impact assessment or conduct a
joint assessment. These assessments are reviewed by
Northwind's Data Protection Officer to ensure they meet legal
requirements and comply with evolving case law and regulatory
guidance. The assessment process is rigorous and takes
several weeks to complete for new transfer mechanisms.
Assessment documentation is maintained and prepared for
regulators or auditors upon request. Transfer assessments are
updated whenever regulations change or new court rulings
affect approved transfer mechanisms.

When a customer demands data residency in a location
Northwind does not support, the options are limited and
require escalation to executive leadership. If Northwind does
not have infrastructure in the requested region, the
customer's requirement cannot be met without building new
capacity or engaging a regional subprocessor. Before
committing to a new region, the decision requires approval
from our Chief Technology Officer, Ravi Iyer, and often from
our Chief Financial Officer, Marcus Webb, if infrastructure
investment is needed. If the customer's residency requirement
is a deal-breaker and Northwind cannot accommodate it, the
contract may not be viable. This should be flagged early in
the sales process so the customer can be informed upfront
rather than discovering the constraint late. Some customers
will accept a compromise, such as a subprocessor in the
requested region with Northwind's continued involvement, or a
phased approach where residency is achieved by a future date
when new infrastructure becomes available. Building new
regional capacity requires months and significant investment.
Northwind evaluates residency requests strategically to
determine which regions merit infrastructure investment.

Ingrid Halloran, our Data Protection Officer, is the
escalation point for any residency commitment Northwind
cannot approve through standard processes. If a customer
requires residency in a region where Northwind does not have
presence and the request is tied to a significant contract,
Ingrid assesses whether a subprocessor arrangement or a
custom transfer mechanism is feasible. Ingrid also signs off
on transfer impact assessments for all cross-border transfers
and is responsible for monitoring regulatory developments
that affect transfer mechanisms. If a transfer mechanism is
struck down by a court ruling or regulatory decision, Ingrid
and the legal team work to identify compliant alternatives
for affected customers. Ingrid maintains relationships with
data protection authorities and industry groups to stay
informed of regulatory changes and emerging best practices.
When a new regulation or court ruling affects transfers,
Ingrid coordinates the company's response and communicates
changes to customers proactively. Ingrid's contact
information is available to customers requesting transfer
assessments or residency guidance.

Regulatory changes affecting cross-border transfers can occur
without warning and require rapid response. Courts and data
protection authorities periodically find existing transfer
mechanisms deficient, and regulators publish guidance that
narrows permissible transfers. Northwind monitors these
developments and updates transfer mechanisms when necessary.
If a new regulatory restriction affects a customer's data,
Northwind communicates the change to the customer and works
collaboratively on a compliant solution. This may involve
re-architecting data flows, engaging new subprocessors in
compliant jurisdictions, or implementing additional technical
safeguards. This is part of Northwind's commitment to data
protection compliance as a foundational principle, not a
compliance checkbox that is revisited only during audits.
The company views transfer compliance as an ongoing
responsibility that shapes product decisions and vendor
strategy. When transfers are restricted by new law, Northwind
treats it as a business-critical issue, not a legal paperwork
exercise. Northwind tracks regulatory changes and has
contingency plans for major transfer route disruptions.

Adequacy findings and their implications are important to
understand for European customers. The EU and UK have
published adequacy findings for certain countries, meaning
that transfers to those jurisdictions are permitted without
additional safeguards. The United States does not have an
EU adequacy finding, which is why Northwind uses contractual
clauses and transfer impact assessments for US transfers.
Adequacy findings are reviewed periodically and may be
revoked if regulatory changes make a jurisdiction no longer
adequate. If a country loses its adequacy status, transfers
to that country must shift to alternative mechanisms.
Northwind tracks adequacy decisions globally and updates
transfer mechanisms when adequacy status changes.

Contractual clauses that govern transfers are incorporated
into the DPA by reference and define the legal basis for
transfers. These clauses impose obligations on both
Northwind and the customer to protect data and to support
each other in meeting regulatory obligations. Northwind
commits to ensuring that subprocessors are also bound by
equivalent contractual obligations. If a transfer violates
the contractual clauses due to government action in the
destination country, Northwind commits to cooperate with the
customer and data protection authorities to restore
compliance. Contractual clauses are the industry standard
mechanism for trans-Atlantic transfers and are regularly
updated by regulators to address new concerns and court
rulings. Northwind uses the most current standard contractual
clauses in all transfer agreements.

Customer audit and compliance cooperation is a critical
part of transfer compliance. Customers often want to audit
Northwind's transfer impact assessments or verify that
transfers are occurring as documented in the DPA. Northwind
cooperates with customer audit requests related to transfer
mechanisms and provides documentation on request. Customers
may also request that Northwind participate in their own
regulatory audits to demonstrate transfer compliance. These
requests should be routed to Northwind's legal team for
coordination and processing. Northwind maintains comprehensive
transfer documentation that can be produced to regulators or
auditors upon request.
