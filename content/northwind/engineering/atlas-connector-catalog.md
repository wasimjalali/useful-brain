---
document_id: nw_engineering_atlas_catalog
title: Atlas Connector Catalog
source_name: Northwind Engineering Atlas Connector Catalog
source_path: northwind/engineering/atlas-connector-catalog.md
department: engineering
access_scope: department
allowed_roles: []
allowed_departments: [engineering, support, sales]
version: "8.2"
effective_date: "2026-07-01"
---

# Atlas Connector Catalog

## How Connectors Are Versioned and Certified

Every connector in the Atlas catalog carries a version identifier and a
certification state that governs its commercial use and support status. The
version track is independent of Atlas itself, allowing connectors to advance
on their own schedule without waiting for platform releases. A connector's
version follows semantic versioning: major for breaking changes to the source
schema or destination contract, minor for new features that remain backward-
compatible, and patch for bug fixes and performance improvements. Engineering
publishes a detailed changelog for each connector update, posted in the
internal connector release notes wiki with descriptions of all behavior
changes, schema modifications, and resolved issues. Customers using a
connector receive email notifications when new versions are available,
allowing time to test before upgrading. Major version upgrades should be
tested in a staging environment before production rollout.

Certification defines the support and commercial guarantees around each
connector. There are three states: Certified, Preview, and Community. Each
state carries different implications for production use, customer support,
and sales eligibility. Certified connectors have passed rigorous testing,
security review, and load validation. They carry a full SLA and support
commitment through the Support SLA Policy, meaning response times and
resolution targets are guaranteed. Certified connectors receive priority bug
fixes and security patches within 24 hours of identification. Certified
connectors are eligible for sale to enterprise customers and appear in the
recommended connector list on the Atlas website and in sales materials.

The certification process is governed by the record ATL-CERT-3, which
mandates that a connector must pass a comprehensive security review by the
Information Security team under the supervision of the CISO and a load test
demonstrating sustained throughput at the contracted SLA rate before it can be
labeled Certified. For a connector marketed to handle 1,000 events per second,
the load test must stress-test at that level with appropriate monitoring and
alerting in place, sustained for at least one hour, to demonstrate stability
and resource efficiency. The security review covers authentication mechanisms,
credential handling, data encryption, access controls, and vulnerability
scanning. Connectors must not leak credentials, must use secure credential
storage, and must validate all user inputs to prevent injection attacks.

Preview connectors are undergoing active development and are not ready for
production deployment. They work in most environments but may change behavior
between releases or encounter unexpected edge cases in production use. A
customer can deploy a Preview connector for evaluation, proof of concept, or
non-critical use where data loss is tolerable. Preview connectors do not
appear in the recommended catalog or in sales materials. Preview connectors
receive bug fixes on a best-effort basis and are not covered by the standard
Support SLA. Customers using Preview connectors should expect longer response
times from support and may be asked to help debug issues. A connector
typically remains in Preview for two to four months before promotion to
Certified, during which time the engineering team gathers telemetry and
feedback to identify missing schema mappings, retry logic gaps, timeout
scenarios, and configuration footguns that users might encounter.

Community connectors are maintained by our partners or by external open-source
maintainers. They ship with Atlas and are available for deployment, but carry
no warranty and no service-level agreement. A Community connector may stop
receiving updates or be archived at the maintainer's discretion without prior
notice to Northwind customers. Support tickets related to Community connectors
are triaged as lower priority, and the engineering team is not expected to fix
bugs in a Community connector on behalf of a customer. Some Community connectors
are high quality and heavily used by many customers; others are experimental
and should only be deployed by customers comfortable with self-support and
troubleshooting. Always check the connector readme, documentation, and the
community forum to understand the current state, maintenance level, and active
user base before recommending a Community connector to a customer. Community
connector issues should be escalated to the external maintainer via their
preferred channel, and Northwind support can provide limited coordination
assistance and information sharing.

