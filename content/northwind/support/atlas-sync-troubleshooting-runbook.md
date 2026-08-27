---
document_id: nw_support_atlas_runbook
title: Atlas Sync Troubleshooting Runbook
source_name: Northwind Support Atlas Sync Runbook
source_path: northwind/support/atlas-sync-troubleshooting-runbook.md
department: support
access_scope: department
allowed_roles: []
allowed_departments: [support, engineering]
version: "2.3"
effective_date: "2026-04-20"
---

# Atlas Sync Troubleshooting Runbook

## Scope and Prerequisites

This runbook covers customer-reported stalls in Atlas data
synchronization where the sync is not progressing at the
expected rate or has stopped entirely. It is designed for
support engineers responding to P1 and P2 severity tickets,
and provides a structured diagnostic path to identify root
cause and determine the appropriate response. The runbook
focuses on diagnosing whether an issue requires immediate
action, a scheduled restart, a throughput adjustment, or
simply waiting for a known-temporary condition to clear. It
does not cover provisioning new syncs, configuring source or
destination connectors from scratch, modifying source or
destination schemas, or building custom extraction logic.
For those topics, refer to the Atlas Provisioning Guide,
the Connector Setup Manual, and the Atlas Developer Reference
respectively.

Before following this runbook, you must have access to the
Northwind support portal, the customer's Atlas tenant
dashboard, and read-only access to the connector logs in the
support backend. You need an active P1 or P2 ticket opened
by the customer or by your team with clear reproduction steps
and a specific timestamp when the stall was first observed.
You must not modify any customer tenant configuration without
a ticket reference number visible in your change record. This
applies to every setting: sync parameters, connector
credentials, pipeline schedules, checkpoint overrides, and
ACL rules. The only exception is toggling sync pause or
resume, which does not alter configuration and requires only
the ticket number in a comment on the ticket thread. All
configuration changes must be documented with ticket ID,
timestamp, reason for change, your username, and approval
status before submission. This audit trail protects both the
customer and Northwind in the event of a post-change issue.

Escalation to engineering follows specific thresholds covered
in this runbook's final section and must align with the
Support SLA Policy and the Incident Escalation Matrix. Do not
wait on a customer decision if you can reproduce the problem
in a test environment without involving their data. If the
sync was working correctly before a specific date, check the
Atlas changelog and the customer's recent connector or
destination version updates. Note any firewall, network, or
DNS changes the customer made near the time the stall began.
Clock skew between Atlas and the destination can cause silent
stalls in some backends, particularly those using OAuth or
JWT-based authentication. Verify the timezone and time offset
of the customer's destination environment against Northwind's
production servers (use the NTP endpoint published in the
Atlas documentation portal). If you find evidence of a time
mismatch greater than 10 seconds, record it in the ticket
before contacting support engineering. Do not attempt to
adjust the customer's system time yourself. Coordinate with
their infrastructure team for any time changes.

This runbook assumes the customer's network connectivity to
both source and destination is stable and that Atlas itself
has not been the subject of a recent major outage (check the
Atlas Status page before beginning diagnosis). If an Atlas
outage is ongoing, inform the customer of the incident number
and resume diagnosis once the outage is resolved. If the
customer is using custom extractors, transformers, or
destination-side validation logic, some diagnostic steps may
require engineering review of that custom code. This runbook
does not cover debugging custom code; escalate those cases
directly to engineering.

## Diagnosing a Stalled Sync

Begin by confirming the symptom with the customer. A stalled
sync differs fundamentally from a slow sync. Stalled means no
data has moved for more than the configured batch window, or
the customer explicitly states the pipeline has halted and
they can confirm their source has new data available. A slow
sync can still be progressing normally and advancing its
checkpoint, and addressing it requires the throughput tuning
section below, not this section. Ask the customer exactly
when they last saw data arrive in the destination, and record
the exact date and time in 24-hour UTC format. Verify this
observation by querying the destination database directly if
you have access. Check the Atlas tenant dashboard for the
sync's last reported activity timestamp. If the dashboard
timestamp matches the customer's observation, the sync is
genuinely stalled. If the dashboard shows activity after the
customer's report, the issue is likely slow throughput rather
than a complete halt.

Once you have confirmed a stall, pull the sync's pipeline
state from the Atlas tenant. Navigate to the Syncs tab in the
customer's dashboard, select the stalled sync by name or ID,
and open the Pipeline State panel. Record the status enum:
Active, Paused, Error, Draining, or Pending. Each status
carries different implications for diagnosis. If the status is
Paused, check the pause reason. Pause can be triggered
manually by the customer or by an automatic guard that fires
on repeated source errors or when the destination becomes
unreachable. Manual pauses are recorded with a timestamp and
the name of who requested it. If the sync is paused
automatically, skip directly to the source and destination
sections below. If paused manually, contact the customer
immediately to confirm they intended the pause and that it is
not the result of a misconfiguration or a support person's
error. Resume the sync only with their explicit permission
and with a ticket reference.

