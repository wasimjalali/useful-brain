---
document_id: nw_support_meridian_admin
title: Meridian Portal Administration Guide
source_name: Northwind Support Meridian Portal Administration Guide
source_path: northwind/support/meridian-portal-administration-guide.md
department: support
access_scope: public
allowed_roles: []
allowed_departments: []
version: "4.6"
effective_date: "2026-06-15"
---

# Meridian Portal Administration Guide

## Portal Roles and What They Can Do

A Meridian portal has five defined roles, each with specific
permissions and intended use cases. Understanding the role model
helps you assign the right level of access to each team member or
customer administrator. This section walks through each role, what
they see and change, and how they interact with the customer's own
Northwind Core account hierarchy.

**Portal Owner** is the top role. The portal owner can manage all
other users, configure portal settings, control branding, enable or
disable features, manage single sign-on, export audit logs, and
adjust session timeouts and other security settings. A portal owner
can also delete the portal entirely. When you activate a Meridian
portal for a customer, the customer's primary account administrator
becomes the portal owner automatically. There is always at least one
portal owner. If a portal owner leaves or needs to be removed,
another portal owner must transfer the role to someone else. You
cannot demote the last portal owner to a lower role.

**Administrator** is the second tier. Portal administrators can
manage users below their level; they cannot manage or modify other
administrators or the portal owner. They can configure most portal
settings: email notifications, branded appearance within limits,
portal integrations, and read-only access to audit logs for the
past 30 days. Administrators cannot change global security settings
like session timeouts or SSO configuration. Administrators also
cannot export the full audit history beyond 30 days. An
administrator is the right role for someone who handles day-to-day
portal operations but does not need access to sensitive
configurations.

**Agent** is the third tier, intended for support staff or customer
success team members who interact with the portal on behalf of
customers. Agents can view all customer data within the portal,
respond to submitted requests or tickets, update customer records,
and send notifications to portal users. Agents cannot create or
remove other agents. They cannot access any audit log, change
settings, or modify user roles. An agent has broad visibility into
customer data but no administrative power. This role strikes a
balance between capability and containment.

**Read-Only Viewer** is a restricted role. Read-only viewers can
see all data in the portal: customer records, submitted requests,
and activity summaries. They can generate reports from portal data.
They cannot make any changes, create users, send messages, or
access the audit log. This role is useful for managers or analysts
who need visibility without the ability to modify anything. It is
also the default role for anyone invited to a portal who does not
already have a role assignment.

**External Collaborator** is the fifth role, designed for partners,
vendors, or contractors working with the customer. External
collaborators see only the data the portal owner or administrator
explicitly grants them access to. Each collaborator's view is
controlled by a permission set that the owner or administrator
creates. External collaborators can be scoped to a specific project,
department, or customer record. They cannot access any settings,
user management, or audit logs. This role keeps external parties
compartmentalized and reduces your support burden when managing
third-party access.

Role assignment interacts with the customer's Northwind Core
account hierarchy. If a user has a role in Northwind Core, for
example regional sales manager, the portal can optionally sync that
role to the portal. Portal roles do not automatically grant access
to Northwind Core. A portal administrator or owner can choose to
respect the customer's core account structure or build a separate
portal hierarchy that mirrors business functions but does not bind
to core roles. This flexibility lets customers use Meridian as a
standalone access control layer.

The least-privilege default is the Read-Only Viewer role. When you
invite a new user to a portal and do not specify a role, they
receive Read-Only Viewer permissions. This prevents accidental
over-grant and requires the portal owner to explicitly elevate
anyone who needs more. The portal owner can change this default, but
most customers keep it. Override the default only if you have
strong business justification, and document that choice in your
support ticket.

When roles conflict, the most permissive role wins. If a user has
both Agent and Administrator roles, they operate as an
Administrator. Similarly, if the SSO system assigns multiple roles,
a topic covered in the section on configuring single sign-on, the
portal takes the highest role the identity provider sends and
ignores the lower ones.

