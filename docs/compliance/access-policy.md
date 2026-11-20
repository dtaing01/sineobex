# Access policy: who sees what, and why

This page states which role may see and do what with patient records, and the minimum-necessary reason for each (45 CFR §164.502(b), §164.514(d)). It describes what the software enforces as of phase 3 (patients), and what phase 4 (encounters, in build) enforces so far: the sync of visits, notes, signatures, addenda, corrections and referrals, and the online routes that read a visit and a chart's timeline, co-sign and attest notes, list the notes that wait, assign a departed author's note and export the EMS handoff, with the portal's pages and the phone's screens that show and do these, marked "phase 4" below. It is evidence for the risk analysis and for procurement questionnaires, not a legal opinion; counsel confirms the items marked **People**.

The rules are enforced in the API on every request (`services/api/src/auth/`), never only by hiding a screen. Row-level security in the database is the second line. Every refusal of access is written to the audit log. A request for a fresh sign-in, which admin actions and exports need, refuses no access and is not logged; nor is an answer about a record's state, input that can't be taken, or a record the team doesn't have. A request for a team the person is not an active member of, or for a suspended team, is refused before any of that team's data is touched, and logged in the platform chain, which only platform owners read, so no team's log carries what an outsider tried; the entry names the rule, the route's pattern and the team, never a patient (phase 4, `7f12515`). If the entry can't be written, the request fails.

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
| Read a visit and a chart's timeline, in the portal or on a phone, and the last three visits a phone's copy of a chart carries (`patients.view`; phase 4) | Yes | Yes | Yes | Yes | Yes |
| Co-sign a note that waits for a co-signer, and see that queue (`encounters.chart` and a credential that signs; phase 4) | With such a credential | With such a credential | With such a credential | No | No |
| Attest a signed note, and see that queue (`encounters.chart` and the attending credential; phase 4) | As an attending | As an attending | As an attending | No | No |
| See every draft of the team and who may take a departed author's note, and assign it to another clinician (`team.manage_users`; assigning needs a recent sign-in; phase 4) | Yes | No | No | No | No |
| Export a visit's EMS handoff as a PDF (`patients.view`, reading the visit's Red flags note, and a recent sign-in; phase 4) | Yes | Yes | Yes | Yes | No |

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
| A Medical note, a Medical visit's summary and the addenda to the visit itself (`patients.view` with `encounters.chart` or `billing.view_codes`, as the problem list) | Yes | Yes | Yes | No | No |
| Behavioral health, harm reduction, and sexual and reproductive health notes (`patients.view_sensitive`) | Yes | Yes | Yes | No | No |
| The substance use treatment part of a harm reduction note (`patients.view_sensitive` and a clinical credential) | With a clinical credential | With a clinical credential | With a clinical credential | No | No |
| GU, breast and rectal exam findings (`patients.view_sensitive_exams`) | Yes | No | No | No | No |
| A diagnosis on the sensitive list, picked in a note, with its entry or section (`patients.view_sensitive`) | Yes | Yes | Yes | No | No |

Whoever acts as a note's author sees all of it, whatever their role: a clinician must be able to read what they wrote. Anything else a reader may not see is absent, not blanked: no value, no version, no mark of who changed it, and a note's version and time follow only what the reader is shown. A note the reader may not read is reported missing, with its signatures, addenda and corrections. A correction is missing when its old or new value would show something hidden. A signature's content hash goes only to the note's author, its signer, and a reader who holds every one of these keys and a clinical credential, since a hash could confirm a guess of a hidden answer, and never to a reader from whom the visit's summary is withheld, since the hash covers it. A change that would touch or reveal something its sender may not see is held for a Program Admin, and nothing of what the note holds is sent back. The review queue shows a held change's value only to a reviewer who may read it by the same rules; to anyone else the item says only that it is held. A visit's status, and whether it holds a finished note (which locks its patient, place and summary, and which a phone reads to refuse such an edit before sending it), are worked out from the notes the reader may read, so neither says anything of a note left out. An edit of the patient, place or summary of a visit that holds a finished note is kept in the visit's history, not applied, and its sender is told: when they may not read that note, they learn that the visit holds a finished note, and nothing more (lifecycle 4.3, 4.8).

