---
document_id: nw_operations_dr_runbook
title: Disaster Recovery Runbook
source_name: Northwind Operations Disaster Recovery Runbook
source_path: northwind/operations/disaster-recovery-runbook.md
department: operations
access_scope: department
allowed_roles: []
allowed_departments: [operations, engineering, executive]
version: "4.1"
effective_date: "2026-02-15"
---

# Disaster Recovery Runbook

## Activation Criteria and Declaration Authority

A disaster is a regional infrastructure failure that impairs the
ability of Northwind Core to serve customer workloads for longer
than 15 consecutive minutes or creates credible risk that recovery
will exceed the recovery time objective of four hours. This includes
extended database unavailability across all read replicas in a
region, persistent network partitions isolating the primary data
center from customer-facing load balancers, loss of authentication
or authorization systems across all geographic deployments, cascade
failures in upstream infrastructure outside our direct control, or
any single point of failure in the production stack that affects the
availability tier of more than one customer account simultaneously.

A severe incident, by contrast, is any failure that degrades service
for one or more customers but remains contained to a single component,
system, service tier, or customer account, and is resolved through
normal incident procedures within the standard SLO window for that
severity level. The distinction is critical operationally: a database
failover triggered by a single region experiencing a network partition
is classified as a severe incident and is resolved by restoring that
region or failing traffic over manually without executing the full
disaster recovery sequence. A database failover triggered by loss of
all active connections globally or by simultaneous outage of all
primary and secondary read replicas is classified as a disaster and
triggers full activation of this runbook.

Declaration authority for disaster status rests exclusively with the
Chief Operating Officer, Victor Lindqvist, or the Chief Technology
Officer, Ravi Iyer. The on-call engineering lead or on-duty incident
commander may declare a disaster provisionally when both Lindqvist
and Iyer are unreachable, provided the lead submits written
notification to both executives within 30 minutes of the provisional
declaration and within 15 minutes of the initial incident report from
the monitoring system. This provisional declaration is binding until
either executive explicitly confirms or rescinds it via a message in
the incident channel. If neither Lindqvist nor Iyer can be reached
within 30 minutes of a direct request for disaster declaration, the
on-call lead's provisional declaration automatically becomes
permanent and full decision authority for all recovery actions vests
in the lead until either executive resumes command.

Every potential disaster declaration begins with a mandatory triage
and assessment window. From the moment an infrastructure alert is
first reported to the on-call team until a formal declaration is made,
exactly 30 minutes is allocated for the on-call lead or incident
commander to gather and verify facts and determine whether the event
truly meets disaster classification criteria. During this 30-minute
window, no failover actions are authorized. The lead must confirm
whether customer traffic is actually impaired in the primary region
by checking customer session logs and load balancer traffic patterns.
The lead confirms whether the identified infrastructure failure can be
repaired and service restored within 30 minutes by querying the
affected infrastructure team (database, networking, or upstream
provider). The lead verifies whether standby systems are prepared to
receive customer traffic by checking the last successful promotion
test and the health status of the standby region. The lead gathers
information about the root cause of the outage from available logs,
so that the team has context for the decision to failover or to
attempt in-place recovery.

If at the 30-minute mark the failure can be resolved as a severe
incident and service can be restored within normal incident SLOs, no
disaster is declared. If at the 30-minute mark restoration in the
primary region has not begun or is not credibly on track to complete
within the next two hours, the event is declared a disaster. The
declaring authority documents the disaster declaration in a message
posted to the incident channel that includes the exact timestamp of
declaration, the explicit reason for declaring a disaster, the action
being taken immediately (failover or other recovery measure), and the
RTO target of four hours. This message is the authoritative record of
disaster declaration and serves as the moment at which all recovery
clocks are started. No action is taken before this message is posted;
all team members reference this message to understand the starting
point.

