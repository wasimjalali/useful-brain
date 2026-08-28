---
document_id: nw_legal_data_retention
title: Data Retention Policy
source_name: Northwind Legal Data Retention Policy
source_path: northwind/legal/data-retention-policy.md
department: legal
access_scope: public
allowed_roles: []
allowed_departments: []
version: "2.5"
effective_date: "2026-02-01"
---

# Data Retention Policy

## Purpose and Scope

This policy defines how long Northwind Systems keeps records and data,
and what happens when retention periods end. It applies to company
records in every form: paper, email, files, databases, and backups. The
policy is owned by legal, and the General Counsel, Amelia Brooks, is
the final decision maker on retention questions. The retention periods
here are the company's minimums and maximums; where a law requires a
different period, the law wins. System logs have their own schedule in
the System Log Retention Policy, which is a different document with
different periods, and questions about logs should go to engineering,
not legal.

## Financial and Contract Records

Invoices, credit notes, payment records, and contracts are kept for
seven years after the record's end event. For invoices and credit
notes, the seven years run from the invoice date; for contracts
(including customer agreements, vendor agreements, and partnership
agreements), the seven years run from the end of the contract, not
from signing. After seven years, these records are archived to cold
storage for a further three years (years 8 through 10) before deletion,
because audits occasionally reach back. The archive is searchable only
by finance and legal. Contract files are stored with the contract code
(CT-####) and are the reference set for the Contract Review and
Approval Policy.

## HR Records

HR records are kept for six years after employment ends. This covers
personnel files, performance reviews, leave records, disciplinary
records, and termination records. Exit interview notes are the
exception: they are kept for two years, per the Termination and
Offboarding Policy. Payroll records follow the financial seven-year
period because they are financial records. HR records are stored in the
HR system and access is limited to the HR department, per the Salary
Bands document's data handling rules. After six years, HR records are
deleted in bulk twice a year (January and July), and the deletion is
logged.

## Customer Data

Customer data (data customers store in Northwind Core, Atlas, and
Meridian, plus customer personal data we process) is retained for the
life of the contract plus 90 days. The 90 days give the customer time
to export their data after the contract ends; after that, customer data
is deleted from production, and backups expire on their normal
schedule. A customer can ask for earlier deletion at any time through
the Customer Data Access Requests process, and deletion requests are
completed within 30 days. Customer data is not retained for longer
periods even if the account is unpaid; the 45-day suspension process in
the Invoicing and Payment Terms Policy does not pause the retention
clock. The Privacy Policy describes what we do with customer personal
data specifically.

## Marketing and Prospect Data

Prospect and marketing contact data is kept for 24 months after the
last interaction with the prospect (last email open, last meeting, or
last website visit that identifies them). After 24 months of no
interaction, prospect records are deleted or anonymized in the marketing
system. Opt-outs are permanent and are honored regardless of the
24-month period. This data is separate from customer data: a prospect
who becomes a customer moves to customer data rules, and the 24-month
clock stops. Sales territories and account assignments are company
records, not prospect data, and follow the contract record rules where
they are part of a signed agreement.

## Deletion and Destruction

Deletion means the data is removed from production systems and from
backups no later than the next backup cycle after the retention period
ends. Backups are not exempt from retention: a backup containing data
past its retention period is deleted at the next scheduled rotation,
which means real deletion can lag by up to 30 days. Paper records are
shredded by the facilities team; digital records are deleted with a
deletion log that records the record type, the volume, and the date.
Deletion logs are kept for three years. Data that is subject to a legal
hold (litigation hold or investigation hold) is exempt from deletion
until the hold is lifted by legal, and the hold is registered in the
legal system with a hold code (HLD-####).

## Enforcement and Audits

Departments own their retention schedules: finance owns financial
records, HR owns HR records, and support owns customer data deletion
after offboarding. Legal audits retention compliance quarterly, and the
findings feed the April and October SOC 2 audits in the Regulatory
Compliance Calendar. A department that fails to delete on schedule is
given 30 days to remediate; repeated failures are reported to the CFO
and the CHRO. Retention questions from customers go through support and
are answered with reference to this policy and the Privacy Policy.
Employees who deliberately destroy records before their retention
period ends face discipline under the Termination and Offboarding
Policy, and the IP and Confidentiality Policy's obligations continue
after employment ends.