Each role has implied duties within Northwind's support structure.
Portal owners often correspond with support staff during onboarding
and when major configuration changes are planned. They are the
primary escalation point for architectural questions about the
portal. Administrators tend to raise most day-to-day questions about
notification configuration, user invitations, and permission
troubleshooting. Agents rarely contact support directly; if they do,
route them to their portal administrator as a best practice. External
collaborators should only contact support through their assigned
portal owner or administrator, never directly; this keeps the
support channel clean and ensures the portal owner remains aware of
any collaboration issues. Support tickets opened by a collaborator
with no portal owner listed are P2 escalations and route to
management review as a governance safeguard.

Role changes take effect immediately for a user who is already
logged in; the change applies the next time they refresh their
browser session or navigate to a new portal page. If a user's role
is downgraded or removed while they are actively using the portal,
their access to restricted pages or actions stops when they try to
use them; they are not logged out immediately, but the system
prevents further privileged actions. A portal owner can audit all
role changes in the audit log and see the timestamp, the user who
made the change, and the old and new roles. This audit trail helps
you investigate access issues and maintain compliance with the
customer's own policies. If a customer accidentally downgrades a
critical administrator's role, they can revert it immediately from
the audit log details screen, which shows a rollback button for
recent changes made in error.

Cascading permissions mean that the portal owner can always override
any setting an administrator or agent has made. If an administrator
creates a notification template or modifies a customer record, the
portal owner can still view, edit, or delete that work. This is
intentional: ownership and oversight flow upward. The agent role
does not cascade; an agent's edits are independent and another agent
or administrator can revise or delete them. This layered model
prevents any single person (other than the portal owner) from
locking others out of important decisions.

**Practical role assignment scenarios** help clarify the model in
practice. In a small customer with three people, all three might be
portal owners with equal authority. In a large enterprise, the IT
director is the portal owner, team leads are administrators, support
staff are agents, and finance is a read-only viewer. For a vendor
relationship, the vendor's account manager becomes an external
collaborator with access only to their specific customer account.
When a customer acquires another company, the acquired company's
support team starts as external collaborators in a separate
permission scope, isolated from the acquiring company's main
operations. Over time, they can be promoted or integrated into the
main hierarchy as teams merge. Multinational customers often use
region-specific administrators, each managing their own market.

**Changing role assignments mid-career** is common. When a junior
support staff member is promoted to team lead, their portal role
changes from Agent to Administrator. When someone leaves the company,
their role is downgraded to Read-Only Viewer or the account is
deleted entirely. When an administrator goes on extended leave, a
backup administrator is added temporarily. The portal owner initiates
all these changes. When a customer reports that someone left but is
still accessing the portal, it is usually because their role was
downgraded instead of deleted, or the employee still has SSO access
through the identity provider. Clarify what the customer means by
"access" (can they log in, or can they see data) and whether SSO is
in use; that often resolves the concern.

**Permission combinations and edge cases** arise when a customer
tries to assign overlapping or contradictory roles. Portal system
prevents most conflicts: you cannot assign both portal owner and
read-only viewer to the same user. Meridian enforces role hierarchy
strictly. If a customer asks "Can I make someone an Agent who can
also manage users?", the answer is no; that combination does not
exist. The closest option is Administrator, which includes both
visibility and management power. When a customer's organization
structure does not fit neatly into the five roles, the portal owner
can create custom permission sets for external collaborators to
approximate hybrid roles without blending Meridian's core role
definitions. This is less ideal than using a standard role but
accommodates unusual organizational structures.

**Inheritance and delegation of authority** follow clear rules. When
the portal owner delegates a task to an administrator, that
administrator has full power to complete the task, including changing
settings and modifying users. The administrator's changes are logged
in the audit trail with the administrator's name, not the portal
owner's name. If the portal owner later disagrees with the
administrator's choices, the owner can override or roll back the
changes. The agent role includes no delegation; an agent cannot
grant authority to another agent.

## Configuring Single Sign-On

End-to-end SSO setup lets your customer's users sign in to Meridian
using their corporate identity provider. Meridian supports SAML 2.0
and OpenID Connect. Most enterprise customers ask about SAML first.
This section walks through metadata exchange, attribute mapping,
just-in-time provisioning, group-to-role mapping, testing without
locking anyone out, and the break-glass local administrator account.