Once a disaster is declared, the Disaster Recovery Plan revision
DRP-11 becomes the sole operational authority for all personnel
involved in the recovery. Every action taken during disaster recovery
follows the sequence and procedures defined in this runbook. Any
deviation from this runbook or change to the established sequence
requires explicit written authorization from the declaring authority
and is documented in the incident channel with the time of deviation,
the specific reason for the change, and the name of the authorizing
person. The incident commander during disaster recovery is initially
the person who declared the disaster (the COO, CTO, or on-call lead).
This person retains command authority unless explicitly transferring
command to another authorized person.

The declaring authority may transfer command to another person at any
moment by posting a transfer message to the incident channel that
names the incoming commander. Authorized recipients of command transfer
are the incident commander already managing the response, the vice
president of engineering, any engineering director, or the VP of
operations if the CTO declared the disaster. Each transfer is logged in
the incident channel and the incoming commander acknowledges receipt and
assumes authority for all subsequent decisions within 60 seconds of the
transfer message.

If the declaring authority becomes unreachable after declaring a
disaster, command does not pass automatically to the next person in a
chain. Instead, the person currently managing the response continues
in that role until either the declaring authority returns and resumes
command directly or the person in command formally initiates a transfer
to someone explicitly authorized to hold command. The person in command
may attempt to reach the declaring authority by any available means,
including calling their personal phone, paging their emergency contact,
and escalating through their manager if known. All on-call contact
information is maintained in the on-call rotation system and is kept
current by the operations team. If all persons in the command chain are
unreachable, the most senior person physically or digitally present and
able to communicate with the full on-call team assumes interim command
and immediately notifies both Lindqvist and Iyer by email, SMS, and
phone call that interim command has been activated and states the
reason. This interim command remains in effect until either the
declaring authority resumes control or the interim commander explicitly
transfers authority to someone else in the authorized list. Interim
command does not expire automatically; it must be formally rescinded or
transferred. The interim commander logs all decisions made under interim
command to the incident channel with timestamps.

The decision to abort the failover sequence and resume operations in
the primary region is a decision point that requires explicit
authorization from the declaring authority or the person in command.
If the primary region becomes healthy before failover is complete, or
if the incident commander judges that the risk of failover exceeds the
risk of in-place recovery, the commanding officer may choose to abort
and resume. The commanding officer must weigh the risk that the primary
region may fail again (if the root cause is not fully understood) against
the risk of data loss from a standby promotion (if the standby is
unavailable or compromised). This decision must be made early in the
sequence before irreversible changes to the database have been made.
Aborting mid-sequence requires the team to walk back every action already
taken, which is complex and time-consuming, so the decision to abort or
continue is made within 15 minutes of declaring the disaster and not
revisited unless circumstances change dramatically. Once the decision to
proceed is made, it is not reconsidered.

A disaster declaration is not casual. The declaring authority posts a
formal declaration message to the incident channel that will be reviewed
post-event to understand the decision-making logic. That message serves as
historical record and as proof that the declaration met the criteria laid
out in this runbook. The message must state the exact timestamp of
declaration, not approximate time or "approximately 3pm". It must state the
specific infrastructure failures observed, not vague descriptions. It must
state the customer impact confirmed at the moment of declaration, not
projected impact. It must state the action being taken (failover, in-place
recovery, or investigation extension) and the rationale. This message becomes
the starting point for the post-event review, and any deviation from this
runbook requires that the same precision be applied to documenting why.

The 30-minute triage window is non-negotiable. During that window, no
failover actions are authorized, even if the team suspects a disaster. The
window exists to prevent reactive failovers caused by panic or incomplete
information. Some of the most damaging incidents in company history have been
caused by hasty failovers triggered by misdiagnosed alerts. The team gathers
facts, confirms them, and rules out simpler explanations. By the 30-minute
mark, the team knows whether the issue can be resolved in place, whether a
failover is necessary, and whether the standby is healthy and ready to
receive traffic. This deliberate gate prevents false positive failovers that
cause more damage than the original incident. Teams that skip triage or cut
it short create chaos; teams that follow it precisely make the right call.

## Failover Sequence for Northwind Core