Deprecation follows a staged timeline to protect customer integrations and
prevent surprise outages. When a Certified or Preview connector is scheduled
for sunset, the engineering team publishes a deprecation notice well in advance
on the Atlas status page, via email to all customers using that connector, and
in the connector release notes. The notice specifies the last patch version of
the connector that will be supported and the recommended replacement or
migration path. Existing integrations using a deprecated connector continue to
function, but new integrations cannot select a deprecated connector from the
UI, encouraging migration to the current recommended solution. Support for a
deprecated Certified connector extends for a defined period after the final
patch release; after that, support may be limited or escalated to higher
support tiers and customers are expected to migrate to the replacement. These
extended timelines provide sufficient runway for customer teams to plan
migrations at their own pace and retrain their internal staff on new connector
behavior and configuration requirements.

Each connector publishes documentation in the Atlas help center covering the
source or destination system's authentication requirements, available schema
mappings, performance characteristics and benchmarks, and known limitations or
gaps. The docs specify which API versions are supported, rate-limit policies,
pagination behavior, and any special configuration needed. A sales engineer can
share these docs directly with a customer to answer basic questions without
escalating to engineering. For intricate system behavior, undocumented behavior
changes, or architecture questions, the connector maintainer is the definitive
source of truth. Escalations to engineering go through the support ticket
system and are assigned to the connector's maintainer on a rotation schedule.

The connector SDK itself maintains backward compatibility within a major
version. This means a Certified connector built against SDK v3 will continue
to work after a new v3 patch is released, even if internal SDK APIs have
been refactored or optimized for performance. A new SDK major version (v4, v5)
introduces breaking changes to the development interface and connector
lifecycle, and every connector must upgrade to continue receiving support in
that ecosystem. SDK major releases are announced well in advance through
multiple channels including the engineering blog and the connector maintainer
mailing list, giving connector maintainers adequate time to plan upgrades
and test compatibility. This advance notice prevents production disruptions
and allows the maintainer community to coordinate release timing. Maintaining
backward compatibility within a major version ensures that customer
integrations do not break unexpectedly between patch releases.

Connector health monitoring is automated. Every Certified connector publishes
metrics to a central dashboard showing uptime, error rates, average sync time,
and resource utilization. Thresholds are configured to alert the on-call
engineer if error rates spike or if a connector becomes unavailable. Customers
can view a simplified version of the connector health dashboard to monitor
their own integrations. Unhealthy connectors trigger a SEV-2 incident and are
investigated by the engineering team within 30 minutes.

Security updates for connectors are rolled out on an expedited schedule. When
a security vulnerability is discovered in a connector or its dependencies, the
engineering team publishes a patch within 24 hours and notifies all affected
customers. Customers using Certified connectors receive the security patch
automatically if they have auto-update enabled. Customers using manually-pinned
versions are notified to upgrade. Security vulnerabilities in third-party
dependencies are tracked and patched proactively.

Community engagement is important for improving connectors. Customers can report
issues, suggest features, or contribute fixes to connectors on the public Codeforge
repositories. The engineering team reviews pull requests and issues from the
community and incorporates quality contributions. Some customers benefit from
working with the maintainers to add features or fix bugs that are important to
their use cases.

Version pinning is supported for critical integrations. If a customer wants to
lock a connector to a specific version and prevent automatic upgrades, they can
configure version pinning in the connector settings. Pinned versions continue
to receive security patches but not feature updates or breaking changes,
protecting production integrations from unexpected behavior shifts. Customers
should regularly review pinned versions and plan upgrades to stay current with
bug fixes and security improvements. Version pinning is typically used for
large, complex integrations where testing new versions requires significant
engineering effort and thorough validation. Support staff should remind
customers that indefinite version pinning is a technical debt that eventually
requires resolution; all versions have end-of-life dates and will no longer
receive support or security updates, so long-term pinning is not sustainable.

The connector marketplace lists all available connectors with their
certification state, version, and basic features. Customers can search,
filter, and browse connectors to find the right tool for their data integration
needs. The marketplace includes user reviews and ratings that provide insight
into real-world experiences and common issues. A new connector must have at
least three users before appearing in the public marketplace to ensure there
is sufficient adoption and feedback to indicate viability. The marketplace
also includes documentation links, support information, and contact details
for the connector maintainer, allowing customers to reach out with questions
or issues before committing to a deployment.

## Database and Warehouse Connectors

