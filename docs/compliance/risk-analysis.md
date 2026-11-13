# HIPAA security risk analysis (template)

The Security Rule requires an accurate and thorough assessment of risks to ePHI (45 CFR §164.308(a)(1)(ii)(A)), and it is the first document a health department asks for. This template follows the structure of the HHS/ONC Security Risk Assessment tool. A person completes it before the pilot and reviews it at least yearly and after any major change.

- **Prepared by:**
- **Date:**
- **Scope:** Sineobex pilot on AWS (API, database, object storage, portal, field app), the identity provider, and the people who operate them. The Supabase preview is out of scope because it must never hold ePHI; confirm that remains true.

## 1. Where ePHI lives and moves

| Location | What | Protection | Owner |
|---|---|---|---|
| RDS PostgreSQL | Charts, audit log | KMS encryption, private subnets, backups | |
| S3 (photos, documents) | Images, paperwork | KMS, block public access, TLS-only policy | |
| S3 Object Lock | Audit chain anchors | Compliance mode retention | |
| Field app | Charts a person opened (24 hours), unsynced work, the team's patient list for offline search (no legal names; field roles only; 7 days) | SQLCipher, keystore-held key, auto-lock, deletion at sign-out, remote wipe | |
| Portal | Nothing at rest | no-store, in-memory only | |
| Identity provider | Names, emails of staff (not patients) | MFA | |

## 2. Threats and vulnerabilities

For each, rate likelihood (low/medium/high) and impact (low/medium/high), list existing controls (see `hipaa-security-rule.md`) and decide on further action.

| # | Threat | Likelihood | Impact | Existing controls | Further action | Owner | Due |
|---|---|---|---|---|---|---|---|
| 1 | Lost or stolen phone | | | | | | |
| 2 | Staff member removed while offline | | | | | | |
| 3 | Compromised staff credentials | | | | | | |
| 4 | Insider browsing charts without need | | | | | | |
| 5 | Bulk export leaves the organization | | | | | | |
| 6 | Cloud misconfiguration exposes a bucket | | | | | | |
| 7 | Ransomware or deletion of the database | | | | | | |
| 8 | Sync bug deletes unconfirmed records | | | | | | |
| 9 | Vendor without a BAA receives PHI (maps, AI, crash reporting) | | | | | | |
| 10 | Patient data in logs or notifications | | | | | | |
| 11 | The team's patient list (names, descriptions, birth dates, allergies) is on every field phone | | | No legal names or anything derived from them; no ID card links; field roles only; encrypted with secure delete; 7-day expiry; deleted at sign-out and when a role loses it; remote wipe | | | |
| 12 | A team can't keep the patient list off a role that registers or charts patients | | | The list follows the role's existing permissions (no new permission types in the MVP) | A team setting, if a customer needs it | | |
| 13 | After a merge, two ID cards open one chart until a new card is made | | | Both cards are listed on the chart; the next new card retires both; undo gives each record its own card back | | | |
| 14 | A patient list up to 7 days old can miss a new allergy | | | Refreshed after each sync and every 15 minutes while unlocked; screens say when the list was updated | The phase 6 allergy hard stop must say which list it used | | |
| 15 | ID card tokens are stored unencrypted at the application layer | | | A token is a pointer, not a credential: opening a chart needs a signed-in member with MFA; KMS encryption at rest; tokens never in logs, URLs sent to a server, or audit rows | Decide on column encryption in phase 12 | | |

## 3. Decisions and sign-off

- Accepted risks and why:
- Remediation plan with dates:
- Signed (security official):
