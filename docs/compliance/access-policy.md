# Access policy: who sees what, and why

This page states which role may see and do what with patient records, and the minimum-necessary reason for each (45 CFR §164.502(b), §164.514(d)). It describes what the software enforces as of phase 3 (patients). It is evidence for the risk analysis and for procurement questionnaires, not a legal opinion; counsel confirms the items marked **People**.

The rules are enforced in the API on every request (`services/api/src/auth/`), never only by hiding a screen. Row-level security in the database is the second line. Every refusal is written to the audit log.

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

The CHW preset is a custom role a team can create for community health workers: demographics, check-ins and referrals, no clinical notes.

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

## 3. Minimum-necessary reasons

**Logistics sees sensitive details, including pregnancy.** Logistics builds each route, ranks its patients by both flag tiers (the second tier marks conditions such as pregnancy and frost risk), stocks the bags for the people on it, and may be on the route team. They already meet these patients on the street. Without these details a route would be ranked and stocked without the conditions that decide its order and supplies. (PRD, Oct 19. **People:** counsel confirms.)

**Billing/Data sees charts and problem codes, never sensitive details and never the phone's patient list.** The role's job is the chart's codes, supply logs and exports, done in the portal. It has no reason to carry the team's patients on a phone, so it never receives the offline list, and sensitive problems are left out of everything it reads.

**The CHW preset sees no problem list.** The preset covers demographics, check-ins and referrals. Clinical problems aren't needed for those.

**Only a Program Admin corrects a legal name or date of birth, and only with a reason.** These identify the person in billing and in the duplicate check. Field staff may fill a blank one when the patient gives it. Changing a recorded one is a logged correction, and it needs a recent sign-in.

**Substance use treatment records** stay behind `patients.view_sensitive` until counsel decides whether 42 CFR Part 2 applies. (**People.**)

## 4. Patient data on a phone

A phone holds the least that field work needs, encrypted, and for a limited time.

| What | Who | How long | Notes |
|---|---|---|---|
| The team's patient list for offline search: preferred name, street names, description, date or year of birth, usual area, last seen, allergies | Roles that may view patients and also register, chart or check in (so never Billing/Data) | 7 days from its last refresh; deleted at sign-out and when the role loses it | No legal name, and nothing derived from one. No problems, notes, consents or ID card links. A reviewer's free-text note on a possible duplicate is never in it |
| Full charts a person opened or is working on | The person who opened them | 24 hours after opening; kept longer only while that person's unsynced work needs them | A legal name appears only here |
| Unsynced work | The person who made it | Until the server confirms it by hash | Never deleted by "Log out anyway" |
| An intake left unfinished | The person who started it | Until it is created or discarded | Never holds a legal name. Nothing is kept for a person who declined |

A lost phone is covered by the PIN, the encrypted database, the 7-day expiry and remote wipe (see `hipaa-security-rule.md`, §164.310(d)(1)).

## 5. What is logged

Every search, duplicate check, chart view, history view, ID card read, queue view, merge, undo and correction is written to the audit log in the same database transaction as the action, with who, when and which patients were shown. A read that can't be logged is refused. Search text is never stored. Reads made offline are logged on the phone and join the audit log at the next sync. The audit log can be searched by patient, including records since merged into that patient.

## 6. Emergency access

If a team's Program Admins are unavailable, a platform owner appoints a replacement Program Admin for that team. The appointment is logged. There is no shared or break-glass account. (**People:** the owners' written procedure, and who the owners are.)

## 7. Open items for people

- Counsel: the Logistics reason above; whether 42 CFR Part 2 applies; which diagnosis codes count as sensitive (default: F01–F99, O00–O9A, Z30–Z39, B20, Z21, A50–A64, Z71.4x).
- Each customer team: its own access policy naming who holds each role. This page describes what the software enforces; the team's policy says who and why for its own staff.
- A team can't keep the phone's patient list from a role that registers or charts patients. A team setting can add that later without a new permission.