If the status is Error, read the error message in full
without truncation or summarization. The error field in the
pipeline state carries specific, actionable details that are
essential to diagnosis. Common errors reference authentication
failures (handled in the Connector Authentication Failures
section), destination schema mismatches (schema validation
failure), source query timeouts, network timeouts, or data
type mismatches. Copy the full error text verbatim into the
ticket thread so engineering can review your diagnosis and
provide informed guidance. Do not attempt to fix the
underlying cause at this stage; your job is to surface the
error, not resolve it. If the error message is truncated in
the dashboard UI, open the raw API response using the
tenant's API endpoint to retrieve the full error text. Include
the API response in your escalation.

Check the sync's checkpoint. The checkpoint is the source
record ID or timestamp at which the sync last successfully
committed a batch to the destination. Open the Checkpoint
panel in the dashboard. The checkpoint shows the last
successfully committed batch ID or the highest watermark
timestamp from the source system, depending on the source's
extraction mode. Compare this to the current high watermark
in the source system. If the checkpoint is very recent
(within the last five to ten minutes) and the customer
reports data is available in the source beyond that point,
the sync may simply be catching up and processing batches at
normal rate. This is not a stall; it is expected throughput
behavior. If the checkpoint has not advanced in several hours
or longer and the source contains data beyond the checkpoint,
proceed to the next step of diagnosis.

Inspect the sync's batch window setting closely. This
parameter, atlas.sync.batch_window_ms, controls the
maximum duration a batch of records can remain open in the
pipeline before being committed to the destination. The
default value is 900000 milliseconds, which is 15 minutes. If
this setting has been changed to a very high value (for
example, 3600000 milliseconds for one hour or 7200000
milliseconds for two hours), the sync may appear stalled
because the pipeline is holding the batch waiting for the
window to close. Ask the customer whether they recently
modified this setting and why. If they did, and if batches
are arriving in the destination at the window interval
(e.g., every 15 minutes or every hour), the sync is working
as configured. This is throughput behavior, not a stall. If
they did not change the setting, and batches are still not
arriving at all, proceed to the source and destination
diagnostics below.

Verify connectivity to the source system. Many stalls result
from source unavailability or network partitions. In the
tenant dashboard, navigate to the Connector Health section.
Check the source connection status. A green light indicates
the connector established a connection within the last five
minutes. A yellow light indicates the last connection attempt
succeeded, but the connector cannot verify health in real
time, which is normal for some source types and does not
always indicate a problem. A red light means the connector
cannot reach the source, which is a critical indicator. If
the indicator is red, record the exact timestamp and attempt
to contact the customer's source system maintainer or
database administrator. Ask whether the source is experiencing
planned maintenance, recent network changes, or firewall rule
updates. Many connectivity stalls resolve within minutes or
hours once the source is reachable again. Request that the
customer verify their source is online and accepting
connections.

If the source is reachable according to the health check,
examine the source query performance. Every Atlas sync
includes a configured query or extraction mode that defines
which data to sync and in what order. Some syncs use a SELECT
query with a WHERE clause, others use change data capture
(CDC), and others use full-table exports. Open the Connector
Details panel and confirm the extraction mode. If the mode is
a SELECT query, ask the customer to execute that query
against their source database directly and measure its
runtime. If the query takes longer than the configured batch
timeout (typically five to ten minutes by default, set per
sync), the sync will time out and the pipeline will report an
error. Query optimization is outside support's scope; escalate
to engineering with the query text, its execution plan from
the source's query optimizer, and performance metrics. Do not
share the query text if it contains credentials or sensitive
business logic without the customer's explicit permission.

Verify the destination is reachable and accepting writes.
Navigate to the Destination Health panel in the dashboard.
Check the connection status the same way you checked the
source. A red light indicates the destination is unreachable
or not accepting connections. Verify with the customer that
their destination cluster, warehouse, or database is online,
that firewall rules permit inbound connections from Atlas's
IP ranges (published in the Atlas documentation portal), and
that the destination credentials have not expired. Some
destinations require periodically refreshing authentication
tokens on a schedule set by the vendor. If credentials have
expired, that problem is handled under the Connector
Authentication Failures section. For now, assume connectivity
is the problem. Ask the customer to verify connectivity from
their own local network to the destination, then ask them to
check any WAF, network access logs, or database audit logs
for blocked connections from Atlas IP ranges. Have them
provide those logs to support for review.