Failover for Northwind Core follows a fixed, non-parallelized sequence
designed to minimize data loss to the recovery point objective of 30
minutes and to restore customer-facing service within the recovery time
objective of four hours. The sequence begins the moment a disaster is
formally declared and consists of six ordered phases: write freeze,
pipeline quiesce, database promotion, traffic repoint, verification,
and write freeze lift. Each phase must complete successfully before the
next phase begins; there is no parallelization. Each phase is assigned
a time budget; actual time is tracked in the incident channel every
five minutes. Each phase includes a decision point where the incident
commander may choose to abort the entire sequence and attempt recovery
in-place in the primary region, except for phases where the point of
no return has already been passed.

The platform team lead is assigned as the failover coordinator and is
responsible for orchestrating all teams through the sequence. The
failover coordinator posts the start time for each phase and tracks
the end time. If a phase exceeds its time budget, the coordinator
immediately notifies the incident commander and proposes adjusting the
total RTO estimate upward. If a phase encounters a technical failure,
the coordinator pauses the sequence and reports the failure to the
incident commander with a recommendation to either retry, abort, or
attempt a manual workaround.

**Phase One: Write Freeze** (target 10 minutes). The incident
commander issues the write-freeze order to the platform team lead. The
platform team immediately activates a feature flag that disables all
write paths in Northwind Core at the application logic layer. This flag
is independent of customer-facing APIs; it operates at the business
logic layer and blocks create, update, and delete operations across all
product modules while keeping read operations fully open. The flag is
deployed to all production application instances simultaneously using
the existing feature flag deployment pipeline. The platform team
confirms that writes are blocked by submitting a test write from the
staging environment and verifying that it fails with status code 403
and error message "writes_frozen". The team confirms that reads still
work by querying a known data set and verifying that results return
within normal latency. They post completion to the incident channel
with the exact timestamp the write freeze became active. Read operations
continue to function against the primary database at normal performance.

At this point, any customer attempting to create or update data sees an
error message. The customer may retry, but the retry also fails while
the freeze is in effect. Customers can read their data normally. The
write-freeze abort decision point occurs here: if the primary region
shows signs of recovery during this phase (for example, if the root
cause is identified and repair is in progress), the incident commander
can decide to lift the write freeze and resume normal operations,
aborting the entire failover sequence. This decision must be made within
five minutes of the write freeze being active. If no decision is made to
abort, the write freeze remains in effect and the sequence advances to
Phase Two.

**Phase Two: Pipeline Quiesce** (target 15 minutes). The incident
commander orders the data integration team to quiesce all Atlas
pipelines. Atlas is the data integration engine that runs customer-
initiated and scheduled data sync jobs. The team stops all running
integration jobs and pauses the scheduler so no new jobs start. The
team confirms that no new jobs are running and that jobs currently in
flight are in a state where they can be safely resumed from their last
checkpoint after recovery. For pipelines that are mid-sync and cannot be
safely paused mid-operation, the team forcefully terminates the job and
documents which pipeline was terminated, at what stage, and what
checkpoint is available for resume. The team waits for any running
database queries initiated by Atlas to finish, with a hard timeout of
10 minutes; any query running longer than 10 minutes is force-terminated
by the database engine itself.

Once all jobs are stopped and running queries are terminated, the data
integration team posts completion to the incident channel with the
timestamp and a list of any pipelines that had to be force-terminated.
The team estimates the most recent successful checkpoint for each
pipeline from the pipeline metadata; this becomes the recovery starting
point for data restoration after failover. The quiesce decision point: if
the primary database becomes healthy during this phase and the commanding
officer judges recovery in-place to carry lower operational risk than
failover, the sequence can be aborted. The incident commander must make
an explicit abort or continue decision within eight minutes; if no
decision is made, the quiesce state remains active and the sequence
advances to Phase Three. If the decision is to abort, the data team
resumes the scheduler and writes are unfrozen in reverse order.