Database connectors ingest data from relational sources like Verdant, Cobalt,
Talos, and Bastion. The fundamental architectural split is between change
data capture (CDC) and polling. CDC connectors read the database's transaction
log or binary log directly, capturing only changes as they occur in real time.
This approach minimizes load on the source database and detects deletes
accurately by reading DELETE statements from the log. Polling connectors run
periodic queries against the source table, looking for rows where a timestamp or
sequential ID has advanced since the last poll. Polling is simpler to deploy
when CDC is unavailable or when the source does not support it, but yields
higher latency (measured in minutes or hours) and higher database load,
especially as the source table grows into millions or billions of rows.

The Verdant source connector, ATL-REL-03, uses logical replication slots to
stream a write-ahead log to Atlas in real time. This is the preferred pattern
because it captures inserts, updates, and deletes with minimal overhead on the
database, and it preserves transaction boundaries so that multi-row updates
stay consistent. To use this connector, the source Verdant instance must have
logical replication enabled via the `wal_level` setting and must grant
replication privileges to the connector's database user. The connector
automatically provisions a replication slot on first run and cleans it up when
dropped. Failover to a replica can drop the replication slot if the slot is
not configured as permanent, so production deployments should coordinate with
the DBA team on replication topology and failover procedures. If the
replication slot is dropped on the standby, the connector loses its position
and must restart from the beginning, resulting in duplicate data in the
destination.

Logical replication in Verdant is based on the write-ahead log (WAL), which
records all changes before they are applied. The replication slot retains WAL
segments until the connector has consumed them, preventing the database from
discarding them. If the connector is offline for an extended period, the WAL
segments accumulate and consume disk space on the source database. Production
deployments should monitor WAL segment retention and alert if segments exceed
thresholds. If the connector is offline for so long that the WAL is discarded,
a full resync is required. Some customers have encountered disk exhaustion
when the connector was offline and WAL segments accumulated. The DBA should
monitor WAL retention closely during connector maintenance windows.

Polling-based database connectors define an incremental key: typically a
timestamp column like `updated_at` or a monotonic integer like `id`. The
connector tracks the high watermark of this column and queries only rows
where the incremental key exceeds the watermark since the last sync. If the
incremental key is a timestamp, the connector must handle clock skew between
the source database and the Atlas server, duplicates near the watermark
(rows updated at the same millisecond), and out-of-order updates. If the
incremental key is an integer, the connector works reliably but cannot detect
deletes because deleted rows leave no trace. Choosing the incremental key is
a customer decision that shapes sync performance, throughput, and data
fidelity. A timestamp column allows delete detection but requires tight clock
synchronization. An integer column guarantees consistency but requires an
explicit delete-tracking strategy.

Schema evolution on the source is a common operational headache. If a new
column is added to the source table, Atlas detects it at the next sync and
infers its type from the data (string, integer, boolean, or datetime) or
defaults to string if inference fails. If the source column type changes
incompatibly (integer to string, for instance), the destination schema may
become inconsistent with the source. The destination must be migrated or the
connector must drop and restart the sync from scratch, which can take hours
on large tables. Engineering provides detailed guidance on schema evolution in
the connector docs, but the customer owns the decision and bears the downtime
cost if a schema change requires a full resync. Some warehouse destinations
support schema-on-read and tolerate type mismatches, while others enforce
strict schema validation and fail the sync.

Type mapping between databases is non-obvious and often surprising to users.
A Verdant `uuid` column becomes a string at the destination because many
warehouses lack native UUID support. Verdant `json` and `jsonb` columns are
stored as strings in Parquet export formats or as nested structures in systems
that support nested types. Numeric precision can be lost if the source uses
arbitrary-precision decimals (Verdant `numeric` type) and the destination
does not support that precision. A sales engineer should advise customers to
validate type mappings in a test sync before rolling out to production. Some
type mismatches cause silent data loss, not errors, so validation is critical.
Timestamp and timezone handling varies across databases and can cause data
corruption if not handled carefully.