Determine whether to wait, restart, or drain the pipeline
based on your findings. If the source is reachable according
to the health check and the destination is reachable, but the
checkpoint is not advancing, and no error is reported in the
pipeline state, the sync may be stuck in a transient
condition such as a temporary resource constraint or a slow
query. Wait for 15 minutes and check again. If the checkpoint
advances within 15 minutes, close the ticket and document the
resolution as "transient stall, resolved after timeout." If
the checkpoint still has not advanced and you can reproduce
the issue in your test environment, escalate to engineering.
If the source has a connectivity issue, guide the customer to
restore connectivity, then verify the sync resumes within five
minutes. If the destination has a connectivity or credential
issue, guide the customer to fix it, then verify the sync
resumes. If the issue involves a fundamental configuration
error or a possible bug in the sync logic, escalate. Reference
RB-ATL-07 in your escalation ticket so the engineering team
can cross-reference this runbook and understand which
diagnostic path you followed.

A worked example with a Verdant relational source: The
customer reports that their sync from a Verdant database to
Auralake warehouse has not moved data for two hours. You
check the dashboard and see the pipeline status is Active, no
error is reported, and the checkpoint is stuck at record ID
500,000. The source contains 5 million records. The batch
window is set to the default 900,000 milliseconds. You check
the Verdant connector health and see yellow status, meaning
the last test succeeded but real-time health is unavailable
(normal for Verdant). You ask the customer if their Verdant
database is online, and they confirm it is and currently
processing transactions. You run the sync's configured query
against Verdant directly and it completes in 8 seconds. You
check the destination (Auralake) and it shows green status.
You wait 15 minutes and check again; the checkpoint is now at
record 501,000. You close the ticket as a transient stall
resolved after timeout.

A worked example with a Torrent stream source: The customer
reports their Torrent stream to Auralake sync is stalled. The
pipeline status is Error and the message reads "connection
refused: broker unreachable". You check the Connector Details
and confirm the sync is configured to use CDC mode from a
Torrent stream. You ask the customer if their Torrent cluster
is online. They confirm it is. You ask if they made any
firewall changes recently, and they mention they migrated the
Torrent cluster to a new VPC yesterday. You advise them to
verify that the new VPC has a security group rule permitting
inbound connections on port 9092 from Atlas's IP range. They
check and find the rule is missing. After they add the rule,
the sync resumes within two minutes and the checkpoint
advances. You document the resolution as "network connectivity
after infrastructure change."

Three common mistakes in diagnosis: First, assuming a slow
sync is a stalled sync. Always check the checkpoint; if it is
advancing even slowly, the sync is working. Second, not
waiting long enough for transient conditions to clear. Some
issues resolve on their own within minutes or hours. A
15-minute wait is a standard diagnostic step before
escalation. Third, failing to check the batch window setting.
A very high batch window can make a working sync look stalled
for hours at a time. Always verify this setting against the
customer's expectations.

Additional diagnostic considerations: If the customer reports
that the sync begins moving data after a period of inactivity,
this pattern often indicates a scale issue where the system
needed time to recover resources or clear backlog. Document
the exact times the stall started and resolved. If the sync
has never moved data (brand new sync), the issue may be an
initial extraction that is taking longer than expected. A new
sync pulling millions of records from the source for the
first time may take hours or days. Check with the customer
whether this is the initial load; if so, advise them that
initial syncs can be very slow and to check back after 24
hours if nothing has moved. If data is still not flowing
after an initial sync period of 24 hours or more, escalate to
engineering. For existing syncs that suddenly stopped, the
pattern matters: did they stop during normal hours or after a
maintenance window? Did they stop after a source or
destination update? These patterns help narrow the cause.

## Connector Authentication Failures

Authentication failures cause syncs to stall silently in some
cases and loudly (with an error in the pipeline state) in
others. The most common failures are expired credentials,
rotated secrets, revoked permissions, clock skew between the
source and Atlas servers, and scope changes in OAuth
integrations. Each requires a different diagnosis and remedy.
Support engineers must never ask a customer to share their
actual secret (API key, password, database password,
connection string, OAuth refresh token, certificate key
material, etc.). The support team never handles customer
secrets directly. This policy protects both the customer's
security and Northwind's compliance posture.

Start by checking whether the pipeline state shows an
authentication error. Open the Pipeline State panel and read
the error message in full. If the error contains keywords like
"authentication failed", "invalid credentials", "401
Unauthorized", "403 Forbidden", or "access denied", the
customer's source or destination credentials have likely
expired, been revoked, or are otherwise invalid. Do not ask
the customer to reveal the actual secret. Instead, use the
Test Connection button to confirm an authentication problem
without handling the secret directly. Never ask for the
secret in a ticket, email, or support call.

Open the Connector Details panel in the customer's Atlas
dashboard. Locate the Test Connection button for the source
connector. Press it. If the test fails with an authentication
error and the customer confirms they did not recently rotate
credentials, ask them to check whether their source
system's password policy or API key management system
automatically rotated keys on a scheduled basis. This is
common in some cloud databases, identity providers, and
secrets management systems. If the customer confirms a recent
automatic rotation, they must coordinate with their system
administrator to retrieve the new credential value. Instruct
the customer to update the credential in the connector
configuration via the Connector Details panel in Atlas, not
to share it directly with support. Once the customer has
updated the credential, they should press Test Connection
again to verify. Once the test succeeds, the sync should
resume automatically within five minutes. If it does not
resume, check whether the sync is paused. If it is paused,
resume it with the customer's permission.