**Phase Three: Database Promotion** (target 30 minutes). The database
team receives the order to promote the standby database to primary. This
is the moment of highest risk and irreversibility in the sequence. The
database team first confirms that the standby database has valid and
complete transaction logs covering the past 30 minutes and that the
standby is able to recover to the same transaction point as the primary.
The team checks the standby's replication lag and confirms that
replication has been caught up to within 60 seconds. The team then
initiates the database promotion process, which stops the standby from
accepting replication updates, rebuilds all indexes, applies any pending
transaction logs, and opens the standby database for both read and write
operations. This operation takes 15 to 25 minutes depending on the size
of the transaction log, the number of indexes that require rebuilding,
and the hardware performance of the standby node.

The database team monitors the promotion process and posts status updates
every five minutes to the incident channel so the incident commander can
track progress. Once promotion completes, the team confirms that the
database is healthy by running an automated health check suite: verifying
that connection pooling is working, executing a sample read query from
each production table, running a table consistency scan, and verifying
that the database can accept and commit write transactions. These health
checks take approximately five minutes. Once all checks pass, the database
team posts completion to the incident channel, reports the exact timestamp
of the oldest transaction visible on the standby at the moment of
promotion (this is the actual recovery point objective achieved), and
names any indexes that require a later rebuild or any tables that had
inconsistencies that were automatically repaired during promotion.

The promotion decision point occurs only if promotion has not yet been
initiated. Once promotion has started, the sequence cannot be aborted; the
standby database is being promoted and will become the primary whether or
not the team wants to continue. If a failure occurs during promotion (such
as a hardware error on the standby), the incident commander is notified
immediately and the team assesses whether the standby can be recovered or
whether fallback to the old primary is necessary.

**Phase Four: Traffic Repoint** (target 30 minutes). After the database
team confirms promotion success, the platform team receives the order to
repoint customer traffic from the primary region to the standby region.
The team updates the primary DNS record that customers resolve to reach
Northwind Core and updates the application load balancer routing rules
so that all new customer requests route to the standby region where the
newly promoted database is now running. The platform team does not
immediately close or drop connections to the old primary region; instead,
the team configures a graceful connection drain so that requests that
were already in flight when failover began are allowed to finish on the
old primary (with a maximum timeout of 10 minutes; any connection still
active after 10 minutes is forcefully terminated). This approach allows
mid-flight requests to complete against the original region while new
requests immediately route to the new primary.

The platform team monitors the load distribution in real time and posts
the percentage of customer traffic that has moved to the new region to
the incident channel every five minutes until 90% of traffic has migrated.
Once the load distribution is stable and 95% of traffic is being served
from the new region, the platform team posts completion and reports the
total time taken. The team also confirms that the monitoring and
observability dashboard is now collecting infrastructure metrics,
application logs, and performance data from the new primary so that the
team has visibility into the new production system. There is no abort
decision point in Phase Four; once traffic repointing begins, the old
primary is no longer the active production system.

**Phase Five: Verification** (target 45 minutes). After traffic has been
repointed, the engineering team and platform team verify that Northwind
Core is fully operational on the newly promoted primary. This verification
is distinct from database-level health checks; it is an application-level
functional smoke test of the entire system. The team executes the standard
smoke test suite used in canary deployments: creating a test customer
account with a temporary license, uploading a small test dataset, running a
test data integration job with the Atlas integration engine, querying the
integrated test data to confirm it is accessible, generating a test report
and confirming it displays correctly. Each test is executed twice
sequentially to catch transient failures that might only appear on first
attempt.

The team manually samples live customer data from multiple large customer
accounts to confirm that data is present, is accessible, and that queries
return correct results matching the expected schema. The team verifies that
core subsystems work: user authentication succeeds, audit logging is
recording events, customer billing queries return expected results, and
role-based access control is enforced. The team also manually tests the
API endpoints that support Meridian, the customer portal, to confirm that
portal users can log in and view their data. Once all smoke tests pass, the
team checks the data reconciliation script (which runs in Phase Three of
data restoration, described below) to confirm the actual recovery point
objective before the incident commander lifts the write freeze. The team
posts verification results to the incident channel with the timestamp and
specific notes about any tests that failed or required retry. There is no
decision point in this phase; verification must pass before proceeding.

