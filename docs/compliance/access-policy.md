# Access policy: who sees what, and why

This page states which role may see and do what with patient records, and the minimum-necessary reason for each (45 CFR §164.502(b), §164.514(d)). It describes what the software enforces as of phase 3 (patients), and what phase 4 (encounters, in build) enforces so far: the sync of visits, notes, signatures, addenda, corrections and referrals, marked "phase 4" below. It is evidence for the risk analysis and for procurement questionnaires, not a legal opinion; counsel confirms the items marked **People**.

The rules are enforced in the API on every request (`services/api/src/auth/`), never only by hiding a screen. Row-level security in the database is the second line. Every refusal is written to the audit log. A request for a team the person is not an active member of, or for a suspended team, is refused before any of that team's data is touched, and logged in the platform chain, which only platform owners read, so no team's log carries what an outsider tried; the entry names the rule, the route's pattern and the team, never a patient (phase 4, `7f12515`). If the entry can't be written, the request fails.

## 1. Roles

Each team has four standard roles and may add custom roles built from the same fixed permission list (23 permissions; phase 3 added none). A person has one role per team. Program Admins are appointed only by platform owners.

| Can | Program Admin | Logistics | Healthcare Staff | Billing/Data | CHW preset |
|---|---|---|---|---|---|
| Search and read charts (`patients.view`) | Yes | Yes | Yes | Yes | Yes |
| Register patients and edit demographics (`patients.edit`) | Yes | Yes | Yes | No | Yes |
| Hold the team's patient list on a phone | Yes | Yes | Yes | No | Yes |
| See sensitive details (`patients.view_sensitive`) | Yes | Yes | Yes | No | No |
| See the problem list | Yes | Yes | Yes | Yes (codes, for billing) | No |
| Add and change problems and notes (`encounters.chart`) | Yes | Yes | Yes | No | No |
| Move a problem from Resolved back to Ongoing (`patients.reverse_resolved`) | Yes | No | No | No | No |
| Review possible duplicates (`patients.review_duplicates`) | Yes | By a custom role | By a custom role | No | No |
| Undo a merge; correct a legal name or date of birth (`patients.correct_identity`) | Yes | No | No | No | No |
| Make a referral, and take back one's own (`referrals.create`; phase 4) | Yes | Yes | Yes | No | Yes |
| Take back anyone's referral (`referrals.create` and `encounters.chart`; phase 4) | Yes | Yes | Yes | No | No |

The CHW preset is a custom role a team can create for community health workers: demographics, check-ins and referrals, no clinical notes.

A permission is not always enough to change a note (phase 4). A change to a Medical note needs a clinical credential that charts Medical, and an answer in a medication section one that orders medications, read from the person's membership when the change arrives: a credential lowered while the phone was offline holds the change for a Program Admin. Only whoever acts as a note's author completes, signs, reopens or corrects it; anyone else's attempt is stored and changes nothing. Whoever acts as the author is the note's writer, or the clinician a Program Admin assigned after the writer left the team.

## 2. What each role sees of a chart

One function decides what a role receives, for every read (`services/api/src/patients/projection.ts`). A part a role may not see is absent from the answer, never blanked on the screen.

| Part of the chart | Program Admin | Logistics | Healthcare Staff | Billing/Data | CHW preset |
|---|---|---|---|---|---|
| Names, date of birth, description, usual area, living situation, language, last seen | Yes | Yes | Yes | Yes | Yes |
| Allergies, consent records, open reviews, possible-duplicate hint | Yes | Yes | Yes | Yes | Yes |
| Whether the person has an ID card | Yes | Yes | Yes | Yes | Yes |
| The ID card's link (Show link, Copy) | Yes | Yes | Yes | No | Yes |
| Problems: title, code, status, history, notes | Yes | Yes | Yes | Yes | No |
| Sensitive problems | Yes | Yes | Yes | No | No |

A role searches only by what it may see. A sensitive problem a role may not see answers exactly as a problem that doesn't exist.

Four actions answer with a chart's values, so each also requires `patients.view`: the duplicate check at intake, the list of field reviews, a field review's decision, and an identity correction. A custom role holding an edit permission without `patients.view` is refused, and the refusal is logged.

**Notes, as a phone reads them through sync (phase 4).** A visit, its notes and what hangs off a note (signatures, addenda, corrections) need `encounters.chart`; a referral needs `patients.view`. One function decides what a reader receives of a note (`visibleAnswers`, `packages/forms`), and the API runs every note through it:

| Part of a note | Program Admin | Logistics | Healthcare Staff | Billing/Data | CHW preset |
|---|---|---|---|---|---|
| A visit and its notes at all | Yes | Yes | Yes | No | No |
| A Medical note, a Medical visit's summary and the addenda to it (`patients.view` with `encounters.chart` or `billing.view_codes`, as the problem list) | Yes | Yes | Yes | No | No |
| Behavioral health, harm reduction, and sexual and reproductive health notes (`patients.view_sensitive`) | Yes | Yes | Yes | No | No |
| The substance use treatment part of a harm reduction note (`patients.view_sensitive` and a clinical credential) | With a clinical credential | With a clinical credential | With a clinical credential | No | No |
| GU, breast and rectal exam findings (`patients.view_sensitive_exams`) | Yes | No | No | No | No |
| A diagnosis on the sensitive list, picked in a note, with its entry or section (`patients.view_sensitive`) | Yes | Yes | Yes | No | No |