If the Test Connection button succeeds, but the sync is still
stalled, the problem may be a permission revocation rather
than an authentication credential issue. Some data sources
support fine-grained access control (for example, Cirrus IAM,
Nimbus RBAC, database-level grants, or table-level
permissions). The customer's source system may have revoked
Atlas's access to specific tables, schemas, views, or actions
after the connector was configured, or a recent security
audit may have tightened permissions. Ask the customer to
verify that Atlas's connector service account or API
principal still has SELECT permission on the tables the sync
is configured to read. If permission has been revoked,
coordinate with their administrator to restore it. Once
restored, the sync should resume automatically.

Clock skew can cause authentication failures that are
extremely difficult to diagnose because the error messages are
often vague. Some source systems and OAuth providers enforce
strict time windows for token validity. If the clock on
Atlas's servers is more than a few seconds ahead of or behind
the customer's source, token validation may fail. This is most
common with OAuth2 flows and sources that use signed JWTs.
Ask the customer to check the system time on their source
servers and compare it to the public NTP standard
(pool.ntp.org). Also ask them to check the time on any
gateway, load balancer, or cloud infrastructure between their
source and Atlas. If the time differs by more than 10
seconds, ask their infrastructure team to resync the clocks
using NTP. Once resync completes, the sync should resume
automatically.

For sources that use OAuth2 refresh tokens, the credential
refresh process can fail transiently if the identity provider
is temporarily slow or unavailable. Atlas retains stale tokens
for a grace period while a refresh is in flight. The
connector parameter atlas.connector.token_refresh_grace_seconds
controls this window. The default value is 120 seconds. This
means if a token refresh request to the identity provider
takes up to 120 seconds to complete, Atlas will continue
using the old token instead of rejecting the request
immediately. If the identity provider is very slow or
overloaded, the token refresh may exceed this grace period,
and subsequent sync operations will fail with a "token
refresh timeout" error. Exceeding the grace period is rare.
You can confirm it by checking the Connector Details panel
and logs for a "token refresh timeout" error message. If you
see this error, ask the customer to contact their identity
provider's support team about slow refresh latency on their
end. In the meantime, the sync is stalled and requires
escalation to engineering for potential investigation or
grace period adjustment.

If the customer recently updated their source system (for
example, a database major version upgrade, a TLS library
update, or a security patch), the source may have changed its
authentication protocol or required certificate chain. Some
sources enforce newer TLS versions and reject weak cipher
suites. Ask the customer what updates they made and when.
Cross-reference those updates against the source system's
release notes for authentication or security changes. If the
source now requires TLS 1.3 but the connector is using TLS
1.2, for example, the connection will fail silently or with a
vague "connection refused" error. Escalate to engineering
with details of the source's authentication protocol changes
and version information.

Scope changes in OAuth integrations are a common but often
overlooked failure mode. If the customer reconfigured their
OAuth application in their identity provider (for example,
Sentri) to restrict scopes or change permissions, the
connector may no longer have the scopes required to access
the source. The connector typically requests scopes like
"read:accounts", "read:data", or "sync:read" depending on the
source type. If the identity provider revokes or restricts
these scopes, the connector will be unable to refresh tokens
or access the source. Ask the customer to check their
identity provider's OAuth application configuration and
verify that all required scopes are still granted to the Atlas
connector application. If scopes have been restricted, they
must be restored. The exact scopes required are listed in the
Connector Details panel.

Advanced authentication issues: If a customer uses
certificate-based authentication (for example, mutual TLS
with Verdant), ask whether the certificate has expired or
been rotated recently. Expired certificates cause connection
failures that look similar to authentication failures. Ask the
customer to check the certificate's validity dates using
their certificate management tools. If expired, they must
install a new certificate and update the connector
configuration. If recently rotated, verify the new
certificate's fingerprint or CN (Common Name) matches what
the connector is configured to expect.

For customers using API key rotation on a schedule, establish
a rotation process with them: they should rotate keys in
advance of the rotation date, update the connector to use the
new key, and only then retire the old key. This prevents
stalls. Some customers use secrets management systems like
Vaultstore to manage rotation automatically. If a customer
uses such a system, ask them to verify the Vaultstore API is
reachable from Atlas and that the policy authenticating
Atlas's access is still active.