**Phase Six: Write Freeze Lift** (target 5 minutes). The incident
commander issues the order to lift the write freeze. The platform team
disables the feature flag that blocked writes, and write operations resume
flowing to the new primary database. The team confirms that a test write
operation succeeds by creating a test record, and that a subsequent read
query retrieves the created record, confirming end-to-end write-then-read
correctness. This confirmation post completes the failover sequence. The
RTO timer stops at this moment. The incident moves from failover execution
to Phase One of the data restoration procedure. The incident commander
posts a summary to the incident channel: the total time from disaster
declaration to write lift, whether the RTO of four hours was met, and the
next milestone (data verification).

What is deliberately left broken during failover: the old primary database
remains online but is not in a clean shutdown state. Customers cannot
access it and traffic does not route to it. Its transaction state is
unknown and it may have incomplete transactions, unsynchronized replication
state, or database connection pools that are not properly closed. The old
primary may also have diverged from the new primary if transactions were
committed locally but not yet replicated before failover was declared. The
old primary is not cleaned up or investigated immediately after failover.
Instead, recovery and cleanup of the old primary happens in the days
following the incident once the team has time to investigate the root cause
of the failure. If the failover sequence must be reversed because the old
primary recovers and becomes stable, a full failover sequence is executed
again to fail back; this is not a rollback, it is a second complete failover
in the opposite direction.

## Data Restoration and Integrity Verification

After the failover sequence completes and the write freeze is lifted,
customer-facing service is restored. The next phase is data restoration and
integrity verification. This phase is not included in the RTO clock; the
four-hour RTO is measured from disaster declaration to write lift. However,
data restoration is critical to ensuring that customers can use the system
normally and that no silent data corruption or unexpected data loss is
present. The recovery point objective is 30 minutes; this means that
customer data and transactions committed to the database up to 30 minutes
before the failover was declared are expected to be present in the new
primary. Data committed after that 30-minute window is expected to be lost.
The goal of the data restoration process is to precisely quantify what data
was lost, to verify that remaining data is internally consistent, and to
ensure that customer-facing systems and APIs report data accurately even if
some data has been lost due to the RPO.

**Snapshot Restoration and Recovery Point Calculation**. Immediately after
the write freeze is lifted, the database team retrieves the most recent
database backup snapshot taken in the primary region before the failover
was declared. The team notes the exact timestamp of that backup and
documents its location. The team then retrieves the metadata from the
standby database at the moment it was promoted to primary and determines
the timestamp of the oldest transaction available in the standby at that point. If the backup is newer than the
standby's recovery point (meaning the backup includes data that the standby
never saw), the standby's promotion already covers any gap created by
failover and no earlier backup is needed. If the backup is older than the
standby's recovery point, the team marks this information and sets the
standby's recovery point as the actual RPO achieved.

The team restores the most recent backup to a temporary isolated database
instance running on dedicated hardware, separate from production systems.
This temporary instance is used only for comparison and validation. The team
runs a comparison query that identifies all transactions that exist in the
newly promoted primary but not in the backup. This tells the team which
transactions were replayed from the transaction log during the promotion
process. From this list, the team calculates the exact earliest timestamp of
a user-facing write operation to the production database that is known to be
lost. All write operations committed before this timestamp are expected to be
present in the new primary; all writes after this timestamp are unknown and
may be lost. The team posts the actual RPO achieved to the incident channel
and to the support team so that support can begin identifying which customers
were impacted by data loss.

**Reconciliation Pass and Integrity Check**. The database team runs an
automated integrity check against the newly promoted primary database. This
check verifies that all foreign key relationships are valid and that no rows
exist with dangling references to deleted parent records. The check scans
that no table has orphaned child records whose parent records were deleted.
The check verifies that indexes are synchronized with the actual data and
that index statistics are accurate. The check scans every table in the
schema and flags any rows with logical inconsistencies such as invalid
enumerations, out-of-range numeric values, or malformed strings in required
fields. Some rows marked as inconsistent may have been partially updated in a
multi-step transaction that was interrupted; the team investigates whether
completing the transaction manually or deleting the partial row is the right
choice. The database team manually reviews each flagged row to determine
whether it represents data corruption that should be deleted or a legitimate
gap from incomplete transactions that were committed locally but lost during
failover.