Warehouse destinations follow a different architectural pattern from sources.
The Auralake destination connector, ATL-WHS-02, uses staged bulk loading with
Auralake's native merge semantics to apply incremental changes efficiently.
Data is written to a temporary staging table, deduplicated by primary key, and
then merged into the target table using a SQL MERGE statement. This approach is
fast and cost-efficient because it batches writes and avoids row-by-row updates
or costly individual DELETE and INSERT statements. The destination schema must
have a defined primary key for the merge to work correctly. If no primary key is
specified, the connector raises an error at first sync and halts. Some warehouse
connectors support merge semantics and some do not; check the connector docs to
confirm before recommending it for incremental syncs.

Merge semantics handle three cases: inserts for new primary
keys, updates for existing keys where source data differs, and deletes for
keys present in the destination but not in the source. The merge operation is
atomic within Auralake, guaranteeing consistency even if other processes are
reading the table. Merge operations consume Auralake compute credits and can
be expensive on very large tables, so customers should monitor their merge
performance and adjust batch sizes if needed. A well-tuned merge can process
millions of rows per minute.

Warehouse connectors are write-only by design. They do not read from the
warehouse back to Atlas or to other sources. This means Atlas cannot use a
warehouse as a source in a chain of integrations; you must pull data from the
origin system or an intermediate CDC layer. The reasoning is that warehouses
are frequently joined with other data, redacted for privacy, or aggregated,
and re-ingesting warehouse data upstream would corrupt the data lineage and
create circular dependencies. Warehouses are optimized for analytical queries,
not for serving as a system of record.

Connection pooling and timeout management are critical for database connectors.
If the source database times out during a long-running query, the connector may
miss data. Connection pools should be sized appropriately for the number of
concurrent connector instances. The connector includes tunable timeout
parameters for query execution, connection acquisition, and idle connection
cleanup. Production deployments should test timeout settings under load before
going live.

Incremental loading at scale requires careful tuning and monitoring. If a
database source ingests millions of rows per day and the polling interval is
five minutes, each sync may process millions of changes and consume significant
warehouse ingestion credits and compute. The customer must choose between high
latency (longer polling intervals and reduced costs) and higher sync frequency
(tight polling and higher cost). CDC-based connectors allow much
tighter polling intervals because they only ship changed rows, not full table
scans. Performance benchmarking should be done before production rollout to
estimate costs and query times. Test syncs should be run against production-
scale data volumes.

Network connectivity between the source database and Atlas must be stable and
low-latency. A flaky network connection causes sync failures and data loss. The
connector includes exponential backoff and retry logic to handle transient
network failures, but persistent failures require intervention. Some customers
deploy Atlas connectors in the same network as the source database to minimize
latency and improve reliability. Network monitoring and alerting are critical
for production deployments.

Database authentication for connectors requires careful planning. The connector
needs a dedicated database user with appropriate permissions: SELECT on the
source tables for polling connectors, or REPLICATION permission for CDC
connectors. The credentials must be stored securely in the connector
configuration and never exposed in logs or backups. Password rotation policies
should be coordinated with the database team to avoid connector outages during
credential updates.

Performance tuning for large-scale database connectors is essential. If a
connector is processing millions of rows, query execution time and memory usage
become critical. The connector allows tuning of batch size, connection pool
size, query timeouts, and fetch sizes. A poorly tuned connector can exhaust
database resources and impact other applications. Testing with production-scale
data and monitoring resource usage during test syncs prevents surprises in
production.

Schema drift over time is a challenge for long-running connectors. If a source
schema evolves slowly, the connector must adapt without breaking the
destination. The connector includes schema tracking and change detection to
alert when the source schema changes. Customers can configure automatic schema
updates or manual approval workflows. For critical integrations, manual approval
is recommended.

The audit trail for database connectors should be maintained and monitored. All
connector actions should be logged and auditable. Some customers are required by
compliance policies to maintain detailed audit trails of all data access. The
connector provides structured logging that can be forwarded to a centralized log
aggregation system.

Disaster recovery and failover planning is essential for mission-critical
database integrations. If the primary source database becomes unavailable, the
connector should switch to a replica or backup. Some connectors support
automatic failover to a designated replica, while others require manual
failover coordination. Customers should test failover procedures regularly to
ensure they work correctly. A failed-over connector must resume from the
correct position to avoid data loss or duplication.