Never ask the customer to paste their API key, password,
database password, or OAuth token into a ticket or support
call. If the customer offers to share this information, refuse
firmly and politely. Explain that support engineers do not
handle customer secrets and that no Northwind system stores
plain-text credentials. Direct the customer to update the
credential in their Atlas tenant dashboard via the Connector
Details panel using a secure browser session on their own
network. If the customer cannot update the credential
themselves, ask them to coordinate with their identity
provider or source system administrator to rotate or restore
the credential. This protects both the customer's security
and Northwind's compliance posture. Document this in every
auth escalation.

Testing strategy for auth issues: When a customer reports a
stall and you suspect authentication, follow this sequence:
(1) Check the pipeline error message for auth keywords. (2)
Use Test Connection button if available. (3) Ask the customer
to check credential rotation policies in their source system.
(4) Ask the customer to verify identity provider availability
and clock skew. (5) Ask the customer to check OAuth scope
configuration. (6) Only if all of these checks do not explain
the issue, escalate to engineering with details of what you
tested and what you ruled out. This sequence prevents most
auth-related escalations from reaching engineering and speeds
up those that must be escalated because the engineering team
knows exactly what the support engineer already verified.

Multi-factor authentication complications: Some customers use
multi-factor authentication (MFA) on their source or identity
provider. MFA does not typically affect Atlas connector
authentication because connectors use service account
credentials or API keys that bypass MFA. However, if a
customer reconfigured their identity provider to require MFA
for all application access, including service accounts, the
connector may fail with an authentication error. Ask the
customer whether they have enabled MFA policies that apply to
API clients. If so, coordinate with their identity provider
to create an exception for Atlas's service account or to use a
special MFA bypass token. This is an advanced configuration
issue and may require escalation to engineering.

Connection string and credential parsing: Some customers
accidentally include extra parameters in their connection
string or paste credentials with leading or trailing
whitespace. These errors cause authentication failures that
are difficult to spot. Ask the customer to verify their
credential configuration has no extra spaces, no double
quotes, no line breaks, and no special characters that might
confuse the parser. For database connections, verify the
host, port, database name, and username are all correct and
match the actual source configuration. A single typo in the
hostname or database name will cause the connection to fail.
If the customer is not sure whether their configuration is
correct, ask them to test the connection string or API
credentials against the source system using a command-line
tool or the source vendor's own testing tool. This provides
independent verification that the credentials work. If they
work outside Atlas, the problem is likely in the connector
configuration rather than the credentials themselves.

## Throughput and Backpressure Tuning

A sync can be progressing normally and advancing its
checkpoint yet still look stalled to a customer who expects
faster throughput. If you have confirmed that the checkpoint
is advancing (the Checkpoint panel shows a timestamp or record
ID that has increased in the last few minutes), and no errors
are reported in the pipeline state, the sync is working
correctly. What looks like a stall is actually throughput
lower than the customer's expectation or historical baseline.
This section describes why throughput varies, how to measure
real throughput, and which tuning parameters are safe for
support to adjust without engineering approval.

Atlas pipelines move data in batches. Each batch is pulled
from the source, validated, transformed (if the sync includes
a mapping), and written to the destination. Batches are not
instantaneous; they require time. The time required for a
batch depends on the batch size (number of records per batch),
the complexity of any transformations or validation rules,
the destination database's write performance, and network
latency between Atlas and the destination. If the destination
database is slow at writes, the sync will appear slow. This is
not a bug in Atlas; it is a constraint of the destination. If
a customer's Auralake warehouse can process only 100 rows per
second, the sync will never exceed that throughput. Improving
throughput in this case requires optimizing the destination's
write performance, which is outside Atlas's scope.

Backpressure is a flow-control mechanism that prevents the
source from being overwhelmed. When the destination is slow
to write batches, Atlas slows down the rate at which it pulls
data from the source. This prevents the source from being
overloaded and allows the destination time to catch up.
Backpressure propagates backward through the pipeline. If the
destination is writing 10 records per second, the sync will
pull roughly 10 records per second from the source (minus a
small buffer for batching). If the destination suddenly
becomes faster (for example, you add more write replicas or
optimize an index), backpressure decreases, and the sync will
pull faster. The customer should see the throughput increase
automatically within one or two batch cycles, typically within
minutes.

Conversely, if the destination is writing very slowly or if
the source has just released a large new batch of records and
the destination is overwhelmed, backpressure will cause the
sync to appear stalled from the customer's perspective. They
see no activity in the destination because batches are queued
in memory waiting for the destination to process the previous
batch. This is normal and expected behavior. Instructing the
customer to "make the destination faster" is usually the only
solution, but some tuning parameters exist for support to
safely adjust before escalating to engineering.