For each flagged inconsistency, the team documents whether the row should be
deleted as corrupt data, left in place as an artifact of data loss, or
investigated further. The team creates a remediation plan for each decision,
including the business justification for the choice. The team also estimates
the impact of each decision on customer-facing reports and analytics.
The team then executes a second pass of the integrity check, applying the
documented deletions of corrupt data and recalculating index statistics. The
team verifies that the second pass finds no new inconsistencies. The team
reports the final reconciliation results to the incident commander: the count
of rows deleted as corrupt, the count of inconsistencies left in place as
expected data loss, the count of tables where inconsistencies were found, and
an overall assessment of whether data integrity is intact enough for customer
queries to function normally without encountering errors.

**Data Gap Quantification and Scope Assessment**. The support team and
product analytics team jointly quantify the scope of data loss across all
customers. They retrieve a snapshot of the production database taken
immediately before the failover was initiated (from a standby backup). The
team runs row-count queries for each customer against both the pre-failover
snapshot and the new primary, comparing the results. For each customer, the
team calculates the exact number of records lost and the time range in which
the loss occurred. The team separately queries the application transaction
logs and API request logs to identify which API calls were accepted by the
system (received a 200 response) but whose side effects (database writes)
were lost because the transaction was not yet committed when failover
occurred.

For each customer, the support team produces a detailed data loss report: the
count of records lost organized by data type, the names of affected features
or modules, the exact time window in which loss occurred (for example,
"records created between 14:32 and 14:58 UTC"), and which API operations
were affected. The report includes a mapping of lost transactions to customer
actions (for example, "three upload jobs that started at 14:40 UTC were not
committed"). This report is used to compose targeted customer communications
and to guide manual recovery efforts if needed. The report is reviewed by the
support team for factual accuracy before any customer communication is sent.
Customers are never told of data loss using percentages; they are given the
exact count and the specific time range of missing data so they can
understand the scope and reconcile with their own records if needed. Large
customers may receive a direct phone call from their account manager in
addition to email notification.

**Verification and All-Clear Authorization Rule**. The product leadership
team and engineering leadership team jointly review the reconciliation results
and the data loss reports. A critical rule applies at this stage: no customer-
facing all-clear announcement is issued, and no message is sent to customers
stating that the incident is resolved, until the data reconciliation process
is completely finished and both the database team and the support team have
explicitly confirmed that customers can query their data without encountering
corrupted rows or missing critical references that would cause application
errors or data consistency violations. The product team verifies that no
customer-facing features are broken or degraded by the presence of missing
data. If the reconciliation reveals data corruption affecting more than five
percent of customer data in any single account, or if the total records lost
exceed five percent of an account's stored records, the incident remains
declared and the team investigates alternative recovery methods rather than
accepting the data loss. The threshold is applied per-account; a single
affected account may trigger additional recovery efforts even if aggregate
loss across all customers is low.

Alternative recovery methods include restoring from an older backup snapshot,
attempting transaction log replay from the old primary if it is recoverable,
or in rare cases performing manual data restoration from customer exports or
third-party source systems. If an alternative recovery path is chosen, the
incident coordinator informs all stakeholders of the revised timeline and the
additional data loss that will result. The team re-runs the reconciliation
process against the restored data to confirm that the alternative recovery
method has resolved the corruption. Once the assessment is complete and the
team is confident that remaining data issues are operational (missing records
that are expected loss due to RPO) rather than unexplained data corruption or
inaccessible data, the VP of Engineering posts the all-clear message in the
incident channel and support begins customer communication. The all-clear
includes the actual RPO achieved, the count of affected customers, the
aggregate count of records lost across all customers, the specific time window
affected, and a summary of any data loss per-customer impact.

**Backup and Standby Recovery Path**. If the reconciliation process uncovers
data corruption that cannot be resolved by running the automated integrity
check, or if the data loss exceeds the expected RPO window substantially, the
team may choose to restore from a backup snapshot taken earlier than the one
used in the initial RPO calculation. This is a decision requiring explicit
authorization from the CTO and the VP of Engineering. Restoring from an older
backup resets the system to an earlier point in time and results in greater
data loss but may avoid customer impact from data corruption. If this path is
chosen, the incident timer is extended and a new and final RPO is calculated
from the earlier backup timestamp. The team notifies affected customers of
the revised scope of data loss. After successful restoration from an older
backup, the old primary region is kept offline and out of service. It is not
brought back into production until at least one week of continuous monitoring
confirms that the infrastructure issue that caused the initial failover has
been fully resolved and is no longer a risk to production. The engineering
team provides a written assessment of the root cause before the old primary is
restored to service.

## Communication, Stand-Down and Post-Event Review

The Communications team begins drafting customer notifications immediately
after a disaster is declared, using the standardized status page template
maintained in the company wiki. The first public communication is posted to
the status page within 15 minutes of the disaster declaration. The message
states that Northwind Systems is currently experiencing a regional
infrastructure outage affecting the Northwind Core service and that the
operations team is implementing disaster recovery failover procedures with a
target recovery time of four hours. The status page is set to "Degraded
Service" status. The message does not speculate about root cause or provide
technical details that customers may not understand; it focuses on impact and
timeline.

Regular updates are posted to the status page every 30 minutes until the
failover sequence completes and the write freeze is lifted. Each update
includes the name of the current phase, the target time for that phase, the
actual time elapsed, and a revised estimated time to full recovery. If a
phase takes longer than its budgeted time, the communication explicitly
states that the timeline has extended and provides an updated ETA. If a
phase encounters unexpected complications, the status page update
acknowledges the complication without assigning blame and provides the team's
best estimate for recovery.

Once the failover sequence completes and the write freeze is lifted, the
status page is updated to "Monitoring Recovery" status. A notification email
is sent to every customer email address on file to inform them of the incident,
the duration of the service outage, and the fact that failover to the standby
region has been executed and service has been restored. The email states that
the operations team is verifying data integrity and will post a full detailed
update within two hours. This email is sent by the support team using the
standard incident notification template in the Ticketline support system. A copy
of the notification is also posted to the customer Pulse channel for any
customers who are enterprise accounts with dedicated Pulse integration.

Internal communication proceeds in parallel with customer communication. The
incident commander posts status updates to the company-wide Pulse channel
(#incident-notifications) and the incident-specific channel every 30 minutes
during the failover execution. The updates follow the same format as the status
page updates, tracking which phase is in progress, time elapsed, and revised
ETA. Once the failover sequence completes and the write freeze is lifted, the
incident channel is updated to acknowledge the successful failover completion
and to state the next milestone (data verification and reconciliation). The
CEO (Dana Okafor), CFO (Marcus Webb), COO (Victor Lindqvist), and CTO (Ravi
Iyer) are @-mentioned in all major status updates so that leadership is aware
of progress in real time.

Once the all-clear is issued from the data reconciliation team, a final
summary message is posted to both the internal Pulse channels. This message
states the declared RTO (four hours), the actual recovery time measured from
disaster declaration to write lift, the actual RPO achieved, the count of
affected customers, the total count of records lost, and a statement that a
formal post-event review meeting is scheduled for 48 hours after stand-down.
The message also notes whether the recovery met the RTO target. At this point,
if data loss affects specific customer accounts, the account managers for those
accounts are assigned the task of contacting their customers individually to
explain the loss, provide the data loss report, and discuss goodwill credit
options if applicable. Goodwill credit approvals follow the thresholds set by
the Customer Complaint Escalation Path.

**Stand-Down Criteria and Incident Closure**. A disaster is officially stood
down and incident mode is closed when all of the following conditions are met
simultaneously: the failover sequence has completed and the write freeze has
been lifted; the data reconciliation process is completely finished and has
reported its findings; the all-clear has been issued to customers and no
caveats or unresolved issues remain; and a minimum of 30 minutes has elapsed
since the all-clear was issued with zero reports of new issues, unexpected
data loss, or continued service degradation. At the moment when all these
conditions are met, the incident commander issues a stand-down order in the
incident channel using the phrase "INCIDENT STAND-DOWN" and marks the incident
as closed.

The 30-minute buffer after the all-clear is released is not arbitrary. It
exists to catch secondary failures that surface after failover completes. Some
cascading issues do not appear immediately after failover; they appear when
jobs resume, when cache layers refresh, or when the system experiences its
first real production load after promotion. The buffer period provides
visibility into whether the recovery is actually stable or whether a new
failure is emerging. If a new issue is reported during the buffer, the buffer
clock resets. If issues keep appearing every 20 minutes for several cycles, the
team does not declare stand-down; instead, the incident commander escalates to
Ravi Iyer (CTO) with a status that the system is not stable and extends the
investigation. The stand-down is not hurried.

A comprehensive hand-off document is compiled containing: the timeline of
events leading to the decision to failover, the duration of each phase against
the budgeted time, the actual RPO achieved, the count of affected customers and
records, any deviations from this runbook that were made during recovery, and
lessons learned from team observations. The hand-off document is filed in the
company wiki under the incident archive category.

**Post-Event Review Meeting and Report**. Within 48 hours of stand-down, the
Disaster Recovery Coordinator Yusuf Delacroix schedules the formal post-event
review meeting. Attendees include the operations team, the engineering team, the
customer support team leadership, and the COO and CTO who are in leadership
positions. The meeting is conducted in a blameless review format; the purpose is
to assess the quality of the runbook and procedures, not to blame individuals.
The meeting reviews the incident timeline, the decision points where the sequence
could have been aborted or changed, the actual performance against the RTO and
RPO targets, any deviations from this runbook and the reasons for those
deviations, and any actions or decisions that could have been faster or clearer.

Participants discuss what was done well operationally and what could be improved.
Engineering participants identify sections of this runbook that are unclear or do
not reflect actual operational constraints based on how the incident was handled.
The Coordinator documents all findings and recommendations. A key aspect of the
review is understanding why any deviations from this runbook were necessary. If
a phase took longer than budgeted, the team understands why and documents whether
the budget should be increased, whether the procedure should be optimized, or
whether the actual incident presented circumstances this runbook does not account
for. This distinction matters; a budget increase is the right call if the
infrastructure is working as designed, but slower optimization is the right call
if the procedure can be streamlined.

The Coordinator produces a written post-event review report within one week of
the meeting. The report includes a summary of the incident, a detailed timeline
showing each phase and the actual duration compared to the target time, the actual
RTO and RPO achieved, findings about the accuracy and usability of this runbook,
and specific recommendations for process changes or runbook updates. The report
is shared with the full leadership team and is filed in the company wiki. The
Coordinator tracks every recommendation and ensures that each finding is either
implemented in this runbook or explicitly decided against by leadership within 30
days. Recommendations that are decided against must include documented reasoning
so the team understands why the team chose not to change the runbook.

**Quarterly Disaster Recovery Test Cadence**. The Disaster Recovery Coordinator
schedules and executes a complete disaster recovery test on a quarterly basis.
The test is scheduled for a Saturday or Sunday to minimize customer impact in case
of issues. The test follows this runbook exactly from start to finish: declaring a
simulated disaster, executing the full failover sequence to the standby region,
running the verification suite, and performing the full data reconciliation. The
test does not restore customer data from backup; instead, the standby database is
reset to a snapshot taken exactly 30 minutes before the test start time to simulate
the RPO and allow measurement of data loss detection accuracy. The test concludes
by executing a full failover sequence in reverse to fail back to the primary region
and restore normal operations. After the test completes, a post-test review meeting
is held with the engineering team within three days. The Coordinator maintains a
detailed log of each quarterly test documenting: the date and time, the total
duration, whether each phase completed within its time budget, whether the RTO of
four hours could be met, any failures or deviations from this runbook, and an
assessment of team readiness. If a quarterly test reveals that the RTO cannot be
achieved with current infrastructure, the findings are shared with the VP of
Engineering and the CTO within one week. The team either upgrades infrastructure to
meet the RTO or revises the RTO target downward with documented reasoning.