**Starting the SSO flow** begins with the portal owner or a portal
administrator logging in to Meridian, navigating to Settings, and
choosing Single Sign-On. Meridian generates a unique Assertion
Consumer Service (ACS) URL and an entity ID for that portal. These
identifiers are specific to the portal and do not change. The portal
owner or administrator shares the ACS URL and entity ID with their
IT or identity team, who configure Meridian as a new application in
their SAML identity provider or OpenID Connect server.

The identity provider (IdP) generates SAML metadata or OpenID
configuration. The customer's IT team provides this metadata or
configuration URL to the Meridian administrator. In Meridian,
paste the metadata XML or provide the configuration URL. Meridian
validates the certificate chain and parses the IdP's signing
certificate, which Meridian stores locally. This certificate is used
to verify that all signed assertions from the IdP are genuine. If
the certificate expires or is rotated by the IdP, the customer's IT
team must provide the updated metadata so Meridian can refresh it.
Set a calendar reminder with the customer to check the IdP's
certificate expiration date and update well before it expires.

**Attribute mapping** tells Meridian which fields from the SAML
assertion or OpenID token correspond to user identity and role
assignment. By default, Meridian looks for the NameID in SAML or
the `sub` (subject) claim in OpenID; this becomes the user's login
identifier and is never shown in the portal UI. The primary email
address is mapped from the SAML attribute `email` or the OpenID
claim `email`. You can customize these mappings; for example, if
your customer's IdP sends email in a custom attribute called
`mail_address`, you can map it there instead. The customer's IT
team tells you the attribute names their IdP sends. Mapping errors
are the most common SSO failure; ask your customer to generate a
test SAML assertion or OIDC token and check the attribute names
before finalizing the config.

**Just-in-time provisioning** (JIT) is optional. When enabled,
Meridian creates a new portal user automatically the first time
someone signs in via SSO, if they do not already exist in the
portal. JIT uses the email address and any other attributes you
mapped to populate the new user's profile. Without JIT, you must
manually create portal user accounts before those users can sign in
via SSO, which is more work but offers tighter control. Most
customers enable JIT for convenience. If you enable JIT, the user's
initial role is the default role you configured; usually Read-Only
Viewer. The portal owner can change the role later if needed.

**Group-to-role mapping** connects SAML attributes or OpenID token
claims that represent group membership to Meridian portal roles. For
example, your customer's IdP sends a SAML attribute called
`groups` with values like `sales_team`, `support_team`, and
`admin_team`. You can map `admin_team` to the Meridian
Administrator role, `support_team` to the Agent role, and `sales_team`
to Read-Only Viewer. When a user signs in via SSO, Meridian checks
which groups their IdP assertion includes and assigns the
corresponding portal role. Group mapping supersedes JIT's default
role. If a user belongs to multiple groups that map to different
roles, Meridian applies the highest role (Administrator wins over
Agent, Agent over Read-Only Viewer). Changing group membership in
the IdP takes effect on the user's next SSO sign-in; existing
portal sessions are not affected.

**Clock skew tolerance** is a technical detail that prevents
authentication failures due to time drift between your customer's
IdP server and Meridian's clock. SAML assertions include a
timestamp. When Meridian receives an assertion, it checks that the
current time is within the assertion's validity window. If the IdP's
clock is 5 minutes ahead of Meridian's, a freshly issued assertion
might appear to be dated in the future and fail validation. To
handle this, Meridian has a clock skew setting called
`meridian.sso.assertion_skew_seconds`, which defaults to 300 seconds
(5 minutes) and can be set up to 600 seconds (10 minutes). Increasing
this tolerance reduces authentication failures due to time drift
but makes it easier for an attacker to replay an old assertion if
they capture it. Most customers use the default. If a user reports
"sign-in keeps failing even though my password is right", clock skew
is a common cause; have them contact their IT department to sync the
IdP server's clock, then try again. If that doesn't help, check
Meridian's server clock. If the skew is more than 5 minutes, ask
Northwind support to investigate.