Testing database connectors at scale before production is crucial. Connectors
should be tested with production-size datasets and realistic network conditions.
A connector that works on small datasets may encounter performance issues or
bugs when scaling to millions of rows. Testing should include failure scenarios
like transient network outages, database restarts, and connection pool
exhaustion. Thorough testing prevents costly production incidents and ensures
the integration meets performance and reliability requirements before launch.

## SaaS and Application Connectors

SaaS connectors read from cloud applications like customer relationship
management platforms, ticketing systems, accounting software, marketing
automation systems, and project management tools. Every SaaS connector is API-
based and respects the vendor's published rate limits, which vary by
subscription tier and feature set. A connector that ignores or bypasses rate
limits will breach the SLA between Atlas and the vendor, risking account
suspension, rate limiting, or complete blacklisting of the API key. Most SaaS
APIs return a rate-limit header specifying requests remaining in the current
window and the time until the window resets. The connector logs these headers
and throttles requests accordingly, adding exponential backoff when limits are
exceeded. This keeps the source system healthy and prevents cascading failures.

The customer relationship management source connector, ATL-CRM-06, is the
most widely deployed connector in the Atlas catalog by a large margin. It
reads contacts, opportunities, activities, notes, and custom fields from a
leading CRM platform with millions of active business users. This connector is the
single most common trigger for support escalations related to rate limits. The
CRM vendor enforces a rate limit that is tiered by customer plan, ranging from
600 to 2,000 requests per minute depending on the subscription level. A large
customer with millions of records and frequent updates triggers the rate limit
within minutes, forcing a longer batch window or multiple sync jobs spread
across hours. The connector includes a backoff multiplier that the customer can
tune to slow down requests, but the underlying rate limit cannot be bypassed
without vendor approval. Customers migrating to Atlas from a competitor who
used the same CRM should validate that their rate-limit allocation is
sufficient before going live. Rate limit exhaustion is the number one cause of
sync failures for this connector.

Pagination is the second most common operational challenge in SaaS connectors.
SaaS APIs paginate results in different ways: some use an offset and limit,
some use a cursor that must be extracted from each response, some use a keyset
approach where the next page is identified by the last record's ID. The
connector abstracts pagination so that a customer does not have to think about
it internally. But if the underlying pagination logic changes between API
versions, the connector may fetch duplicate or missing records unexpectedly.
This is why API versioning is important. If the CRM vendor publishes a new API
version with different pagination or response structure, the connector may need
an update to stay compatible. The connector docs specify which API version is in
use, when the vendor plans to deprecate it, and when updates are expected.

Soft deletes are a third common pitfall that confuses many customers new to SaaS
integration. Some SaaS systems do not actually delete records; they mark them as
deleted, archived, or disabled. A connector must understand this semantic to
avoid syncing deleted records as live data into the warehouse or missing deletes
in the destination. The connector docs specify the soft-delete behavior for each
system. If the SaaS vendor changes their soft-delete implementation or API
response for deleted records, the connector may need to recalibrate to stay
accurate. Testing with the SaaS vendor's API documentation is essential.

Custom fields complicate schema inference significantly. A CRM record may have
ten standard fields (name, email, company, phone) and fifty customer-defined
fields (region, account tier, approval status, internal ID). The connector
discovers custom fields at sync time by introspecting the API and generates a
schema that includes them. If the customer later adds a new custom field in the
CRM UI, Atlas re-infers the schema at the next sync. The destination table must
support schema evolution or the sync will error and require manual
intervention. Customers using a schema-on-read warehouse like Auralake can
handle dynamic schema changes transparently. Customers using a strict schema
system must pre-plan the final schema or set up an alert to catch schema
mismatches before they cause silent data loss.

A major trap is the sandbox-versus-production environment difference. A CRM
typically offers a separate sandbox environment for testing integrations and API
calls. If a customer builds and tests an integration in the CRM sandbox, then
deploys it against production, the production environment may have a completely
different schema, different data retention policies, tighter rate limits, or
additional authentication requirements. Connectors should be tested against the
production environment before going live to catch these environmental surprises.
This is an operational discipline that the support team should reinforce during
onboarding. Never build against sandbox and assume production will be the same.

