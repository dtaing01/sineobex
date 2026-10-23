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
| Field app | Route cache, outbox, team search index | SQLCipher, keystore-held key, auto-lock, remote wipe | |
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

## 3. Decisions and sign-off

- Accepted risks and why:
- Remediation plan with dates:
- Signed (security official):
