# HIPAA Security Rule: technical safeguards mapped to code

Sineobex is a business associate of each customer team. This page maps the Security Rule's technical safeguards (45 CFR §164.312) and the parts of the administrative and physical safeguards that software can support to where they are implemented. It is evidence for the risk analysis and for procurement questionnaires, not a legal opinion; counsel confirms the open items.

Status: **Done** = implemented and tested in this repository. **Partial** = implemented with a stated gap. **Planned** = phase named. **People** = needs a person, a contract or an account.

## §164.312 Technical safeguards

| Standard | Requirement | Implementation | Status |
|---|---|---|---|
| (a)(1) Access control | Allow access only to authorized persons | Every API call verifies an OIDC token, resolves the user's active team membership, and checks role permission and clinical credential before touching data (`services/api/src/auth/`). Row-level security on team-scoped tables is a second line (`db/migrations/`). | Planned, phase 1 |
| (a)(2)(i) Unique user identification | Required | One identity per person in the OIDC provider (Supabase Auth, then Cognito); no shared logins; owner registry uses named IAM identities. | Planned, phase 1 |
| (a)(2)(ii) Emergency access procedure | Required | Platform owners can appoint a replacement Program Admin; procedure in the access policy. | People |
| (a)(2)(iii) Automatic logoff | Addressable | Portal: 15-minute idle sign-out. Phone: team-set auto-lock (default 5 min). | Planned, phases 1–2 |
| (a)(2)(iv) Encryption and decryption | Addressable | Phone: SQLCipher (AES-256) with a per-user key in the platform keystore. Server: RDS and S3 encrypted with KMS. Portal: no PHI at rest. | Planned, phases 2 and 12 |
| (b) Audit controls | Required | Hash-chained, append-only audit table written in the same transaction as each action; chain heads anchored in S3 Object Lock; admin audit dashboard. CloudTrail covers the AWS layer. | Planned, phases 1, 12 |
| (c)(1) Integrity | Protect from improper alteration or destruction | Signed notes change only through addenda and corrections that keep the old value; every synced value and photo is confirmed by SHA-256 before the phone deletes it. | Planned, phases 2, 4, 8 |
| (c)(2) Mechanism to authenticate ePHI | Addressable | Hash chain verification (`sineobex.verify_audit_chain`); receipt hashes on sync. | Planned, phases 1–2 |
| (d) Person or entity authentication | Required | MFA by authenticator app or passkey (no SMS); MFA-level token required for admin and Billing/Data actions; re-authentication before exports; device registration key for quarantine uploads. | Planned, phases 1–2 |
| (e)(1) Transmission security | Guard against unauthorized access in transit | TLS only. API sends HSTS; Android forbids cleartext and user-installed CAs; S3 policies deny non-TLS. | Partial: API headers and Android config done (phase 0); S3 in phase 12 |
| (e)(2)(ii) Encryption in transit | Addressable | As above. | Partial |

## Supporting controls (§164.308, §164.310)

| Requirement | Implementation | Status |
|---|---|---|
| §164.308(a)(1)(ii)(A) Risk analysis | Template in `risk-analysis.md` | People |
| §164.308(a)(1)(ii)(D) Information system activity review | Audit dashboard with unusual-access flags (charts off-route, bulk exports, off-hours, search bursts) | Planned |
| §164.308(a)(3) Workforce security, termination | Removing a user disables sign-in, rejects their tokens at the API at once, and wipes their phone at next contact | Planned, phases 1–2 |
| §164.308(a)(4) Information access management | Roles per team, least privilege, sensitive sections behind an extra permission, Billing/Data view-only | Planned, phase 1 |
| §164.308(a)(5)(ii)(C) Log-in monitoring | Sign-in events in the audit log | Planned, phase 1 |
| §164.308(a)(7) Contingency plan, data backup | RDS automated backups with a tested restore (phase 12 done-when) | Planned, phase 12 |
| §164.310(d)(1) Device and media controls | Remote wipe; 10 wrong PINs destroy the key; no backups of app data (Android `allowBackup=false`, data extraction rules) | Partial: backup exclusion done (phase 0) |
| §164.314 Business associate contracts | AWS BAA before real data; click-through BAA per customer organization; custom BAAs recorded by owners | People |

## Privacy Rule touchpoints

| Requirement | Implementation | Status |
|---|---|---|
| §164.502(b) Minimum necessary | Phone search index holds identifying fields and allergies only; route cache expires after 24 hours | Planned, phases 2–3 |
| §164.526 Right to amend | Patient amendment requests use the correction path with request and decision logged | Planned, phase 4 |
| §164.528 Accounting of disclosures | Exports are logged with who, what and when | Planned, phase 10 |

## Not HIPAA, but in the same evidence pack

- **42 CFR Part 2:** substance use treatment records may need stricter handling. Sensitive modules sit behind a separate permission. Counsel decides whether Part 2 applies.
- **WCAG 2.2 AA / ADA Title II / HHS §504:** see `accessibility.md`.