Support for custom authentication is limited by design. A connector supports the
vendor's standard auth flows (OAuth, API key, JWT token). If the customer has a
custom authentication gateway, a network proxy that modifies headers, or a
specialized identity provider, the connector may not work out of the box. The
sales and support teams should ask about network topology, authentication
requirements, and proxy usage early in the sales cycle and flag incompatibilities
before the customer signs a contract. Some customers require VPN tunneling or IP
allowlisting, which adds deployment complexity.

Incremental syncs in SaaS connectors rely on the vendor's update timestamps or
version numbers. If the SaaS vendor's API does not expose a reliable update
timestamp, the connector may not be able to detect incremental changes and must
perform full syncs. This impacts both performance and cost. Always verify that
the SaaS vendor exposes an update timestamp or version field before committing
to incremental sync strategies.

Testing SaaS connectors requires access to a vendor account with enough data to
validate sync behavior. Many vendors provide trial accounts or sandbox
environments for testing. Customers should request a trial account from the
vendor before committing to a large integration project. Some vendors charge for
API access, which may require a licensing discussion.

API version deprecation by the vendor is a constant challenge. If a SaaS vendor
deprecates an API version that a connector depends on, the connector must be
updated to use the new version. This can introduce breaking changes or new
behavior. Customers should be notified of API deprecations and given time to
plan connector upgrades. Some vendors provide long deprecation windows (one
year), others provide short windows (three months).

Data privacy and compliance requirements vary by industry and geography. Some
connectors must support encryption in transit and at rest. Some connectors must
comply with GDPR, HIPAA, or other regulations. Customers should verify that a
connector meets their compliance requirements before deploying it in production.
The connector docs specify any compliance certifications or limitations.

Handling of personally identifiable information in SaaS connectors requires
careful attention. Many SaaS sources contain sensitive data like email addresses,
phone numbers, or custom identifiers. Atlas does not filter or redact data at
the connector level, so customers must implement their own PII masking or
filtering in their destination warehouse. Some customers use column-level
encryption or data redaction policies in the warehouse to protect sensitive
data.

Webhook-based alternatives to polling connectors can provide near-real-time
ingestion for some SaaS systems. Instead of polling the API on a schedule, a
webhook pushes changes to Atlas whenever they occur. Webhooks reduce latency
from minutes to seconds but require the SaaS vendor to support webhooks and
require the customer to expose an ingestion endpoint. Not all SaaS systems
support webhooks, and webhook setup is more complex than polling connectors.

Connector retry and error handling policies vary by SaaS vendor behavior. Some
vendors return transient errors that should be retried, others return permanent
errors that indicate misconfiguration. The connector must distinguish between
these error types to avoid wasting API quota on retries of permanent failures.
The connector logs detailed error information to help customers debug issues.

Multi-tenant SaaS systems present additional complexity. A SaaS vendor may
provide access to multiple customer accounts within a single API. The connector
must support this by allowing the customer to specify which tenant or workspace
to ingest from. Some SaaS connectors support simultaneous syncs from multiple
tenants, while others only support one tenant at a time.

The connector marketplace provides recommendations for SaaS connectors based on
customer reviews and popularity. Customers can read detailed reviews from other
Northwind customers who have used a connector before deploying it. These reviews
often contain warnings about rate limits, pagination quirks, or data quality
issues that users have encountered.

Monitoring connector performance for SaaS integrations is critical. The
connector publishes metrics on API calls made, rows ingested, bytes transferred,
and sync duration. High API call counts indicate rate limit pressure. Long sync
durations indicate either a slow destination or API latency issues. Customers
should set up alerts on these metrics to catch problems early.

Handling of relationship data in SaaS connectors can be complex. Many SaaS
systems store data in related tables or objects, and the connector must decide
how to flatten or preserve these relationships. Some connectors support nested
data structures, while others flatten all data into a single table. Customers
should understand the connector's relationship handling strategy before
deploying it.

Connector failure recovery is built into the sync engine. If a sync fails
partway through, the next sync resumes from where it left off rather than
starting over. This saves time and API quota but requires the connector to
track state accurately. Some connectors use offset-based resume points, others
use timestamp-based watermarks. The choice affects performance and recovery
behavior.

Incremental backfill is a common use case where a customer wants to ingest a
large historical dataset from a SaaS source without taking a long time or
consuming too much API quota. The connector can be configured to paginate
through historical data in smaller chunks over multiple syncs, spreading the
load over hours or days. This requires coordination with the customer to ensure
the destination is not overwhelmed by partial data loads.