The parameter atlas.sync.max_inflight_batches controls the
maximum number of batches that can be in flight (pulled from
the source but not yet committed to the destination) at any
given time. The default value is 4 batches. The hard maximum
is 16 batches. If you increase this to a higher value, more
batches can be queued at once, which can increase throughput
in some scenarios by allowing the pipeline to pull ahead of
the destination slightly. However, higher values also increase
memory usage in the Atlas connector process and increase the
database connection pool load on the destination. Setting this
parameter is safe for support to adjust without engineering
approval. Increase it by 2 or 3 (so 6 or 7 total) and monitor
the sync for 5 to 10 minutes. If throughput increases and the
customer is satisfied, close the ticket and document the
setting change with the ticket number. If throughput does not
improve, revert the change to the default. Do not exceed 16
under any circumstances. Higher values can destabilize the
connector and exhaust resources.

To measure real throughput, use the Metrics tab in the
dashboard. Record the checkpoint timestamp from 10 minutes
ago and the current checkpoint timestamp. Subtract the old
timestamp from the new timestamp to get the change in records
pulled. Divide by 10 to get records per minute. Most syncs
should sustain at least 100 records per minute on reasonable
hardware. If throughput is lower, proceed to tuning. A worked
capacity calculation: A customer reports their sync from
Verdant to Auralake is processing at 50 records per minute
but they expect 200 records per minute. You measure and
confirm 50 records per minute. You ask if they have set
max_inflight_batches. They confirm it is at the default of
4. You ask them to increase it to 6, monitor for 10 minutes,
and report back. After the change, throughput increases to
120 records per minute. The customer is satisfied. You
document the change and close the ticket.

Batch size affects throughput significantly. Larger batches
mean fewer round trips between the source and destination,
which can improve throughput. However, larger batches consume
more memory in the pipeline and are slower to validate and
commit. Batch size is configured per sync and is hidden in
the advanced settings. Most customers do not adjust this. If a
customer has an exceptionally slow sync despite a reachable
and responsive destination, ask them to check their sync's
advanced configuration and report the batch size setting. If
it is unusually small (for example, 100 records per batch
when the sync has millions of records), suggest increasing it
to 1000 or 5000. Batch size changes require a sync restart
and do require engineering approval if the change affects
other running syncs or if the new batch size is large. Guide
the customer to contact support@northwind.example with the
sync ID and the proposed batch size.

Network latency between the connector and the destination
affects throughput significantly. If the connector is
deployed in us-east and the destination is in eu-west, or if
the customer's network has high latency (for example, because
they are using a VPN with poor performance), batches take
longer to commit, and throughput decreases proportionally.
This is a network constraint, not a tuning opportunity. Ask
the customer to measure the latency between their network and
the destination using a ping or traceroute tool. If latency
is very high (more than 200 milliseconds round trip), suggest
moving the destination closer to the connector, using a CDN
or edge endpoint if available, or reducing VPN overhead. This
requires customer action, not support action.

Destination write mode affects throughput drastically. Some
destinations support batch inserts (many rows per SQL
statement), others require row-by-row inserts. Batch inserts
are dramatically faster, often 10 to 100 times faster. Ask
the customer whether their destination can be configured to
accept batch inserts or bulk load operations. If they are
uncertain, escalate to engineering with the destination type
and version. Some destinations like Auralake support bulk
inserts by default; others require specific configuration.

Some sources have query timeout or fetch size limits that
constrain throughput. If the source is pulling data very
slowly (for example, taking 30 minutes to fetch a batch of
1000 records), check the source query or extraction
configuration. Ask the customer to consult their source
vendor's documentation for performance tuning. This is outside
support's scope unless the customer explicitly asks for help
reading the documentation.

Three tuning changes that most often make things worse:
First, setting max_inflight_batches too high (above 10 for
most workloads) causes memory exhaustion and database
connection pool exhaustion. Second, reducing batch size below
100 records causes excessive network overhead. Third, changing
the batch window to be very small (below 60000 milliseconds)
causes the destination to be overwhelmed by frequent small
writes. Always revert these changes and escalate to
engineering if they do not improve throughput within 10
minutes.

Monitoring throughput over time: Ask the customer to share
their throughput baseline from when the sync was working well.
Compare current throughput to baseline. If throughput has
dropped by more than 20 percent, this suggests a change in
the system (destination became slower, source became slower,
network latency increased, or a tuning change was made).
Investigate what changed. If throughput has held steady at a
lower level than the customer expects, the sync may have
always been this slow due to system constraints. In that case,
tuning or scaling is needed, not troubleshooting.

Connection pool exhaustion on the destination: If a customer
reports their destination database is becoming unresponsive
or rejecting new connections when the sync runs, this
indicates the sync is using too many database connections.
The parameter atlas.sync.max_inflight_batches contributes to
this because each batch in flight typically holds one database
connection. If the destination's connection pool has only 20
connections available and the sync uses 8 (due to
max_inflight_batches being 8), only 12 connections remain for
other applications. Ask the customer to increase their
destination's connection pool size or decrease
max_inflight_batches back to 4. This is a capacity issue, not
a bug.