Whoever acts as a note's author sees all of it, whatever their role: a clinician must be able to read what they wrote. Anything else a reader may not see is absent, not blanked: no value, no version, no mark of who changed it, and a note's version and time follow only what the reader is shown. A note the reader may not read is reported missing, with its signatures, addenda and corrections. A correction is missing when its old or new value would show something hidden. A signature's content hash goes only to the note's author, its signer, and a reader who holds every one of these keys and a clinical credential, since a hash could confirm a guess of a hidden answer. A change that would touch or reveal something its sender may not see is held for a Program Admin, and nothing of what the note holds is sent back. The review queue shows a held change's value only to a reviewer who may read it by the same rules; to anyone else the item says only that it is held.

## 3. Minimum-necessary reasons

**Logistics sees sensitive details, including pregnancy.** Logistics builds each route, ranks its patients by both flag tiers (the second tier marks conditions such as pregnancy and frost risk), stocks the bags for the people on it, and may be on the route team. They already meet these patients on the street. Without these details a route would be ranked and stocked without the conditions that decide its order and supplies. (PRD, Oct 19. **People:** counsel confirms.)

**Billing/Data sees charts and problem codes, never sensitive details and never the phone's patient list.** The role's job is the chart's codes, supply logs and exports, done in the portal. It has no reason to carry the team's patients on a phone, so it never receives the offline list, and sensitive problems are left out of everything it reads.

**The CHW preset sees no problem list.** The preset covers demographics, check-ins and referrals. Clinical problems aren't needed for those.

**Only a Program Admin corrects a legal name or date of birth, and only with a reason.** These identify the person in billing and in the duplicate check. Field staff may fill a blank one when the patient gives it. Changing a recorded one is a logged correction, and it needs a recent sign-in.

**Substance use treatment records** stay behind `patients.view_sensitive` until counsel decides whether 42 CFR Part 2 applies. (**People.**) In a note (phase 4), the treatment part of a harm reduction note also needs a clinical credential, so Logistics, which holds `patients.view_sensitive` to build routes, does not read it without one.

**GU, breast and rectal exam findings are read only with `patients.view_sensitive_exams`** (phase 4), which among the standard roles only the Program Admin holds, and by whoever acts as the note's author. The PRD says these exams "need an extra permission to view". A team whose attendings co-sign or attest such notes gives them a custom role with it. (**People:** counsel, Brooke and Mercy, lifecycle 12.1 #13.)

## 4. Patient data on a phone

A phone holds the least that field work needs, encrypted, and for a limited time.

| What | Who | How long | Notes |
|---|---|---|---|
| The team's patient list for offline search: preferred name, street names, description, date or year of birth, usual area, last seen, allergies | Roles that may view patients and also register, chart or check in (so never Billing/Data) | 7 days from its last refresh; deleted at sign-out and when the role loses it | No legal name, and nothing derived from one. No problems, notes, consents or ID card links. A reviewer's free-text note on a possible duplicate is never in it |
| Full charts a person opened or is working on | The person who opened them | 24 hours after opening; kept longer only while that person's unsynced work needs them | A legal name appears only here |
| Unsynced work | The person who made it | Until the server confirms it by hash | Never deleted by "Log out anyway" |
| An intake left unfinished | The person who started it | Until it is created or discarded | Never holds a legal name. Nothing is kept for a person who declined |

A lost phone is covered by the PIN, the encrypted database, the 7-day expiry and remote wipe (see `hipaa-security-rule.md`, §164.310(d)(1)).

A note reaches a phone through the same read rules as everywhere else (section 2, phase 4): a teammate's note opened to help holds only the answers that person may see. Whoever acts as the author of a draft is sent all of it, so an answer a condition hides comes back when its field shows again.

## 5. What is logged

Every search, duplicate check, chart view, history view, ID card read, queue view, merge, undo and correction is written to the audit log in the same database transaction as the action, with who, when and which patients were shown. A read that can't be logged is refused. Search text is never stored. Reads made offline are logged on the phone and join the audit log at the next sync. The audit log can be searched by patient, including records since merged into that patient.

Phase 4 adds, so far: every signature, addendum, correction, declined amendment request, reopen, referral, and change kept in a finished note's history writes its event in the same transaction, naming the note or the patient and the fields, never an answer, a summary, an addendum's text, a reason's text or a referral's details. Each visit, note, signature, addendum, correction and referral a phone reads through sync is logged as a view of its note or patient. A phone logs the EMS handoff it shows and its Notes to finish list offline.

## 6. Emergency access

If a team's Program Admins are unavailable, a platform owner appoints a replacement Program Admin for that team. The appointment is logged. There is no shared or break-glass account. (**People:** the owners' written procedure, and who the owners are.)

## 7. Open items for people

- Counsel: the Logistics reason above; whether 42 CFR Part 2 applies; which diagnosis codes count as sensitive (default: F01–F99, O00–O9A, Z30–Z39, B20, Z21, A50–A64, Z71.4x).
- Each customer team: its own access policy naming who holds each role. This page describes what the software enforces; the team's policy says who and why for its own staff.
- A team can't keep the phone's patient list from a role that registers or charts patients. A team setting can add that later without a new permission.
- The team (phase 4): whether a reviewer who may not read a held change may still accept it. Today they can, though the queue shows them nothing of it.