**Notes online (phase 4).** Reading a visit and a chart's timeline, and the last three visits a phone's copy of a chart carries, needs only `patients.view`, as the rest of the chart does, so Billing/Data and the CHW preset read online visits that sync never sends them. Every note still goes through the same function, and every row of the table above but its first holds: Billing/Data reads Medical notes and no sensitive note type; the CHW preset reads Non-Medical notes only, and of a Medical visit neither its summary nor its own addenda. The timeline lists each note by its type and state only, and a visit's state is worked out from the notes the reader is shown, so it says nothing of one left out. The portal's chart page shows the timeline alone and opens each visit on a page of its own, so a visit is read, and logged, only when someone opens it. The records made at a visit are shown as the chart shows them, so a role that sees no problem list sees no problem among them. The content hash a co-signature or an attestation needs goes, besides the readers above, to a reader who may co-sign or attest a note and sees all of it; such a reader learns from a missing hash that a note holds a part they may not see, which the queue of notes waiting for them already tells them. The queues list only notes the reader may read. The visit page and the queues say why a note waits for someone else; that it holds a part the reader can't open is said only to a reader whose credential may co-sign or attest it, whom the missing hash already tells. Who may take a departed author's note is decided from the note's type and each person's permissions, never from what the note holds, so the list of who may take it tells nothing of what is in the note. The team's list of notes not complete names no patient to a role without `patients.view`. The portal's pages show what these answers give and decide nothing themselves: the one rule they copy, which credentials sign and attest, only decides which queue links the navigation shows. The phone's visit screen does the same: online it reads the visit from the server first and offers Co-sign and Attest from that read's answer, and the phone's queues say why a note waits from the queue's own reason; a copy read from the phone or a chart only offers to read the visit from the server first, and the credential the phone saved only narrows what is offered. A queue's tile on the phone's Home shows online only when the server gives its number. Read offline or without an answer in time, the visit says that what others added since may be missing.

## 3. Minimum-necessary reasons

**Logistics sees sensitive details, including pregnancy.** Logistics builds each route, ranks its patients by both flag tiers (the second tier marks conditions such as pregnancy and frost risk), stocks the bags for the people on it, and may be on the route team. They already meet these patients on the street. Without these details a route would be ranked and stocked without the conditions that decide its order and supplies. (PRD, Oct 19. **People:** counsel confirms.)

**Billing/Data sees charts and problem codes, never sensitive details and never the phone's patient list.** The role's job is the chart's codes, supply logs and exports, done in the portal. It has no reason to carry the team's patients on a phone, so it never receives the offline list, and sensitive problems are left out of everything it reads.

**The CHW preset sees no problem list.** The preset covers demographics, check-ins and referrals. Clinical problems aren't needed for those.

**Only a Program Admin corrects a legal name or date of birth, and only with a reason.** These identify the person in billing and in the duplicate check. Field staff may fill a blank one when the patient gives it. Changing a recorded one is a logged correction, and it needs a recent sign-in.

**Substance use treatment records** stay behind `patients.view_sensitive` until counsel decides whether 42 CFR Part 2 applies. (**People.**) In a note (phase 4), the treatment part of a harm reduction note also needs a clinical credential, so Logistics, which holds `patients.view_sensitive` to build routes, does not read it without one.