## File, Object Store and Streaming Connectors

File connectors read flat files in CSV, JSON, Parquet, or YAML formats from
local storage or cloud object stores. These connectors are typically used to
backfill initial data or to ingest periodic data dumps and exports from
systems that do not offer real-time APIs. They are not real-time data sources
and should not be expected to stream continuous updates or detect changes
within minutes. File connectors are ideal for batch-oriented workloads and
scheduled exports. They are commonly used for customer-provided data imports or
for ingesting reports exported from third-party systems on a schedule.

The object store source connector, ATL-OBJ-05, watches an Vaultstore bucket prefix for
new or modified files and ingests them into the warehouse. It uses a manifest
file stored in the same Vaultstore bucket to track which files have been processed,
avoiding duplicate processing and unnecessary re-ingestion costs. The manifest
is a simple JSON object listing processed files by key and their ETags (entity
tags). If a file is re-uploaded with the same key, the connector detects the
modification time change or ETag difference and re-ingests it. The connector
runs on a configurable schedule (hourly, daily, weekly) and is not triggered by
Vaultstore events, which keeps the connector stateless and avoids the complexity of
event-driven architectures. For use cases requiring immediate response to file
uploads or real-time ingestion, a file connector is not the right choice; a
streaming connector or webhook-based source is better.

The manifest file is a simple JSON object that the customer can inspect and
edit manually if needed. The customer can force a re-ingest by deleting or
modifying the manifest entry for a specific file. The manifest must be readable
and writable by the Atlas process, which means the Vaultstore bucket policy must grant
PutObject and GetObject permissions on the manifest key. If the manifest becomes
corrupted or accidentally deleted, the connector resets and re-ingests all files
from scratch, which can be expensive on large Vaultstore prefixes. The customer should
enable Vaultstore versioning and bucket locking to prevent accidental manifest deletion.
The manifest should be backed up regularly to a separate bucket or location.

File compression is supported transparently during ingestion. Gzip, Brotli, and
Zstandard compressed files are automatically decompressed during ingestion
without requiring special configuration. Large files are chunked internally to
manage memory usage and avoid overwhelming the Atlas process. The connector
imposes a maximum file size of 5 GB per file; files larger than 5 GB must be
split before upload using standard Vaultstore multipart tools. File format detection is
automatic based on file extension.

CSV parsing supports configurable delimiters, quote characters, and escape
sequences. JSON files can be newline-delimited JSON (NDJSON) or standard JSON
arrays. Parquet files are parsed with schema inference. YAML files are supported
for configuration data but are not recommended for large data volumes. The
connector infers the schema from a sample of the first file ingested and applies
that schema to all subsequent files. If files have inconsistent schemas, the
connector logs warnings and may truncate or skip fields that do not match.

File watching uses Vaultstore list operations, not Vaultstore notifications. This means there is
a delay between file upload and ingestion, typically a few minutes. For near-
real-time ingestion, use a streaming connector or webhook. The Vaultstore list
operation is billed to the customer's Cirrus account, so frequent checks add to
Cirrus costs. The connector batches list operations to minimize cost.

Streaming connectors connect to message brokers and event systems to ingest
continuous streams of data. The Torrent source connector, ATL-STRM-01, reads from
a Torrent topic using a consumer group and handles partition rebalancing
automatically. This is the standard production pattern for streaming systems at
scale. The connector tracks the committed offset in the Torrent broker and resumes
from that point if it is restarted, ensuring no messages are lost during
failover. Consumer group rebalancing is handled transparently by the Torrent
client library; multiple instances of the connector can run against the same
topic and consumer group simultaneously, and Torrent distributes partitions among
them automatically for horizontal scalability.

Torrent delivery semantics are at-least-once by design and by limitation of
distributed systems. The connector commits the offset to Torrent after
successfully writing the message to the destination. If the destination write
fails, the offset is not committed and the message is retried on the next
connector cycle. If the connector crashes between a successful destination write
and the offset commit, the message will be processed again on restart, resulting
in a duplicate in the destination. This is a fundamental limitation of
distributed systems without transactions across Torrent and the destination. The
connector does not participate in two-phase commit protocols.