**Testing without lock-out** is critical. Before requiring all
portal users to sign in via SSO, test with a small group. Create a
test account in the portal and test that identity in your customer's
IdP. Try signing in via SSO and check that you land in the portal
with the right role and attributes populated. Have a few trusted
admins from the customer's team test before you enable it for
everyone. Meridian allows portal owners to enable SSO for only a
subset of users by marking their accounts as SSO-only or password-only,
so you can roll out gradually. Keep password-based sign-in enabled
for at least one portal owner until you are confident SSO works
reliably.

**Break-glass local administrator** is a safeguard. If the customer's
IdP is down or misconfigured, users cannot sign in via SSO. Meridian
preserves one local (non-SSO) portal owner account that can always
sign in with a password. This account is not visible in the user
list and cannot be given to regular users. If SSO breaks, the portal
owner uses this account to fix the SSO config or revert it. Only
the very first portal owner, created before SSO was set up, has this
capability. If that account is deleted or its password is lost, you
need Northwind support to unlock the portal. Document this account's
password securely with your customer; losing it means being locked
out of your own portal if SSO fails.

**Attribute refresh** happens on every SSO sign-in. Meridian does
not cache group membership or email address. Each time a user signs
in, Meridian reads the current attributes from the IdP assertion and
applies current group-to-role mapping. If the customer's IT team
changes a user's groups in the IdP, the change takes effect on that
user's next sign-in. Users already signed in are not updated until
they log out and sign in again or their session expires. This means
group membership changes are not instantaneous across the portal but
become effective quickly in practice.

**Metadata refresh** should happen annually at minimum. Every
identity provider rotates their signing certificates on a schedule.
Before a certificate expires, the IdP publishes a new one in its
metadata. If the customer's IT team updates their SAML metadata or
OpenID configuration, you should update Meridian. Set a calendar
reminder and ask your customer to notify you when their IdP's
certificates rotate. An expired or missing signing certificate causes
all SSO sign-in attempts to fail with an error message to the user:
"Sign-in failed. Your identity provider's credentials are not
recognized." Users then cannot access the portal. If this happens
unexpectedly, ask the customer's IT team if they have recently
rotated their IdP certificate and ask for the new metadata.

**Common SSO troubleshooting issues** include attribute mapping
errors (the user's email field is not found, so Meridian creates a
user with a missing email address), group-to-role mapping that
assigns the wrong role because the group name format differs from
what was configured, and clock skew causing assertion validation to
fail. When a customer reports SSO sign-in is failing, the first step
is to ask them to provide a test SAML assertion or token from their
IdP and verify that the expected attributes and groups are present
in the correct format. Many customers have exported a sample
assertion from their IdP's debugging interface; ask for that before
spending time on escalation. If group mapping assigns a user a
Read-Only Viewer role when they should be an Administrator, the
solution is to check the group values in the IdP and update the
mapping if the format has changed.

**Batch vs interactive provisioning** matters for large roll-outs.
With just-in-time provisioning (JIT), accounts are created on first
sign-in. With batch provisioning, you or the customer's IT team can
pre-stage users in bulk before SSO is enabled. Meridian does not
offer a bulk user creation API; instead, customers often ask you to
import a CSV of users and assign roles in advance. This is a manual
process: contact Northwind support if your customer needs bulk
import tooling. Most customers use JIT and accept that the first
sign-in will be slightly slower as the account is created.

**SAML vs OpenID Connect** both work with Meridian; the choice
depends on the customer's infrastructure. SAML 2.0 is older and more
common in enterprise; OpenID Connect is newer and often easier to
integrate with cloud providers like Sentri or Nimbus AD. Both support
attribute mapping and group-based role assignment. The customer's IT
team usually has a preference based on their existing infrastructure.
Meridian supports both equally well, so defer to the customer's
choice. If they ask which is better, the honest answer is they are
equivalent in capability; SAML has broader legacy support, OpenID
Connect has slightly simpler configuration. Some customers run both
in parallel during migration; Meridian allows you to enable both
protocols at once, with users choosing which to use at login.

