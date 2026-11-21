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
| Field app | Charts a person opened (24 hours, with their timeline and last three visits), unsynced work, a person's draft notes until finished (at most 7 days untouched), a visit's position when the person taps Use my location, the team's patient list for offline search (no legal names; field roles only; 7 days) | SQLCipher, keystore-held key, auto-lock, deletion at sign-out, remote wipe | |
| The phone's clipboard (phase 4) | Text a person copies or cuts in a box that takes a patient's details or a note's text | A private clip: local-only on iOS, cleared after 60 seconds; on Android marked sensitive (honoured from Android 13), cleared after 60 seconds while the app is in front, otherwise when it is back in front, and never if Android ends the app first; neither platform's native side is tested here; no Share, Search Web or Look Up in the box's menu. A soft keyboard's own Copy writes a plain clip (threat 17) | |
| Portal | Nothing at rest | no-store, in-memory only | |
| Identity provider | Names, emails of staff (not patients) | MFA | |

Of the phone's own permissions, the field app asks for location (phase 4), and only when the person taps Use my location on a new visit, while the app is in use, never in the background; the location plugin's own service is removed from the build (the merged Android manifest is still to be checked in CI's Android build). On iOS it also asks for Face ID, to unlock.

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
| 16 | A visit's position tells where a patient or a worker was, and on Android it comes from Google Play services | | | Asked only on the tap, while the app is in use, never in the background, the plugin's location service removed from the build; one fix, kept with the visit as the phone gives it, never shown as coordinates or written to a log; the place can be typed instead. On Android the fix comes from Google's fused provider wherever Play services is on the phone, and the team's device policy decides whether Google's location accuracy is on; the Play services libraries are outside the lockfile's vulnerability scan (plan risk 9) | Counsel and the team decide how exact (lifecycle 12.1 #15); the security questionnaire and counsel decide whether Google's location service may answer (#32) | | |
| 17 | A keyboard's own Copy puts a note's text or a patient's details on the plain clipboard, where the keyboard's clipboard history, the system's copy preview and other apps can keep it | | | A box's selection menu and a hardware keyboard's shortcuts copy only through the private clip (D126); the box offers no Share, Search Web or Look Up. Not covered: an Android soft keyboard's own Copy or Cut (Gboard's text editing panel), handled inside Flutter's Android embedding, and perhaps an iOS edit action from outside the app (an iPad keyboard's shortcut bar), unchecked on a device (plan risk 10) | Before real PHI: team phones under device management, with a managed keyboard whose clipboard history is off, or a work profile, which keeps the clipboard from personal apps; check both platforms on a device in phase 11; the project lead decides the device policy before phase 12, with a hook into the embedding if Flutter offers one by then | | |
| 18 | A Program Admin's credential has no route meant for changing it after appointment, so one whose licence lapses signs and attests under it until an owner acts | | | Only platform owners appoint Program Admins; the team's credential route refuses a Program Admin's membership to anyone but an owner, whom it reaches only as an active member of the team with `team.manage_users` (an owner can make themselves one by appointing themselves Program Admin, which gives them the team's patient data), and logs each change with its reason (`services/api/test/foundation.test.ts` holds this: a Program Admin who is not an owner is refused on another Program Admin's credential and on their own, and nothing changes; an owner outside the team is refused; an owner who is a member with `team.manage_users` changes it, logged with its reason); an owner can remove a Program Admin in the owner console, with a reason, at once unless they are the team's last (then once another is appointed), and appoint them again with the credential they now hold, both logged, the appointment without a reason; every signature records the credential it was made under, from the membership history (D58) | The project lead decides; recommended: an owner-console route to change it, with a recent sign-in, a reason and its audit event, and another Program Admin of the team may lower it but never raise it (`IMPLEMENTATION_PLAN.md` section 6) | | |

## 3. Decisions and sign-off

- Accepted risks and why:
- Remediation plan with dates:
- Signed (security official):