This connector is the only connector in the Atlas catalog that
cannot guarantee exactly-once delivery to the destination under any
circumstances. All other connectors (database CDC, polling, file, SaaS) can be
configured or designed to deliver exactly-once semantics under normal
conditions through idempotency keys or transaction support. Streaming sources
are inherently at-least-once because a broker does not participate in the
destination transaction and cannot roll back. Customers using Torrent as a source
must be aware of this semantic limitation and handle duplicates in their
destination schema, application logic, or with an idempotency layer. A common
pattern is to use a primary key or unique constraint on the destination table to
detect and skip duplicates.

Ordering is preserved within a partition. If a topic has multiple partitions,
messages from different partitions are not guaranteed to be processed in global
order, but messages within a single partition are processed sequentially. A
customer who requires global ordering should design their Torrent topic with a
single partition, accepting the throughput cost. Ordering guarantees are per-
partition, not global. Keying messages by a business identifier helps maintain
order within a logical group.

Consumer group lag is visible in the connector metrics and dashboards. The lag
is the difference between the latest offset in the topic and the committed
offset of the consumer group. High lag indicates that the connector is falling
behind and not processing messages fast enough to keep up with the producer.
This can be caused by a slow destination database, network latency, a
misconfigured batch size, or an undersized connector instance with insufficient
resources. Monitoring lag in real time is essential for production deployments to
catch performance regressions early. Alert thresholds should be set based on
acceptable latency for the use case. A lag of zero indicates the connector is
fully caught up.

Backpressure and retry logic are configurable through connector settings. The
connector can be set to pause reading from Torrent if the destination is slow or
unreachable, preventing memory exhaustion and cascading failures. Retry logic
includes exponential backoff and a maximum retry count. After the maximum retries
are exceeded, the message is sent to a dead-letter queue (if configured) or
discarded with a warning log. Customers should define a dead-letter topic in
Torrent and monitor it actively for failures and data loss. Dead-letter messages
should be analyzed to identify patterns in failures.

Consumer group offsets are stored in Torrent's internal `__consumer_offsets`
topic. If a customer needs to reset the consumer group (to replay messages or
skip a range), the Torrent offset can be reset using the `torrent-consumer-groups`
CLI tool. Resets require the connector to be stopped and restarted. A reset
to the earliest offset replays all messages since the topic was created, which
can be expensive on long-lived topics with high throughput. A reset to the
latest offset skips all pending messages. Offset resets should be planned
carefully with the customer to avoid data loss or duplicate ingestion.

Torrent broker topology and replication factor matter for reliability. A Torrent
cluster with a replication factor of 1 is vulnerable to broker failures. A
replication factor of 3 is the standard for production systems. The connector
should connect to a stable Torrent cluster with adequate replication. Some
customers run Torrent on managed platforms or in cloud-hosted environments,
which handle replication automatically.

Message key strategies in Torrent affect ordering and partitioning. If messages
are keyed by a business identifier like customer ID, all messages for a
customer stay in the same partition and are processed sequentially. If messages
are sent with a null key, Torrent distributes them round-robin across
partitions, which parallelizes processing but loses ordering. The choice of
key strategy should be coordinated between the producer and the connector.

Schema evolution for streaming messages is a critical design consideration. If
the Torrent message format changes over time (new fields added, old fields
removed), the connector must handle both old and new formats gracefully. Some
customers use schema registries to manage message schemas and ensure
compatibility across evolving message formats. The connector can be configured
to validate messages against a schema before ingestion.

Backfill for streaming connectors is handled differently than for batch sources.
If a customer wants to backfill historical data from Torrent, the connector must
reset the consumer group offset to an earlier point and re-process messages. This
requires careful planning to avoid duplicates in the destination and coordinate
with ongoing real-time ingestion.

Performance tuning for streaming connectors involves adjusting batch size, batch
timeout, and parallelism. Larger batches reduce API calls and improve throughput
but increase latency. Smaller batches provide tighter latency but increase API
costs. The optimal batch size depends on the message volume, destination
throughput, and latency requirements. Customers should test with realistic
message volumes and patterns before production deployment.