**Metadata and certificate validation** are security-critical.
Meridian validates the IdP's certificate chain using standard X.509
validation. If the IdP's signing certificate is self-signed or issued
by a custom certificate authority, you may need to import the
certificate chain into Meridian manually. Most enterprise IdPs use
certificates issued by a public CA, so this is not needed. If the
customer's IdP uses a custom CA, ask them to provide the root
certificate and any intermediate certificates. This is an advanced
configuration; escalate to Northwind engineering if the customer is
unsure how to provide it. When a customer is unsure whether their
certificate is valid, ask them to visit their IdP's metadata URL in
a browser and check that the page loads without certificate warnings.
If the certificate is invalid or expired, the customer's IT team must
update it in their IdP before Meridian can use it.

**Re-authentication and session refresh** happen automatically. When
a user's session is about to expire, Meridian does not force a
re-login; instead, it refreshes the session in the background by
contacting the IdP silently. This keeps the user logged in across
multiple browser tabs and prevents disruption. If the refresh fails
(for example, if the user has been disabled in the IdP), the user's
next action is met with a login prompt. This creates a seamless
experience for most users and only surfaces authentication friction
when necessary.

## Branding, Notifications and Locale

Meridian allows your customer to brand the portal with their own
logo, colors, custom domain, and custom email sender address. This
section covers logo and color configuration, custom domain setup,
email sender configuration, notification templates and digest
options, and time zone and language settings.

**Logo and color customization** starts in Settings under Branding.
The portal owner or administrator can upload a company logo image
(PNG, JPG, or SVG, up to 2 MB). The logo appears in the top left of
the portal header. Meridian resizes it to 40 pixels tall; aspect
ratio is preserved. You can also change the primary accent color of
the portal interface. The portal uses this color for buttons, links,
and highlights throughout the UI. You can pick from a palette of
predefined colors or enter a custom hex code. The color choice does
not change the layout, only the accent tint. Branding changes take
effect immediately; users who are already logged in see the new logo
and colors when they refresh their browser.

**Custom domain** lets your customer serve Meridian from their own
domain instead of the default `portal.northwind.example` URL. To set
up a custom domain, the portal owner or administrator enters their
domain (for example, `support.acmecorp.example`) in Settings under
Branding. Meridian generates a DNS CNAME record that the customer's
IT team must add to their DNS. The CNAME points to a Meridian-owned
domain. After the DNS record is live and propagates (usually within
an hour), Meridian provisions an HTTPS certificate for the custom
domain and begins serving traffic there. Until the DNS is live,
Meridian shows a status of "Pending" and the old default URL still
works. Once the custom domain is live, you can optionally disable
the default URL so all traffic goes through the custom domain. This
is recommended for security and branding. Keep the old URL alive
during the migration so users don't lose access. Removing a custom
domain is reversible; the portal falls back to the default URL.

**Email sender configuration** controls which address appears in the
"From" line of portal emails and which domain is used for bounce
handling. By default, Meridian sends email from
`noreply@portal.northwind.example`. To use a custom sending domain
(for example, `noreply@acmecorp.example`), the customer's IT team
must add SPF and DKIM DNS records for that domain pointing to
Meridian's mail infrastructure. This prevents email from the portal
from being flagged as spam or rejected. Configuring a custom sending
domain is the most common reason Meridian support receives requests
to escalate to engineering; the ticket code you quote when requesting
this infrastructure change is `MER-CFG-44`. Include the customer's
domain and the Meridian portal ID in the request. Engineering
provisions the SPF and DKIM records and notifies you when they are
ready. The customer's IT team then adds their DNS records and tests
delivery.

**Notification templates** let the customer customize the content of
portal emails. Meridian sends emails when users are invited, when
their role changes, when a notification event is triggered, or when
a digest is generated. For each email type, the portal administrator
can edit the subject line and body. Templates support basic variable
substitution: the recipient's first name, last name, email, the
portal name, and the administrator's name. Most customers leave
templates at their defaults; customization is most common for
welcome emails and digest summaries. Template changes apply to new
emails sent after the change is saved; previously sent emails are
not affected.