Source read performance tuning: If the source is the
bottleneck (it is not providing data to the sync quickly
enough), ask the customer to check whether their source has
sufficient query performance. For Verdant databases, suggest
adding an index on the columns used in the extraction query's
WHERE clause. For Torrent streams, suggest tuning the
broker's fetch.max.bytes configuration to allow larger
batches. For Relay systems, suggest verifying the API rate
limits are not being exceeded. These changes are
source-specific and require customer action or coordination
with their source system team.

Transformation complexity: If the sync includes
transformations (mapping fields, renaming columns, applying
functions), these add processing time to each batch. Complex
transformations with many rules can significantly slow
throughput. Ask the customer to review their transformation
rules and remove any that are redundant or unnecessary.
Simplifying transformations can improve throughput by 10 to
30 percent in some cases. If transformations cannot be
simplified, this is a constraint and tuning
max_inflight_batches may help by allowing more batches to
progress in parallel while transformations are being applied.

Monitoring tools and metrics: The Atlas dashboard provides
real-time throughput metrics in the Metrics tab. However, if
you need to measure throughput over longer periods (hours or
days) to identify patterns, ask the customer to export
checkpoint data and create a graph of checkpoint progress over
time. A graph showing a steady linear increase means the sync
is working at constant throughput and there is no problem. A
graph showing sudden drops or plateaus can reveal when
problems started and help correlate with customer system
changes. Offer to help the customer set up alerting if they do
not have it. Many destinations (like Auralake) support
alerting on write latency or query performance.

Destination-specific tuning: Auralake warehouse (the
destination type most commonly used with Atlas) supports
clustering and indexing strategies that affect write
performance. Ask customers using Auralake to check whether
their tables are clustered on the foreign key or join column
that will be used most often. Proper clustering can improve
write performance and reduce contention. Conversely,
over-clustering can make writes slower. This is destination
expertise, not Atlas expertise. Escalate to engineering if the
customer needs guidance on Auralake performance tuning.

## When to Escalate

Not every stalled or slow sync requires engineering
escalation. Use the thresholds below to decide when to hand
off the ticket to engineering and what information to include
in the handoff. Escalation decisions must align with the
Support SLA Policy and the Incident Escalation Matrix.

Escalate immediately to engineering and page the on-call
engineer if the stall affects a production data pipeline that
customers depend on to make critical business decisions, and
the stall has persisted for more than 30 minutes despite your
diagnostics and customer remediation efforts. Also escalate
immediately if the error message suggests a data integrity
issue, such as "checkpoint corruption", "transaction
rollback", "integrity constraint violation", or "duplicate
key error". These indicate a possible bug in Atlas or a
serious underlying system failure, not a configuration or
credential issue.

Escalate to engineering within one business hour (so before
18:00 CT on business days, or before the next business day
at 08:00 CT if the escalation occurs after hours) if:

- The sync has been stalled for more than 4 hours, and you
  have confirmed source and destination are reachable,
  credentials are valid, the batch window is reasonable, and
  no error is reported in the pipeline state. This suggests a
  logic bug in the pipeline orchestration.

- The connector reports a repeated timeout error on the
  source query and the query is not exceptionally complex
  (fewer than 5 joins, no recursive CTEs). This suggests a
  performance regression in the source or the connector's
  query optimization.

- The customer reports that the sync was working correctly
  until a specific date, and the date correlates with an Atlas
  product update listed in the Atlas changelog. Possible
  regressions should be escalated quickly to engineering.

- Authentication passes the Test Connection check, but the
  sync still fails with an authentication error on live data.
  This indicates a permissions or OAuth scope mismatch.

- The sync processes some batches successfully but fails on
  others with an error that varies batch to batch (for
  example, "constraint violation on row 7 of batch 42"). This
  suggests data-dependent logic bugs.

Do not escalate based on slow throughput alone. Throughput
can vary widely depending on source and destination
configurations, customer network quality, batch sizes,
transformation logic, and workload. Escalate throughput
issues only if you have tried the tuning steps in the
previous section and the customer is still not satisfied, or
if the throughput has suddenly dropped from a historical
baseline and cannot be explained by destination performance
changes or known network issues.

When you escalate, include the following in the ticket
summary or handoff note to engineering:

1. The sync's unique ID from the Atlas dashboard.

2. The exact timestamp when the stall began, according to the
   Checkpoint panel.

3. The full error message from the Pipeline State panel, if
   one is present. Do not summarize; paste it verbatim.

4. The source type (e.g., Verdant, Torrent, Relay, Cirrus)
   and version.

5. The destination type (e.g., Auralake) and version.

6. The checkpoint state: the last committed record ID or
   watermark timestamp.

7. The results of your connectivity tests. Include whether
   the source is reachable, whether the destination is
   reachable, and whether any network or firewall issues were
   found.

8. Any customer configuration changes that occurred near the
   time the stall began, including sync parameters,
   credentials, connectors, or infrastructure changes.

9. Whether this is a new sync or an existing sync that was
   working before the stall.