**GU, breast and rectal exam findings are read only with `patients.view_sensitive_exams`** (phase 4), which among the standard roles only the Program Admin holds, and by whoever acts as the note's author. The PRD says these exams "need an extra permission to view". A team whose attendings co-sign or attest such notes gives them a custom role with it, and a departed author's note of a type that could hold such an exam is assigned only to someone who holds it, so without one it stays among the notes not complete. (**People:** counsel, Brooke and Mercy, lifecycle 12.1 #13; Brooke and Mercy, #31.)

**Anyone who may see a chart reads its visits** (phase 4). Reading a visit is reading the chart: a role that may see a chart reads what it may see of each visit, online and in a chart a phone keeps, by the same rules as everywhere else. Sync, which feeds editing, sends visits and notes only to a role that charts.

**The EMS handoff holds only what any exporter may send** (phase 4). The file leaves the team with the medic who takes the patient. It names the patient by preferred name, with their age and allergies, which the medic needs, and never by the legal name or the birth date. It holds no note of a sensitive type, no sensitive exam finding, no substance use treatment record and no sensitive diagnosis, whoever exports it, so what reaches EMS does not depend on who sends it, and nobody sends a file holding what they may not see. Whoever may read the visit's Red flags note may export it, with a fresh sign-in, and every page says who exported it and when. The phone's full-screen handoff, which the person shows the medic and which never leaves the phone, holds the same and is headed the same way, by the preferred name alone, never the description; whoever may read the Red flags note may show it, draft or finished, and each showing is logged with the read that shows it. (**People:** counsel and the team, lifecycle 12.1 #18; the clinical team and counsel, #27 and #29.)

## 4. Patient data on a phone

A phone holds the least that field work needs, encrypted, and for a limited time.

| What | Who | How long | Notes |
|---|---|---|---|
| The team's patient list for offline search: preferred name, street names, description, date or year of birth, usual area, last seen, allergies | Roles that may view patients and also register, chart or check in (so never Billing/Data) | 7 days from its last refresh; deleted at sign-out and when the role loses it | No legal name, and nothing derived from one. No problems, notes, consents or ID card links. A reviewer's free-text note on a possible duplicate is never in it |
| Full charts a person opened or is working on | The person who opened them | 24 hours after opening; kept longer only while that person's unsynced work needs them | A legal name appears only here |
| Unsynced work | The person who made it | Until the server confirms it by hash | Never deleted by "Log out anyway" |
| A draft note and its visit (phase 4) | Whoever acts as the note's author, and a teammate who opened it to help | Until it is finished and the server has confirmed it, or until nobody has changed it for 7 days, counted only by a clock the phone has checked, with nothing of it waiting; a Medical visit's finished notes stay while a note of it is a draft | So the author can complete it with no signal. It leaves only after a hash-confirmed receipt |
| An intake left unfinished | The person who started it | Until it is created or discarded | Never holds a legal name. Nothing is kept for a person who declined |
| A visit's position (phase 4) | Whoever taps Use my location on a new visit | With the visit, which leaves the phone as above | Taken only on the tap, one fix while the app is in use, never in the background, kept as the phone gives it and never shown as coordinates; the place can be typed instead. On Android the fix comes from Google Play services' location service wherever the phone has it, and the team's device policy decides whether Google's location accuracy is on (lifecycle 12.1 #15, #32) |

A lost phone is covered by the PIN, the encrypted database, the 7-day expiry and remote wipe (see `hipaa-security-rule.md`, §164.310(d)(1)).

A note reaches a phone through the same read rules as everywhere else (section 2, phase 4): a teammate's note opened to help holds only the answers that person may see. Whoever acts as the author of a draft is sent all of it, so an answer a condition hides comes back when its field shows again. The phone shows each person what the same rules let them see of what it holds: a note they may not read, a correction that would show something hidden, and a Medical visit's summary to a role that reads no Medical notes are left out, as on the server; the records made at a visit follow the chart's rules; and where two people changed a draft's answer, the note's form never shows someone who does not act as its author the other value of an answer that could hold what they may not see.

A full chart on a phone also carries its timeline and its last three visits, as the person could see them when the chart was fetched (phase 4). A change of their role or credential reaches these at the chart's next refresh; a phone offline keeps what it holds until it syncs, at most 24 hours, as for the rest of the chart.

## 5. What is logged

Every search, duplicate check, chart view, history view, ID card read, queue view, merge, undo and correction is written to the audit log in the same database transaction as the action, with who, when and which patients were shown. A read that can't be logged is refused. Search text is never stored. Reads made offline are logged on the phone and join the audit log at the next sync. The audit log can be searched by patient, including records since merged into that patient.

Phase 4 adds, so far: every signature, addendum, correction, declined amendment request, reopen, referral, and change kept in a finished note's history writes its event in the same transaction, naming the note or the patient and the fields, never an answer, a summary, an addendum's text, a reason's text or a referral's details. Each visit, note, signature, addendum, correction and referral a phone reads through sync is logged as a view of its visit, note or patient. A phone logs its own reads offline, each in the transaction that reads it: each visit, note, signature, addendum and correction it shows from its own copy or from a chart's last three visits, and each record made at a visit and each referral it lists, as a view of its visit, note or patient; its Notes to finish list, naming the patients shown; each visit that Needs attention's Choose a visit lists; and the EMS handoff it shows, in the transaction of the read that shows it. A visit the phone shows from the server's read is logged by the server, and the phone logs only what it adds of its own. A profile's timeline is part of the chart's logged read, and Home's counts name no patient: neither writes an event of its own.

Phase 4's online routes log, each in its own transaction: each visit, note, signature, addendum, correction, attestation and record made at a visit that a visit read, or the last three visits a phone's copy of a chart carries, show, as a view of its visit, note or patient (a chart the portal opens carries no visit in full, and logs none); a chart's earlier visits, the co-sign and attestation queues, and the lists of notes not complete, each as one view naming the patients shown; each list of who may take a departed author's note, as one view of the note, with no name in it; each co-signature, attestation and assignment, never an assignment's reason; and each EMS handoff export, with its patient and the notes in the file. Home's counts name no patient and write no event. A refusal of access is logged with the reason's name. The portal writes no event of its own: each of its pages reads and acts through these routes.

## 6. Emergency access

If a team's Program Admins are unavailable, a platform owner appoints a replacement Program Admin for that team. The appointment is logged. There is no shared or break-glass account. (**People:** the owners' written procedure, and who the owners are.)

## 7. Open items for people

- Counsel: the Logistics reason above; whether 42 CFR Part 2 applies; which diagnosis codes count as sensitive (default: F01–F99, O00–O9A, Z30–Z39, B20, Z21, A50–A64, Z71.4x).
- Each customer team: its own access policy naming who holds each role. This page describes what the software enforces; the team's policy says who and why for its own staff.
- A team can't keep the phone's patient list from a role that registers or charts patients. A team setting can add that later without a new permission.
- Counsel and the team (phase 4): who may export the EMS handoff; today, whoever may read the visit's Red flags note, Billing/Data included (lifecycle 12.1 #18).
- The clinical team and counsel (phase 4): what of the patient the EMS handoff's header carries (today the preferred name, age and allergies), and whether any note of a sensitive type or sensitive exam finding should reach EMS (today none does; lifecycle 12.1 #27 and #29).
- The clinical team (phase 4): whether a departed author's note of a type that could hold a sensitive exam, a treatment record or a sensitive diagnosis may go only to someone whose role sees each, so that it stays among the notes not complete while nobody active does (lifecycle 12.1 #31).
- Counsel and the team (phase 4): whether a visit's position is kept as exactly as the phone gives it (lifecycle 12.1 #15); the security questionnaire and counsel: whether Use my location may ask Google's location service, which it does on Android wherever Google Play services is on the phone (#32).