**Notification digests** let users opt in to daily or weekly
summaries instead of instant notifications. Each notification type
(user invitation, role change, customer update, ticket submitted,
customer inquiry) can be configured to trigger an instant email, a
daily digest, a weekly digest, or no email at all. The default is
instant email for all types. Most customers reduce digest frequency
to reduce email volume. End users can override the default in their
portal profile settings. Portal administrators can set defaults and
read-only viewers cannot change notification settings.

**Time zone configuration** applies to the portal as a whole. In
Settings under Locale, the portal owner sets the portal's time zone.
All timestamps in the portal UI (audit log, activity feeds, scheduled
events) display in this time zone. Users from different regions see
the same timestamps converted to the portal time zone, not their own
local time. This ensures consistency and prevents confusion when
customer and support staff are in different time zones. The default
time zone is US Central Time (CT) because Northwind's main office is
in Austin. If your customer is in Singapore or London, set the time
zone to their headquarters' time zone or the time zone of their
primary business operations.

**Language and locale** settings control the language of the portal
UI and the format of dates, times, and numbers. Meridian currently
supports English (United States), English (United Kingdom), Spanish,
German, and French. The portal owner selects the language in
Settings under Locale. All portal users see the UI in that language.
Individual users cannot override this; the setting is portal-wide.
Date format (for example, MM/DD/YYYY vs DD/MM/YYYY) is tied to the
language selection and cannot be customized separately. If your
customer needs a language not in this list, it is a feature request
for Northwind engineering; no timeline is guaranteed.

**Support email configuration** determines which email address
portal users see for support inquiries. By default, this is
`support@northwind.example`. Some customers want to display their
own support email instead. The portal owner or administrator can
change this in Settings. The email is displayed in the portal's help
section and in some automated email templates. Changing it does not
affect which email address actually receives support tickets; that
routing is internal to Northwind and customer's support system
integration.

**Dark mode and accessibility** are automatic based on the user's
browser or OS preference. Meridian does not offer a manual dark
mode toggle. If your customer is on a dark OS theme, the portal
appears in dark mode. The colors chosen during branding
customization are adjusted for contrast in both light and dark modes
to meet WCAG AA standards. Users with vision impairments can use a
screen reader; all UI elements are labeled.

**Notification content and frequency** can be tuned per event type.
A customer might want instant email when a user is invited, daily
digest for customer updates, and no email for role changes. The
administrator sets defaults, and users can override them individually
in their profile. If a customer's notification volume is too high,
the administrator can switch from instant to daily or weekly digests,
which batches multiple events into one email. Digest emails arrive
at 8:00 AM CT by default; the customer cannot change the send time.

**Email deliverability** depends on the SPF and DKIM records being
correct. If emails from the portal are being marked as spam or
bounced by the customer's email system, the issue is almost always
DNS misconfiguration. The customer's IT team and Northwind
engineering need to collaborate to verify the records. Until they are
correct, emails may be delayed or rejected. This is the most common
source of complaints about portal notifications not arriving.

**Branding and white-label** considerations affect how customers
perceive the portal. A fully branded portal with a custom logo, color,
domain, and email sender feels like the customer's own product, not a
third-party tool. This improves adoption and user satisfaction. Some
customers request more extensive white-labeling, such as a custom
favicon or custom footer text; these are feature requests and not
currently supported in Meridian core.

**Mobile and responsive branding** adapts your branding choices to
different screen sizes. The logo and color are scaled appropriately
on mobile devices, tablet, and desktop. If you choose a very bright
or saturated accent color, it may be hard to read on some devices;
test your color choice in both light and dark modes before
finalizing. Portal administrators can preview branding changes in a
live preview pane in Settings before saving.

**Domain ownership verification** for custom domains requires the
customer's IT team to add a DNS CNAME record. This proves they own
the domain. Meridian does not ask for DNS proof; the CNAME is
sufficient because only the domain owner can add a CNAME record in
their DNS. If a customer tries to use a domain they do not own, the
DNS record will not exist and Meridian's SSL certificate provisioning
will fail with a message like "Domain verification failed. Check your
DNS configuration." Escalate if the customer claims they own the
domain but cannot add DNS records; that usually indicates they need
to request access from their DNS administrator or domain registrar.