10. The sync's extraction mode (SELECT query, CDC,
    full-table export, API poll). If a SELECT query, paste
    the query if the customer consents (they may have data in
    it that is sensitive; ask permission first).

Reference the relevant runbook section in the handoff if your
diagnosis pointed to a specific area (for example,
"authentication failure per Connector Authentication
Failures section" or "throughput tuning attempted per
Throughput and Backpressure Tuning section"). This helps
engineering understand your reasoning and can speed up the
investigation significantly.

If the escalation is urgent (affecting production for more
than an hour), page the on-call engineer. The on-call rotation
follows the weekly schedule published in the support
dashboard. Mark the ticket as P0 or P1 severity (ask your
support manager if you are unsure of the classification).
On-call engineers are guaranteed a response within 15 minutes
during business hours and 30 minutes outside business hours
per the Support SLA Policy. Provide them the complete handoff
information listed above plus any additional context they may
need.

Document escalations that involve data integrity concerns
(checkpoint corruption, transaction failures, constraint
violations, data loss). These may indicate a systemic bug in
Atlas or the customer's infrastructure. If this escalation
succeeds in resolving the issue, coordinate with engineering
to identify root cause. If root cause is confirmed as an
Atlas bug, the engineering team may trigger a postmortem.
Reference INC-8842 as a worked example. That incident
involved a multi-tenant checkpoint corruption bug that
affected five customer syncs simultaneously. The issue was
elevated to SEV-2 severity (30-minute response target,
24-hour resolution target) and resulted in a postmortem and a
product fix deployed within one week. When you encounter
similar issues, prepare to share detailed reproduction steps
so engineering can prioritize accordingly.

For escalations that may need repeatable test cases, offer to
help the customer set up a test environment where the problem
can be safely reproduced without involving production data. A
reproducible case greatly accelerates engineering's
investigation and increases the likelihood of a prompt
resolution. Test environments can use sample data from the
source or synthetic data that mimics the customer's
production schema. Ensure the customer understands that any
test should follow the same sync configuration as the
production sync that is failing.

Follow-up after escalation: After you hand off to engineering,
do not close the ticket. Leave it open and monitor for
engineering response. If no response is received within 15
minutes (P0) or 1 hour (P1), check the support dashboard to
see if the ticket was assigned. If not assigned, ping the
on-call engineer or escalation routing system. The customer is
waiting; keep them informed of progress. At minimum, reply to
the customer every 4 business hours with a status update even
if you do not have a fix yet. If engineering provides a
workaround or temporary fix, test it yourself if possible,
then guide the customer through implementation. Do not assume
the customer can follow engineering's technical instructions
without support assistance.

SLA compliance: Escalations must not cause your team to miss
SLA targets. If a P0 ticket is escalated to engineering but
you are the escalating support engineer, you remain
accountable for the customer response time. Ensure the
customer is notified of escalation, given an incident or
tracking number, and told when they should expect to hear from
engineering. If engineering will miss the SLA target, notify
your support manager immediately so they can escalate further
if needed.

Regression and pattern tracking: If you escalate multiple
tickets for the same root cause (for example, multiple
customers reporting stalls with the same error message after a
specific Atlas update), flag this pattern to engineering. It
may indicate a widespread regression that needs urgent
fixing. Use the ticket comments to note "potential
regression, see also INC-XXXX, INC-YYYY, INC-ZZZZ". This
helps engineering prioritize and may prevent further customer
impact.

Severity assessment when escalating: Assign the correct
severity when escalating to ensure the on-call engineer
prioritizes appropriately. P0 severity escalations affect
production data flow and customer revenue; these are paged
immediately. P1 escalations affect business processes but do
not cause immediate revenue impact; these are handled within
one business hour. P2 escalations affect non-critical systems
or allow workarounds; these are handled within one business
day. Be honest about severity. If the customer is using a
sync for a daily reporting job that runs at 2 AM and the sync
is stalled at 11 PM, this is P1 (urgent within hours) not P0
(immediate). Overstating severity trains the on-call engineer
to ignore severity labels.

Escalation without diagnostic completion: You are not required
to solve every stall yourself before escalating. If you have
spent more than 30 minutes on diagnosis and are still unclear
on root cause, escalate to engineering with details of what
you tested. Escalating is not a failure; it is a necessary
part of the support process. The engineering team has access
to source code, logs, and system metrics that support
engineers do not. They can often identify issues in minutes
that would take support hours of investigation. Escalate
early if you are blocked or uncertain.

Customer communication during escalation: Do not blame the
customer for the issue when escalating. Phrases like "the
customer misconfigured" or "the customer did not follow"
sound accusatory. Instead, use neutral language like "the
customer reports they do not recall making configuration
changes" or "we were unable to confirm the source is
accessible from the customer's network." This maintains a
good relationship with the customer and keeps the focus on
resolution, not blame.