**Email configuration and relay** for custom sending domains uses
Northwind's mail infrastructure. The customer does not run their own
mail server; instead, Northwind sends email on their behalf using
their domain. This requires SPF, DKIM, and sometimes DMARC
configuration. Most customers' IT teams are familiar with these
standards from managing their own corporate email. If the customer is
not sure how to set up SPF or DKIM, Northwind engineering provides
exact DNS records to add; the customer's IT team just copies them in.
Once DNS is live, test by sending a test email from the portal and
checking that it arrives and is not marked as spam.

## Audit Log and Session Controls

The audit log records all administrative actions in the portal:
user role changes, permission updates, configuration changes, and
data exports. Session controls let the portal owner set idle timeout
thresholds and manage active user sessions. This section covers what
the audit log records, how long it is retained, how to export it,
and session controls.

**What the audit log records** includes all changes to portal users,
roles, and settings. Specifically, the log captures: when a user is
created, invited, or deleted; when a user's role changes or email
address is updated; when SSO or branding settings are modified;
when notification templates or digests are changed; when permissions
are granted or revoked for external collaborators; when the portal
owner manually exports data or audit logs; and when login attempts
are made (successful and failed). The audit log does NOT record
everyday user actions like viewing customer records, submitting a
ticket, or generating a report. It is an admin action log, not a
user activity log.

Each audit log entry includes a timestamp, the user who performed
the action, the action type, the affected resource (for example, the
user's name and email if a role change), the old value and the new
value (where applicable), and a human-readable description. For role
changes, the log shows "Role changed from Agent to Administrator" or
"User deleted: sarah.chen@acmecorp.example". The timestamp is in the
portal's configured time zone.

**Retention and export** of audit logs follows Northwind's canonical
log retention policy. All audit log entries are retained and remain
searchable and exportable according to the System Log Retention Policy,
which governs the lifecycle of all administrative logs. When you need to
export audit logs, the portal owner or administrator can choose a date
range and download the results as a CSV file. The file includes all
fields: timestamp, user, action, resource, old value, new value, and
description. Export is instantaneous for queries under 30 days; larger
exports may take a few minutes and are emailed to the requester. The
retention periods and data lifecycle are documented in the System Log
Retention Policy to ensure compliance with legal, regulatory, and
business requirements.

**Search and filter** the audit log by date range, user, action type,
or resource. In the Settings Audit section, you can search for all
role changes made in the past month, or all actions taken by a
specific administrator. Filtering helps you investigate specific
incidents or questions: "Who created the external collaborator
account?" or "When was SSO enabled?". Audit log access depends on
role: portal owners see the full log going back 7 years;
administrators see only the past 30 days; agents and read-only
viewers cannot access the audit log at all.

**Session controls** let the portal owner set the idle timeout for
all users and view or terminate active sessions. The idle session
timeout setting is called `meridian.session.idle_timeout_minutes`,
which defaults to 30 minutes and can be set to a maximum of 480
minutes (8 hours). This means if a user is inactive for 30 minutes
(the default), their session expires and they are automatically
logged out. The next time they try to interact with the portal, they
are prompted to sign in again. Idle time is measured from the last
action: a page navigation, a button click, or a form submission. A
user passively viewing a page without interacting does not reset the
timer.

Some customers, especially those in regulated industries, request a
lower idle timeout for security. If your customer's security team
asks for 15 minutes or 10 minutes, you can set that. Set the minimum
to at least 5 minutes to avoid excessive logout spam. The 480-minute
(8-hour) maximum is hardcoded; you cannot exceed it. Setting the
timeout to the maximum (480 minutes) is unwise for security and is
flagged in the portal UI as a warning. Most customers use 30 minutes
(the default) or lower it to 15 minutes. Note that idle timeout
applies to all users equally; you cannot set it per-user or per-role.

**Active sessions** shows all currently logged-in users, the time
they signed in, their IP address, their browser type, and the time
of their last activity. The portal owner can view active sessions in
the Session Management section of Settings. From there, the owner
can terminate a session immediately (logging that user out) or set
an expiration time for future sessions from a specific IP address
(for security hardening after a suspected breach). Terminating a
session logs the user out within seconds; the next page navigation
or action they attempt shows a "session expired" message and
redirects them to the login page. This is useful if a user's device
is lost or stolen or if you need to revoke access immediately.

**Login attempts** are logged and appear in the audit trail. A failed
login attempt (wrong password, unknown user, or SSO assertion
rejected) is recorded with the IP address and attempted email. Three
failed logins from the same IP within 5 minutes triggers a temporary
lockout lasting 10 minutes; the user is told "Too many failed
attempts. Try again in 10 minutes." This throttling prevents
brute-force attacks. Successful logins are also logged. Analyzing
login attempts helps detect compromised accounts (many failed logins
from unusual IP addresses) or misconfigured SSO (repeated assertion
rejections).

**Session cookies** and token expiration are managed by Meridian
automatically. When a user signs in, Meridian issues a secure,
httponly cookie (or, for API clients, a bearer token) that remains
valid until the idle timeout is reached or the user signs out
explicitly. Cookies do not persist across browser restarts unless the
user checks "Remember me" during login; in that case, the cookie is
set to expire in 30 days. Users on shared computers should never
check this box. Session tokens are not exposed in logs or audit
trails; only the presence of a valid session is logged. When a
session expires due to idle timeout, the cookie or token is marked
invalid; Meridian still keeps the record of when it was issued and
expired in audit logs.

**Compliance and review** of audit logs is part of regular security
and compliance practices. Many customers need to export audit logs for
their own compliance audits or SOC 2 reviews. Northwind's compliance
team reviews Meridian audit logs quarterly as part of internal audits to
ensure administrative actions are logged correctly and no unauthorized
changes have occurred. If a customer requests their audit log as part of
a data subject access request (DSAR), you can export it from the portal
and provide it within the timeframe specified by applicable privacy
regulations. The audit trail is essential for demonstrating compliance
and responding to regulatory inquiries or auditor questions.

**Interpreting audit log entries** requires understanding context.
An entry "Role changed from Read-Only Viewer to Administrator for
jason.kim@acmecorp.example" is straightforward. An entry "User
deleted: alex.rodriguez@acmecorp.example" indicates the account was
removed entirely; use this to confirm action when a customer reports
someone has left. An entry "SSO configuration updated" is logged when
the portal owner modifies any SSO setting, including group mappings,
IdP metadata, or attribute mappings. If a customer reports unexpected
SSO behavior, check the audit log to see when and what was last
changed. If the last change was weeks ago and behavior only recently
broke, the issue is likely on the IdP side.

**Session termination and forced logout** is useful in security
incidents. If a customer suspects an account has been compromised,
the portal owner can terminate all active sessions for that user from
the Active Sessions page. The user is logged out immediately on the
next page interaction. New login attempts require the user to
reauthenticate, either via SSO or password. This is effective for
stopping unauthorized access but does not change the user's password
or reset their MFA (if applicable). If SSO is in use, terminating the
Meridian session does not log the user out of their corporate SSO
session; they can sign right back in. Coordinate with the customer's
IT team if you need full session termination including corporate SSO.

**IP address restrictions and geographic controls** are not built
into Meridian's session management. Some customers request the
ability to restrict sign-in to specific IP ranges or geographic
regions. This is not currently available; recommend that the
customer use their SSO provider to apply these controls if needed.
Many enterprise identity providers (Sentri, Nimbus AD, etc.) offer
conditional access or network policies that block sign-in from
unknown locations.

**Session hijacking and token theft** are guarded against by
Meridian's use of secure, httponly cookies and short-lived tokens.
Tokens expire after the configured idle timeout, and expired tokens
cannot be refreshed or reused under any circumstances. If a token is
stolen, an attacker can use it until expiration but cannot extend its
life or obtain a new token without valid credentials. The audit log does
not record token issuance or theft; only successful and failed logins are
logged to the audit trail. If a customer suspects token theft, ask them
to terminate all active sessions for the affected user immediately and
force a password reset or SSO reauthentication to ensure the attacker
cannot regain access.
