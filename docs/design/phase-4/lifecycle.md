> **Reviewed (Nov 14), built (Nov 16 to 21), and reviewed as built.** Four reviewers checked this design and the forms part against the PRD, the code, the rules that never bend and the task-card rules; their 95 findings are applied. Every unit was reviewed as it landed, and the whole phase was then reviewed as built, with a second pass over the fixes (`docs/design/phase-4-encounters.md`, "What the review found"); each fix has a test that fails without it. Section 12 lists what a person still has to decide, and the sections marked "as built" say what the code does where it says more than the design did, or differs from it.

# Phase 4 design, part 2: the encounter lifecycle, sync and screens

Status: built and reviewed as a whole (Nov 21). Every unit of the phase is on the branch, and the whole-phase review's findings are fixed; section 1 still describes the code before this phase. The work-list was `docs/plan/phase-4-encounters/README.md`.

This part covers how an encounter is stored, saved, completed, signed, attested, corrected and
synced, and the screens around it. The other part (`docs/design/phase-4/forms.md`) covers the form
definitions, their generation from the field specification, the renderer and field validation.

Who builds from this, as planned: a small local model, one task card at a time
(`docs/plan/README.md`), with a frontier model or a person writing the tests for the safety-critical
cards first. So the judgment sits in a few places the small model does not write: the migrations,
the sync core, the phone store and the fake server (all level X), and a few small pure functions
that are written twice (TypeScript and Dart) and pinned by shared test vectors. Everything else
follows a pattern. On Nov 16 the project lead decided that the frontier model builds this phase with
helper agents, from the card index (`docs/design/phase-4-encounters.md`, "How this phase is built").

Names used for the PRD files:

- **PRD main** is `prd/main.md` (the main tab). `PRD main 452` means line 452 of the Markdown
  export of that tab taken on Nov 14. The PRD lives outside the repository (`CLAUDE.md` links
  it); a card that needs its words carries them.
- **Field spec** is `prd/google-doc-contents.md`.
- **Build plan** is `prd/build-plan.md`.

Words used in this file:

- A **note** is one care type within an encounter (one row of `encounter_notes`).
- A **finished** note is a note that is no longer a draft: `completed` or `signed`.
- A **sign-off** is the record of someone finishing or signing a note.
- The **envelope** of an encounter is what belongs to the visit and not to one note: the patient,
  the place, Medical or Non-Medical, and the free-text summary.
- **Acts as the author** means the note's author, or the clinician a Program Admin assigned to the
  note after its author left the team.

## The design in one page

1. **The note is the unit.** Each note has its own author, state, signature and lock. The
   encounter's state is worked out from its notes by the server. Phones no longer set it.
2. **Save & Close needs nothing new on the server.** A draft already syncs field by field
   (phase 2). The phone keeps the author's own draft until it is finished, so it can be completed
   offline later.
3. **Complete is one record per note: a sign-off.** It carries a hash of exactly what the person
   saw. The server computes the same hash over what it holds. If they differ, the note stays a
   draft and the person is asked to look again. This is the rule that makes signing offline safe.
4. **The server decides what a sign-off did**: signed, or completed without a signature. It decides
   from the credential the signer held at the time of signing, read from the membership history.
5. **What only the author can do works offline** (complete, sign, reopen, addendum, correction,
   referral). **What a second person does is online only** (co-sign, attest, assign a note). A
   second person can then never be left with a refused change they cannot fix.
6. **A change that arrives too late is kept, never refused.** An edit that reaches a finished note
   is stored in the note's history, and both people are told. Nothing sits in Needs attention that
   the worker cannot fix.
7. **No new permission keys.** Every check uses the 23 keys of migration 0002 plus the credential
   table that is already in `services/api/src/auth/permissions.ts`.
8. **The 24-hour alert is worked out when it is read**, like the 24-hour unsynced flag on the
   devices page. There is no background job to fail.

## 1. Ground truth: what the code has today

Every row was checked against the code on this branch. Phase 4 builds on these facts.

### 1.1 Tables

| Fact | Where | What it means for phase 4 |
|---|---|---|
| `encounters` has `id`, `team_id`, `patient_id` (nullable), `kind` (`medical`, `non_medical`), `status` (`draft`, `completed`, `signed`), `author_user_id`, `started_at` (clock-corrected), `started_device_time`, `clock_verified`, `location` (jsonb), `created_device_id`, `field_versions`, `field_meta`, `version`. | `db/migrations/0004_sync.sql:33-52` | The table stays. Phase 4 adds columns. `kind` is set at creation and has no way to change today. |
| `encounter_notes` has `encounter_id`, `note_type_key`, `note_type_version` (nullable), `status` (`draft`, `completed`, `signed`), `author_user_id`, `data` (jsonb, answers keyed by field path), `field_versions`, `field_meta`, `version`. Its comment says "One note per care type within an encounter". | `db/migrations/0004_sync.sql:54-73` | One encounter already holds several notes, each with its own author. There is no time of charting on a note, only `created_at` (when the server received it). |
| `field_history` keeps every accepted value with the one it replaced, who changed it and who approved it. It is append-only by trigger. Its kinds already include `corrected` and `entered_in_error`. | `db/migrations/0004_sync.sql:77-96`; `db/migrations/0009_patients.sql:273-283` | Corrections reuse the `corrected` kind. No new history table. |
| `user_notices` holds `kind`, `entity`, `record_id` and no text. | `db/migrations/0004_sync.sql:160-170` | Notices to authors use it as it is. `kind` has no check constraint, so new kinds need no migration. |
| Row-level security on every table of 0004 is one policy on `team_id`. The app role cannot delete encounters or notes, and cannot update or delete history. | `db/migrations/0004_sync.sql:185-198` | New tables copy this block. |
| `encounters` has `unique (team_id, id)`. Allergies, problems and problem notes point at an encounter with composite foreign keys. | `db/migrations/0009_patients.sql:13`, `:199`, `:213`; `db/migrations/0010_problems.sql:19`, `:31`, `:45-46`, `:68`, `:75` | New tables use the same composite key, so a row can never point at another team's encounter. |
| An encounter's patient must be a patient of the same team (`not valid` foreign key, checked for new rows). An index on `(team_id, patient_id, started_at)` exists for listing a patient's encounters. | `db/migrations/0013_encounter_patient_fk.sql:13-18` | The timeline query has its index already. |
| `problems.source` is `manual` or `encounter`, default `manual`. The problem create never sets it. | `db/migrations/0010_problems.sql:30`; `services/api/src/sync/entities/problem.ts:185-197` | Phase 4 sets `encounter` when a problem is created inside an encounter (8.3). |
| `patients.last_seen_at` has the comment "phase 4 encounters and phase 9 check-ins move it". Reads take the newest value across a merged group. | `db/migrations/0009_patients.sql:59`; `services/api/src/patients/team-index.ts:62-63` | An accepted encounter moves it (4.3). |
| Every table with a `patient_id` column must be listed in `CHART_TABLES`, or a schema test fails. `encounters` is listed as `group` with the comment "Phase 4 lists a group's recent encounters". | `services/api/src/patients/charts.ts:24-37`; `services/api/test/patients-charts.test.ts:334-351` | The new `referrals` table must be registered there. |
| The last migration is `0016_merge_review_undo.sql`. | `db/migrations/` | Phase 4 starts at 0017 (see 2.1 for who takes which number). |
| There is no table for signatures, addenda, corrections to notes, attestations or referrals. `patient_corrections` covers identity corrections and declined amendment requests for patient fields only, and needs a patient. | `db/migrations/0009_patients.sql:288-308` | All five are new in phase 4. |

### 1.2 Sync on the server

| Fact | Where | What it means for phase 4 |
|---|---|---|
| `encounter` and `encounter_note` are two entities in the registry. Both need `encounters.chart`. | `services/api/src/sync/entities/index.ts:20-30`; `encounter.ts:53`; `note.ts:41` | New entities are added to the same registry. |
| An encounter create takes `kind`, `patientId` and `location`. Its settable fields are `patientId`, `location` and `status`, all in the `draft` class. | `services/api/src/sync/records.ts:87-93`, `:111-117`; `services/api/src/sync/entities/encounter.ts:85` | `kind` and a summary become settable. `status` stops being settable. |
| A note create takes `encounterId`, `noteTypeKey`, `noteTypeVersion` and `data`. Its settable fields are `status` and any `data.<path>` that matches a path pattern, with no check against a form. At most 300 data fields and 64 KiB per value. | `services/api/src/sync/records.ts:25`, `:31`, `:43-44`, `:95-105`, `:118-120` | The file's own comment says phase 4 replaces the open `data.<path>` rule with the note type definitions (`records.ts:21`). That check is the forms part's. |
| A phone can set `status` to `draft` or `completed`. The comment says "Signed comes only through signing (phase 4)". | `services/api/src/sync/records.ts:107-108` | Today a phone can mark a note completed with no check at all, and set it back to draft. |
| A record is locked only when its status is `signed`. A note create on a signed encounter, and any set on a signed record, is refused with `record_locked`. | `services/api/src/sync/records.ts:171-174`; `note.ts:50`; `fields.ts:200` | Phase 4 changes both: see 3.6 and 4.4. |
| The draft rule: same value is a no-op; a value from someone who saw the current version is written; a blank is filled; anything else is a `conflict` shown side by side. Keeping the server's value tells the note's author when the kept value was someone else's. | `services/api/src/sync/entities/fields.ts:173-195`, `:198-218` | This is the Oct 19 reconciliation rule, done. Phase 4 does not change it for drafts. |
| The reject reasons already include `signing_rule` and `record_locked`, each with a fixed message. | `services/api/src/sync/schemas.ts:96-106`; `services/api/src/sync/apply.ts:32-41` | The names exist. Nothing produces `signing_rule` yet. |
| One change is one transaction with its receipt and its audit event. A change applies inside a savepoint, so a database constraint it breaks becomes a stored rejection and the queue moves on. | `services/api/src/sync/push.ts:134-179`; `services/api/src/sync/apply.ts:279-294` | New entities get this for free. |
| A change without the permission its entity needs is held for a Program Admin (quarantine). A change to a record whose create is held waits with it. | `services/api/src/sync/apply.ts:403-423`, `:426-443` | Sign-offs and corrections from a removed person follow the same path. |
| The actor of a change carries the team, the author, the device and the role's permissions. It does not carry the credential. | `services/api/src/sync/records.ts:271-293`; `services/api/src/sync/push.ts:84-92` | Signing needs the credential. Phase 4 adds it (4.2). |
| Encounter sets and creates that name a patient take the team's write lock first. Note changes do not. | `services/api/src/sync/entities/encounter.ts:54-55`; `note.ts:42` | A sign-off writes the note and the encounter, so phase 4 makes every encounter-side change take the team lock first (4.2). Note changes take it since wave A. |
| A problem status is `{status, encounterId}`. A non-null `encounterId` must be an encounter of the team, or the set answers `stale_reference` with `encounter_missing`. The same holds for creates of a problem, an allergy and a problem note. | `services/api/src/sync/entities/values.ts:230-232`, `:388-435`; `services/api/src/sync/entities/index.ts:44-62`; `services/api/test/problems-sync.test.ts:229` | Phase 3 always sent `null`. Phase 4 fills it (8.3). |
| `/v1/sync/records` returns a note's whole `data` to anyone with `encounters.chart`. Only sensitive problems are hidden from a role. | `services/api/src/routes/sync.ts:73-85`; `services/api/src/sync/review.ts:268-299` | Phase 4 must hide sensitive sections here too (6.4). |
| Offline reads can already be logged as `encounter.viewed` and `note.viewed`. | `services/api/src/sync/entities/values.ts:269-294` | The phone's visit screen uses them. |
| The team's 24-hour unsynced flag is worked out when the devices page is read. There is no scheduled job anywhere in the API. | `services/api/src/sync/devices.ts:408-409`, `:435`; no match for a scheduler in `services/api/src` | The 24-hour note alert follows the same pattern (3.9). |

### 1.3 Credentials and signing rules that already exist

| Fact | Where |
|---|---|
| Seven credentials: `attending`, `resident`, `np`, `pa`, `student`, `chw`, `none`. | `services/api/src/auth/permissions.ts:93` |
| Each has `chartMedical`, `orderMedications`, `sign`, `attest`, `billingNeedsAttestation` and `rank`. Attending: signs, attests, no attestation needed, rank 4. Resident, NP, PA: sign, cannot attest, need attestation, rank 3. Student: charts Medical, cannot sign, rank 2. CHW and none: cannot chart Medical. | `services/api/src/auth/permissions.ts:96-170` |
| The PA rule is marked `PLAN-OPEN` and follows the NP rule. | `services/api/src/auth/permissions.ts:136-145`; `IMPLEMENTATION_PLAN.md` section 6 |
| The fields each credential needs (an NPI for resident, attending, NP and PA) are stored on the membership as `credential_fields`. | `services/api/src/auth/permissions.ts:182-190`; `db/migrations/0002_identity_access.sql:101-118` |
| A request's team context carries the person's credential and its fields. | `services/api/src/auth/context.ts:26-37`, `:328-341` |
| Every credential change writes a `membership_changes` row with the old and the new credential and fields, and the time. The table is append-only. The code comment says "Notes store a snapshot of the signer's credential, so nothing here touches them". | `services/api/src/services/memberships.ts:256-312`; `db/migrations/0002_identity_access.sql:125-138` |
| The phone keeps the person's credential for each team from `/v1/me`. | `services/api/src/routes/me.ts:14-24`; `apps/mobile/lib/auth/session_controller.dart:16-38` |
| The permission catalog has 23 keys. Among them: `encounters.chart`, `referrals.create`, `patients.view_sensitive`, `patients.view_sensitive_exams`, `billing.view_codes`, `team.manage_users`. | `services/api/src/auth/permissions.ts:12-37` |
| Of the standard roles, only Program Admin holds `patients.view_sensitive_exams`. Logistics and Healthcare Staff hold `patients.view_sensitive`. Billing/Data holds neither. The CHW preset has `referrals.create` and no `encounters.chart`. | `db/migrations/0002_identity_access.sql:86-97`; `services/api/src/auth/permissions.ts:80-91` |
| Nothing in the API checks a credential for a clinical act yet. The test fixtures say "Credentials don't affect sync until signing (phase 4)". | `services/api/test/sync-fixtures.ts:119` |

### 1.4 The phone

| Fact | Where | What it means for phase 4 |
|---|---|---|
| `createEncounter` and `createNote` exist in the store. Both stop while the clock check fails. | `apps/mobile/lib/sync/local_store.dart:561-617` | The encounter screens call these. |
| `setField` saves one field as the person types, with `follows` for a second edit. It throws `RecordLocked` when the local record's status is `signed`. | `apps/mobile/lib/sync/local_store.dart:802-835` | "The note is a draft that saves as the author types" is done. |
| Save & Close is `closeRecord`: it marks the record closed, and the purge then removes each field whose latest change is confirmed. | `apps/mobile/lib/sync/local_store.dart:886-889`, `:1895-1922` | A closed draft leaves the phone once it has synced. Phase 4 changes when the screens call `closeRecord` (3.2). The store does not change for this. |
| An encounter stays on the phone while the person has a note on it open or unsynced (D23). | `apps/mobile/lib/sync/local_store.dart:1897-1903` | Kept. |
| A change waits while a record it names has a rejected create, or is created later in the outbox. The records a change names come from the registry. | `apps/mobile/lib/sync/local_store.dart:976-1018`; `apps/mobile/lib/sync/entities.dart:730-737` | New entities name their note, so they wait behind it with no change to the hold logic. |
| `createRecord` accepts patient-side entities only. | `apps/mobile/lib/sync/local_store.dart:623-635` | Sign-offs, addenda, corrections and referrals are made patient-side (4.8). |
| The phone's registry mirrors the server's for `encounter` and `encounter_note`, with `status` as `draft` or `completed`. | `apps/mobile/lib/sync/entities.dart:415`, `:573-610` | Changed with the server (4.8). |
| The fake server refuses a note create on a signed encounter and a draft set on a signed record with `record_locked`. | `apps/mobile/test/sync/fake_server.dart:690`, `:1112` | Changed with the server (4.9). |
| Home shows the greeting, the clock card, the Needs attention tile and the sync card. It has no tasks. The tab bar has Home and Patients; a comment says "Start, Schedule and Resources arrive with their phases". | `apps/mobile/lib/features/home/home_screen.dart:15-83`; `apps/mobile/lib/app.dart:74-83`, `:181-208` | Phase 4 adds the Start button and the note tasks. |
| The patient profile has Copy ID link, Edit and sections for problems, allergies, street names, consent and history. It has no + Encounter, no + Referral and no timeline. | `apps/mobile/lib/features/patients/patient_screen.dart`; `docs/design/phase-3-patients.md:1992` | Phase 4 adds all three. |
| What a chart says beyond its records rides in the patient record's server-only `_chart` field (D44). | `apps/mobile/lib/patients/chart_cache.dart:21-23`, `:37-55` | The timeline rides there too (8.2). |

### 1.5 Needs attention and `encounter_missing`

- The sentence exists: "The visit this names isn't on the team's list."
  (`apps/mobile/lib/features/sync/sync_labels.dart:76`).
- The button does not. The card offers **Attach to another patient** only for a create whose
  problem is `patient_missing` (`apps/mobile/lib/features/sync/needs_attention_screen.dart:304-308`).
- Phase 3 says so in its as-built notes: "An `encounter_missing` status has its sentence but no
  attach-to-encounter button until phase 4" (`docs/design/phase-3-patients.md:164`), and its design
  row promises the same fix for the encounter (`docs/design/phase-3-patients.md:1998`).
- The store already has what the fix needs: `fixRejected(changeId, value)` sends a corrected value
  linked to the refused change (`apps/mobile/lib/sync/local_store.dart:1328-1345`).

### 1.6 What does not exist yet

- `packages/forms` (the root `package.json:19` has a `forms:export` script for it).
- Any portal page for encounters, notes or attestation (`apps/portal/src/app/(app)/`).
- Any API route that reads an encounter as a whole. The only read is `/v1/sync/records`.
- Any test that drives charting through screens. Phase 2's done-when tests drive the store
  directly (`apps/mobile/test/sync/sync_scenarios_test.dart`, `live_api_test.dart`;
  `IMPLEMENTATION_PLAN.md` phase table, row 2).
- A registered nurse credential. See 12.2, question 3.

## 2. Data model

Rules for every migration here, from `CLAUDE.md`: plain SQL that runs unchanged on RDS, numbered,
additive, one transaction, never edited once merged. Every new table gets the team policy block of
`0004_sync.sql:185-195` (row-level security as the second line) and composite foreign keys on
`(team_id, ...)`, as `0009_patients.sql` does. Every card that touches one of these files is
level X.

### 2.1 Migration list

| File | What it adds | Level |
|---|---|---|
| `0017_…` | Reserved for the forms part (note types and their versions, D13). Nothing here depends on it: no lifecycle table has a foreign key to a note type table. If the forms part needs no migration, the coordinator renumbers before the first card. | (forms) |
| `0018_encounter_lifecycle.sql` | Columns on `encounters` and `encounter_notes`; the encounter status trigger; the finished-note guard | X |
| `0019_note_signoffs.sql` | `note_signoffs`, `note_addenda`, `note_corrections` | X |
| `0020_note_attestations.sql` | `note_attestations`, `note_assignments`; `patient_of_change` learns the new entities | X |
| `0021_referrals.sql` | `referrals` | X |
| `0022_notice_note.sql` | `user_notices.note_id`: the note a held sign-off's notice names (D104, wave F), with a composite key to `encounter_notes` on `(team_id, note_id)`; every other notice leaves it null | X |

No migration touches `known_permissions()` or a role row (D37). No migration touches the audit
tables. `field_history` needs no new kind: `set`, `kept_both` and `corrected` already exist
(`0009_patients.sql:274-283`).

### 2.2 `0018_encounter_lifecycle.sql`

**`encounters`: two new columns.**

| Column | Type | Meaning | PRD |
|---|---|---|---|
| `summary` | `text`, null or 1 to 4,000 characters (`encounters_summary_check`) | The free-text assessment written on the summary screen | PRD main 383, 433 |
| `location_text` | `text`, null or 1 to 200 characters (`encounters_location_text_check`) | The place, entered by hand | PRD main 378 |

Both lengths are plain `length()`, not trimmed, so the database is never stricter than the
API's schema for the two fields (card L1-encounter-fields). Both checks are ordinary, validated
ones: the columns are new and every row holds null.

`kind` keeps its column and becomes a field a phone can set to `medical`, at any time (PRD main
379: "A Non-Medical encounter can be switched to Medical partway through"; 3.10). Rows made before
this migration have no `kind` entry in `field_versions`, which reads as version 0.

`status` keeps its column and its three values. From now on the database works it out:

```sql
create function sineobex.note_is_empty(p_data jsonb) returns boolean
language sql immutable as $$
  select not exists (
    select 1 from jsonb_each(p_data) e
    where e.value not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb))
$$;

create function sineobex.encounter_status(p_encounter uuid) returns text
language sql stable as $$
  with n as (
    select status, medical from sineobex.encounter_notes
    where encounter_id = p_encounter
      and not (status = 'draft' and sineobex.note_is_empty(data)))
  select case
    when not exists (select 1 from n) then 'draft'
    when exists (select 1 from n where status = 'draft') then 'draft'
    when exists (select 1 from n where status = 'completed' and medical) then 'completed'
    when exists (select 1 from n where status = 'signed') then 'signed'
    else 'completed'
  end
$$;

create function sineobex.refresh_encounter_status() returns trigger
language plpgsql as $$
begin
  perform 1 from sineobex.encounters e where e.id = new.encounter_id for no key update;
  update sineobex.encounters e set status = sineobex.encounter_status(new.encounter_id)
  where e.id = new.encounter_id and e.status is distinct from sineobex.encounter_status(new.encounter_id);
  return null;
end $$;

create trigger encounter_notes_status after insert or update of status, data on sineobex.encounter_notes
  for each row execute function sineobex.refresh_encounter_status();
```

An empty draft does not count (3.1). Of the notes that count: `draft` while there is none, or
any is a draft; `completed` while a Medical note waits for a co-signer; `signed` once a note is
signed and none waits; `completed` when the encounter holds only finished Non-Medical notes. A
trigger, and not API code, because four code paths change a note's status (a sign-off, a reopen,
an online co-sign, a correction by a student), and a fifth would forget. It also runs when a
note's answers change, because the first answer makes an empty draft count.

**The row lock, and why there are two locks.** Two writers that finish two notes of one visit
at once would each read the other's note as it was and leave the visit a draft, or sign a visit
beside an open draft. Every note change takes the team lock first (4.2), which keeps them
apart. The trigger's first statement is the second line: it locks the visit's row (`for no key
update`, which does not wait on the key-share lock a note's foreign key takes), so a writer that
forgets the team lock waits for the other to commit, and the status it then works out, from a
new snapshot in read committed, sees the other's note. Under the team lock it never waits.

**Visits from before 0018.** Phase 2 let a phone set an encounter's status, and nothing tied it
to the notes. A finished note never changes again, so the trigger alone would leave such a visit
wrong for good: once the functions exist, 0018 works out the status of every existing encounter
once (`update ... set status = encounter_status(id) where status is distinct from ...`). The
encounters' touch trigger stays on for it, so a status that moves is stamped as every change is,
and a phone learns of it at its next pull.

**A phone can still write `encounters.status`** until card L1-encounter-fields takes the field
out of the encounter's settable fields (4.3). The database has no rule against it: a status a
phone sets is overwritten at the next change of one of the visit's notes.

**`encounter_notes`: new columns.**

| Column | Type | Meaning |
|---|---|---|
| `medical` | `boolean not null default false` | Whether the note is a Medical note (3.1). Set from its note type when the note is created, never changed. Rows from before this migration are Non-Medical. |
| `completed_at` | `timestamptz` | When the note last left draft (clock-corrected device time). Null while a draft. |
| `completed_by` | `uuid` references `users` | Who finished it |
| `first_signed_at` | `timestamptz` | Set once, at the first signature. A note that was ever signed is never reopened. |
| `signoff_id` | `uuid` | The sign-off that makes the note signed now. Null unless `status = 'signed'`. Foreign key `(team_id, id, signoff_id)` to `note_signoffs (team_id, note_id, id)`, added in 0019: a note names only a sign-off of its own. |
| `attestation` | `text not null default 'not_needed'`, one of `not_needed`, `waiting`, `attested` | Whether an attending must still attest the note as it reads now |
| `assigned_user_id` | `uuid` references `users` | The clinician a Program Admin assigned after the author left. Null: the author acts. |

Also `unique (team_id, id)` on `encounter_notes`, so other tables can point at a note with a
composite key (`encounter_notes_team_id_key`), and `unique (team_id, encounter_id, id)`
(`encounter_notes_team_id_encounter_id_id_key`), so an addendum's note is a note of its visit
(2.3). And a foreign key `(team_id, encounter_id)` to `encounters (team_id, id)`, `not valid` as
0013's (`encounter_notes_team_id_encounter_id_fkey`): 0004's key is the encounter's ID alone, and
a foreign key check ignores row-level security, so a request could otherwise put a note of its
own team on another team's encounter, which the status trigger, running as the request, cannot
see. And one partial index for the attestation queue:

```sql
create index encounter_notes_waiting on sineobex.encounter_notes (team_id, updated_at)
  where attestation = 'waiting';
```

The co-sign queue has its own:

```sql
create index encounter_notes_cosign on sineobex.encounter_notes (team_id, completed_at)
  where status = 'completed' and medical;
```

Check constraints, all added `not valid` as `0013_encounter_patient_fk.sql` does, so phase 2
preview rows stay as they are and every new or changed row is checked:

```sql
check ((status = 'draft') = (completed_at is null))             -- encounter_notes_completed_at_when_finished
check ((completed_at is null) = (completed_by is null))         -- encounter_notes_completed_by_with_at
check (status = 'signed' or attestation = 'not_needed')         -- encounter_notes_attestation_when_signed
check (first_signed_at is not null or status <> 'signed')       -- encounter_notes_signed_has_first_signed
check (medical or status <> 'signed')                           -- encounter_notes_signed_is_medical
check (first_signed_at is null or status <> 'draft')            -- encounter_notes_signed_never_reopened
```

The last is the rule that a note once signed is never reopened: a student's correction leaves it
`completed`, never `draft` (3.6). Each check is named, because the tests and a sync rejection
(`server_constraint` stores the name) need stable names.

`(status = 'signed') = (signoff_id is not null)` is added in 0019, once the table it points at
exists. Before the checks, the migration fills `completed_at = updated_at` and
`completed_by = author_user_id` for rows that are already `completed`. The notes' touch trigger
(`encounter_notes_touch`) is off for that one statement and on again after it, so a row's own
time of last change stays what it was.

**The finished-note guard.** A finished note's answers change only through a correction, and
what a finished note is never changes at all. The database holds both rules itself:

```sql
create function sineobex.guard_finished_note() returns trigger
language plpgsql as $$
declare
  v_kept text;
begin
  if old.status = 'draft' then
    return new;
  end if;
  v_kept := case
    when new.encounter_id is distinct from old.encounter_id then 'encounter_id'
    when new.note_type_key is distinct from old.note_type_key then 'note_type_key'
    when new.note_type_version is distinct from old.note_type_version then 'note_type_version'
    when new.medical is distinct from old.medical then 'medical'
    when new.author_user_id is distinct from old.author_user_id then 'author_user_id'
  end;
  if v_kept is not null then
    raise exception 'a finished note keeps its %', v_kept
      using errcode = 'check_violation', constraint = 'encounter_notes_finished_' || v_kept;
  end if;
  if old.first_signed_at is not null and new.first_signed_at is distinct from old.first_signed_at then
    raise exception 'a note is first signed once'
      using errcode = 'check_violation', constraint = 'encounter_notes_first_signed_at_once';
  end if;
  if new.data is distinct from old.data
     and lower(btrim(coalesce(current_setting('app.note_correction', true), ''), E' \t\r\n')) <> old.id::text then
    raise exception 'a finished note changes only through a correction'
      using errcode = 'check_violation', constraint = 'encounter_notes_finished_data';
  end if;
  return new;
end $$;

create trigger encounter_notes_finished before update on sineobex.encounter_notes
  for each row execute function sineobex.guard_finished_note();
```

The correction code sets `app.note_correction` to the note's ID for its own transaction
(`set_config(..., true)`), the way every request sets `app.team_id` (`0001_base.sql:76-93`). The
error class is 23 on purpose: `applyInSavepoint` turns a class 23 error into a stored
`server_constraint` rejection, so a bug here can never stop a phone's queue (D42,
`services/api/src/sync/apply.ts:279-301`).

Two of the guard's rules go beyond the first design (wave A's review):

- **What a finished note is never changes**, correction or not: its visit, its note type and
  version (the form it is read with), whether it is Medical, its author (an assignee is a column
  of its own), and, once set, the time it was first signed. Each refusal names its own
  constraint: `encounter_notes_finished_encounter_id`, `_note_type_key`, `_note_type_version`,
  `_medical`, `_author_user_id`, and `encounter_notes_first_signed_at_once`. With the check
  `encounter_notes_signed_never_reopened`, a signed note can no longer be put back to draft and
  rewritten in two statements. The correction setting opens none of these. A draft may still
  change them, which the sync rules govern (4.4).
- **The setting is compared without case**: `lower(btrim(...))` of the value, with spaces, tabs
  and line ends trimmed, against the note's ID. The right ID in capitals, or with white space
  around it, opens the note; any other value, braces or a no-break space included, is still
  refused with class 23, never a class 22 error.

### 2.3 `0019_note_signoffs.sql`

**`note_signoffs`**: one row each time someone finishes or signs a note. Append-only (the
`forbid_mutation` trigger, `0001_base.sql:103-109`). The signer's name, credential and NPI are
stored here because the billing export needs them (PRD main 452) and because a signed note keeps
the credential it was signed under (PRD main 133, 223).

| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid primary key` | Made on the phone for the author's own sign-off; made by the server for an online co-sign |
| `team_id`, `note_id` | `uuid not null` | Foreign key `(team_id, note_id)` to `encounter_notes (team_id, id)` |
| `act` | `text`, one of `complete`, `sign`, `cosign` | What the person asked for |
| `effect` | `text`, one of `signed`, `completed`, `saved_unsigned`, `none` | What the server did (3.4) |
| `content_hash` | `text`, 64 hex characters | The hash of what the person saw (4.5) |
| `signer_user_id` | `uuid not null` references `users` | |
| `signer_name` | `text not null` | `users.display_name` at the time |
| `signer_credential` | `text not null`, one of the seven credentials | The credential the server recorded the act under (3.5) |
| `signer_npi` | `text`, ten digits | Null when that credential has none |
| `signer_fields` | `jsonb not null default '{}'` | The credential's other fields at the time (license, program, supervising attending) |
| `claimed_credential` | `text` | What the phone's saved profile said. Null for an online co-sign and for `complete`. |
| `needs_attestation` | `boolean not null` | |
| `statement_version` | `text not null` | Which wording the person was shown (3.5) |
| `signed_at` | `timestamptz not null` | Clock-corrected device time; server time for an online co-sign |
| `signed_device_time` | `timestamptz` | The phone's own time. Null online. |
| `clock_verified` | `boolean not null` | |
| `received_at` | `timestamptz not null default now()` | Server receipt time, kept beside `signed_at` (plan section 6) |
| `change_id` | `uuid` | The sync change that carried it. Null online. |
| `created_device_id` | `uuid` references `devices` | |
| `approved_by` | `uuid` references `users` | The Program Admin who accepted it from quarantine |

`unique (team_id, id)`; index `(team_id, note_id, received_at)`. Then the foreign key and the
check on `encounter_notes.signoff_id` from 2.2.

**`note_addenda`**: "a dated entry by its author attached below the note" (PRD main 459).
Append-only.

| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid primary key` | Made on the phone |
| `team_id`, `encounter_id` | `uuid not null` | Foreign key to `encounters (team_id, id)` |
| `note_id` | `uuid` | The note it is attached to, a note of the same visit (foreign key `(team_id, encounter_id, note_id)` to `encounter_notes (team_id, encounter_id, id)`). Null: it is about the visit's summary. |
| `text` | `text`, 1 to 4,000 characters | |
| `written_at` | `timestamptz not null` | Clock-corrected device time |
| `clock_verified` | `boolean not null` | |
| `author_user_id`, `author_name`, `author_credential` | | Who wrote it, as they were then |
| `created_device_id`, `change_id`, `created_at` | | As on `problem_notes` (`0010_problems.sql:63-79`) |

Index `(team_id, encounter_id, written_at)`.

**`note_corrections`**: "the author picks the wrong field, enters the right value and gives a
reason" (PRD main 460). A patient's amendment request uses the same row (PRD main 463), the way
`patient_corrections` records one for identity fields (`0009_patients.sql:288-308`). Append-only.
One row is one correction: one reason, and one to ten answers changed together (4.7).

| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid primary key` | Made on the phone |
| `team_id`, `note_id` | `uuid not null` | Foreign key to `encounter_notes (team_id, id)` |
| `changes` | `jsonb not null`, an array of 1 to 10 | Each `{ field, oldValue, newValue, historyId }`. `field` starts with `data.`. `historyId` is the `corrected` row in `field_history`, or null when nothing was written. A `corrected` correction names only the answers it wrote, since the note's read strikes through the old value of each answer it names (4.7 step 7, review finding R1); the other outcomes name every answer asked for. |
| `outcome` | `text`, one of `corrected`, `declined`, `no_change`, `draft_edit`, `not_author` | `declined`: an amendment request refused, the note unchanged. `no_change`: the note already held those values. `draft_edit`: the note was a draft again, and the changes were applied as edits. `not_author`: the sender does not act as the note's author; nothing changed. |
| `reason` | `text`, 3 to 500 characters | |
| `requested_by_patient` | `boolean not null default false` | A HIPAA §164.526 amendment request |
| `corrector_user_id`, `corrector_name`, `corrector_credential` | | Who corrected it, under the credential `signedUnder` found (3.5) |
| `claimed_credential` | `text` | What the phone's saved profile said |
| `corrected_at` | `timestamptz not null` | Clock-corrected device time |
| `clock_verified`, `created_device_id`, `change_id`, `created_at` | | |

Check: `outcome <> 'declined' or requested_by_patient`. Index
`(team_id, note_id, corrected_at)`.

The app role gets no `update` or `delete` on these three tables.

**As built**, 0019 also holds:

- **A note names only a signature of its own.** `note_signoffs` has
  `unique (team_id, note_id, id)` (`note_signoffs_team_id_note_id_id_key`) beside
  `unique (team_id, id)`, and the key on `encounter_notes.signoff_id` is
  `(team_id, id, signoff_id)` to `note_signoffs (team_id, note_id, id)`
  (`encounter_notes_signoff_fk`). The key is added valid: every `signoff_id` is null when it is
  added. Only the check `encounter_notes_signoff_when_signed` is `not valid`, as 2.2's are.
- **The order a writer follows.** The `note_signoffs` row first, then the note's update to
  `signed`, with `signoff_id`, in one statement: the key is not deferrable. A note that leaves
  `signed` clears `signoff_id`, and sets `attestation` back to `not_needed`, in the same statement;
  a reopen clears `completed_at` and `completed_by` in the same statement.
- **What a key cannot see stays the route's rule.** The database accepts a note that names its
  own sign-off whose `effect` is not `signed` (`none`, `completed`), because a key cannot see the
  effect. L1's sign-off path writes the note's `signoff_id` and the sign-off row from the same
  loaded rows, and its tests pin that a note names only a signature.
- **An addendum's note is a note of its visit**: the key is `(team_id, encounter_id, note_id)` to
  `encounter_notes (team_id, encounter_id, id)` (`note_addenda_team_id_encounter_id_note_id_fkey`),
  unchecked when `note_id` is null, beside `(team_id, encounter_id)` to `encounters`.
- Checks the tables above do not spell out: `signer_credential`, `author_credential`,
  `corrector_credential` and both `claimed_credential` columns are one of the seven credentials,
  as `team_memberships.credential` is; `signer_fields` is a JSON object; `content_hash` is 64
  lower-case hex characters; `signer_npi`, where it is not null, is ten digits
  (`note_signoffs_signer_npi_check`; the check digit is left to the API's check of a membership's
  credential fields, `isValidNpi`, since demo NPIs are ten zeros);
  `author_name`, `author_credential`, `corrector_name` and `corrector_credential` are not null.
  An addendum's text and a correction's reason are measured trimmed (`length(btrim(...))`), as
  `problem_notes.text` and the API's `Trimmed` are.
- **`changes` is checked in the database** (`note_corrections_changes_shape`), through the
  function `note_correction_changes_ok`: an array of 1 to 10 objects, each with a string `field`
  matching `data._%`, so a correction of the summary or the status can never be stored. It is a
  function with a guard on the value's type, so a value of the wrong shape breaks the check
  (class 23, a stored rejection) and never raises a class 22 error, which would stop a phone's
  queue. `oldValue`, `newValue` and `historyId` are not checked.

### 2.4 `0020_note_attestations.sql`

**`note_attestations`**: "Attesting adds a dated statement below the note and doesn't change it"
(PRD main 216). Append-only. One row per attestation; a note corrected after it was attested gets
a second row when it is attested again.

| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Attesting is online, so the server makes the ID |
| `team_id`, `note_id` | `uuid not null` | Foreign key to `encounter_notes (team_id, id)` |
| `signoff_id` | `uuid not null` | The signature attested. Foreign key `(team_id, note_id, signoff_id)` to `note_signoffs (team_id, note_id, id)`: a sign-off of the same note. |
| `content_hash` | `text not null` | The note as the attending read it |
| `attending_user_id`, `attending_name` | | |
| `attending_npi` | `text not null`, ten digits | The billing export needs the attesting physician's NPI (PRD main 656) |
| `attending_fields` | `jsonb not null default '{}'` | License number and state at the time |
| `statement_version` | `text not null` | |
| `attested_at` | `timestamptz not null default now()` | Server time |

Index `(team_id, note_id, attested_at)`.

**`note_assignments`**: who was put in an author's place, by whom and why (PRD main 461).
Append-only. The current assignee is `encounter_notes.assigned_user_id`.

| Column | Type |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `team_id`, `note_id` | `uuid not null`, foreign key to `encounter_notes (team_id, id)` |
| `from_user_id`, `to_user_id`, `assigned_by` | `uuid not null` references `users` |
| `reason` | `text`, 3 to 500 characters |
| `assigned_at` | `timestamptz not null default now()` |

**`patient_of_change`** (`0009_patients.sql:430-476`) is replaced with the same body plus four
branches, so the quarantine queue can still name the patient of a held change:

- `note_signoff`, `note_correction`: through the value's `noteId` to the note, then as
  `encounter_note` does today.
- `note_addendum`: through the value's `encounterId`, then as `encounter` does today.
- `referral`: the row's `patient_id`, else the value's `patientId` (the function's last line
  already reads it).

**As built**, 0020 also holds:

- **An attestation's signature is one of the same note.** Its key is
  `(team_id, note_id, signoff_id)` to `note_signoffs (team_id, note_id, id)`
  (`note_attestations_team_id_note_id_signoff_id_fkey`), beside `(team_id, note_id)` to the note.
  A key cannot see a sign-off's `effect`, so the database still accepts an attestation that names
  a sign-off of the same note that is not a signature. That stays the route's rule: L2's attest
  route writes the attestation from the note it loaded and that note's current `signoff_id`, and
  its tests pin it.
- `content_hash` is 64 lower-case hex characters and `attending_fields` a JSON object, as on
  `note_signoffs`; `attending_npi` is ten digits (`note_attestations_attending_npi_check`; the
  check digit is left to the API, as on `note_signoffs`). An assignment's `reason` is not null
  and measured trimmed.
- **`patient_of_change`**: a sign-off and a correction go through the note their value names (the
  note's row, else its held create; then the visit's row, else its held create); an addendum
  through its visit. **The referral branch lives in 0020**, as this section says, though its
  table arrives in 0021: PL/pgSQL looks the table up when the branch runs, and nothing sends a
  `referral` change before L1. Its tests are in `db/test/referrals.test.ts`. A referral and an
  allergy fall back, when their row does not exist and the value names no patient (an
  entered-in-error mark whose create is held too), to the `patientId` of the latest held create of
  that record, as the problem-note branch does for its problem. The fallback comes after the
  value's own `patientId`, so every answer the 0009 body gave stays the same: compared over the
  review's inputs, as the owner and as the application role of two teams and of none, no answer
  changed.

### 2.5 `0021_referrals.sql`

**`referrals`**: "a referral records only a date and free-text details" (PRD main 113, 507). It
copies the shape of `patient_allergies` (`0009_patients.sql:191-218`), which is the closest
existing record: a union record with one retraction.

| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid primary key` | Made on the phone |
| `team_id`, `patient_id` | `uuid not null` | Foreign key to `patients (team_id, id)` |
| `referred_on` | `date not null` | The referral's date |
| `details` | `text`, 1 to 2,000 characters | Free text |
| `encounter_id` | `uuid` | The encounter it was made in, if any. Foreign key to `encounters (team_id, id)`. |
| `status` | `text not null default 'active'`, `active` or `entered_in_error` | |
| `error_reason`, `error_by`, `error_at` | | As on `patient_allergies`, but all three or none (below) |
| `recorded_at` | `timestamptz not null` | Clock-corrected device time |
| `clock_verified` | `boolean not null default false` | |
| `author_user_id`, `created_device_id` | | |
| `field_versions`, `field_meta`, `version`, `created_at`, `updated_at` | | The bookkeeping every synced record carries |

`unique (team_id, id)`; index `(team_id, patient_id, referred_on desc)`; the touch trigger; the
team policy; no `delete` for the app role. Because it has a `patient_id`, the same card adds
`referrals: 'group'` to `CHART_TABLES` (`services/api/src/patients/charts.ts:24-37`), or the schema
test fails.

V1 has no status, no completion prompt and no completion reporting (PRD main 113, 507-512). The
table has no column for them. V2 adds them.

**As built**, 0021 has exactly the nineteen columns above (a test lists them, so no V2 column can
slip in), and named constraints: `referrals_team_id_key`, `referrals_team_id_patient_id_fkey`,
`referrals_team_id_encounter_id_fkey`, `referrals_details_check` (1 to 2,000 characters, measured
trimmed), `referrals_status_check`, `referrals_error_reason_check` (3 to 300, trimmed) and
**`referrals_error_with_status`, which is stricter than the check on `patient_allergies`**: the
reason, who (`error_by`) and when (`error_at`) are all set while the status is
`entered_in_error`, and all null otherwise. The allergies' check never asks for `error_by` and
lets an active row keep a reason. So L1's referral entity writes `error_by` with the other two
(4.7), as `allergy.ts` already does.

### 2.6 What is not stored

- **The recap.** It is worked out from a note's answers and the note type version it was written
  on (8.1). Storing it would give two copies that can disagree after a correction.
- **"Waiting for a co-signer".** It is `status = 'completed'` on a Medical encounter.
- **The 24-hour alert.** It is a query (3.9).
- **A billing flag for a corrected note** (PRD main 462). There is no billing export until
  phase 10. The correction row and its time are the facts phase 10 reads.

## 3. States and rules

### 3.1 The states of a note

**Medical is a property of the note, through its type.** A **Medical note** is a note whose type
is offered for Medical encounters only (General, Wound care, the Quick encounter and the rest). A
**Non-Medical note** is one whose type is offered for Non-Medical encounters, alone or as well:
Social needs and Outreach. Non-Medical work has "no orders, co-signing or billing codes" (PRD
main 379), so a Non-Medical note is never signed, co-signed or attested, in any encounter. A
clinician and an outreach worker can then chart one visit together, each under their own rules.

A note has a `status` and, once signed, an `attestation`. Together they give six states. The
words in the first column are the words the apps show.

| Shown as | `status` | `attestation` | Note | Who can change the answers |
|---|---|---|---|---|
| Draft | `draft` | `not_needed` | either | Anyone with `encounters.chart`, field by field (the draft rule). A Medical note also needs a credential that charts Medical (4.2). |
| Complete | `completed` | `not_needed` | Non-Medical | Nobody. Addenda and corrections only. |
| Waiting for a co-signer | `completed` | `not_needed` | Medical | Nobody. The author can reopen it if it was never signed. |
| Signed | `signed` | `not_needed` | Medical | Nobody. Addenda and corrections only. |
| Signed, waiting for attestation | `signed` | `waiting` | Medical | Nobody. Addenda and corrections only. |
| Signed and attested | `signed` | `attested` | Medical | Nobody. Addenda and corrections only. |

The encounter's own status follows from its notes (2.2).

**The envelope** (the patient, the place, the kind, the summary) has three rules:

- The patient, the place and the summary can change while the encounter has no finished note.
  From the first finished note on they are locked: a signer has vouched for them (4.5). One
  exception: an encounter with no patient can be given one at any time, because filling a blank
  takes nothing away from what anyone signed.
- A person who finishes their notes after the lock adds their own assessment as an addendum to
  the visit (9.6). Nothing a signer wrote is replaced.
- The kind only ever goes from Non-Medical to Medical, at any time (PRD main 379), and never
  back. It decides which note types the apps offer. It decides nothing about a note that exists.

**An empty draft does not count.** A draft note whose answers are all blank (4.5) is treated as if
it were not there: by the encounter's status, by Complete, by a sign-off, which changes nothing
(3.4), by the lists of notes to finish and by the timeline. A note type picked by mistake is undone
by **Remove this note**, which blanks its answers (9.4). The Red flags note that the app adds by
itself (forms 6.2) stays out of the way until someone answers it. One function, `noteIsEmpty`, says
so on both sides (3.12), and the database has the same rule (2.2).

```
            Complete (a Non-Medical note)
   draft ──────────────────────────────▶ completed            (final)
     │
     │  Complete, author can't sign       co-sign (online)
     ├──────────────────────────────▶ completed ───────────▶ signed ─┐
     │        ▲            │ reopen (never signed)                    │ attestation:
     │        └────────────┘                                          │ not_needed, or
     │  Complete, author can sign                                     │ waiting ─▶ attested
     └──────────────────────────────────────────────────────▶ signed ─┘   ▲          │
              (a Medical note)                                             └──────────┘
                                                                        a correction
```

### 3.2 Save & Close

PRD: "Save & Close keeps an unfinished note and syncs it to the server as a draft; Complete
finishes it" (PRD main 99). "Before signing: the note is a draft that saves as the author types,
and the author can change anything. Save & Close syncs the draft to the server" (PRD main 458).

- Every answer is saved as it is entered (`setField`, 1.4). Save & Close saves nothing extra.
- It leaves the form, goes back to the patient's chart, and asks for a sync now.
- The server needs nothing new. The draft arrives through the normal push. Any teammate with
  `encounters.chart` can open it, and two people's edits merge by the draft rule (1.2).
- **The draft stays on its author's phone until it is finished.** The screens no longer call the
  store's `closeRecord` at Save & Close. They call it when the note is finished and confirmed
  (8.2). The PRD's purge rule waits "until the record leaves active use (encounter signed or
  closed, or route ended)" (PRD main 572). An unfinished draft has not left active use: its author
  still has to complete it, and may have no signal when they do. Phase 2 read "closed" as Save &
  Close; with Complete now built, that reading would make "completes it later" need a connection.
- A draft nobody has touched for 7 days is released from the phone if it is fully synced. It
  stays on the server and opens again online. PLAN-OPEN 12.1 #4.
- A teammate's draft opened to help is released when its screen closes, as today.

### 3.3 Complete

Complete is asked on the summary screen (9.6). It finishes every draft note of the encounter for
which the person acts as the author, except empty drafts (3.1). A teammate's draft notes in the
same encounter stay drafts.

Hard stops on the phone, before anything is written (PRD main 562):

1. The forms part's finish check passes for each note (required answers, consent recorded for a
   sensitive exam, PRD main 415; no contradictory disposition, PRD main 102).
2. Nothing about this encounter or its notes waits in Needs attention. A refused sign-off of a
   note being completed now does not count: completing again is its fix (3.4). As built since the
   phase's review (finding PS-1), neither does an addendum, an addition to the assessment or a
   correction refused only for naming such a sign-off: Complete sends each again after the fix
   (4.8 as built).
3. Charting is not paused for the clock.
4. If one of the notes is a Medical note, the encounter names a patient (3.10).
5. If one of the notes is a Medical note, the visit has a finished Red flags and disposition
   note, or the person's own is finished with the others. Their own is then not skipped as an
   empty draft, so its finish check asks for the red-flag answer (forms 6.2). A second clinician
   is not held up by a colleague's unfinished Red flags note: the app gives them their own.

Then, in one transaction on the phone, one sign-off is made per note. A note whose earlier
sign-off was refused gets that sign-off sent again, corrected, and not a second one (4.8).

| The note | The person's credential | Act sent | What the note becomes |
|---|---|---|---|
| Non-Medical | any | `complete` | Complete |
| Medical | attending, resident, NP, PA (`sign` is true) | `sign` | Signed |
| Medical | student (`sign` is false) | `complete` | Waiting for a co-signer |

The button is worded by what will happen: **Complete** when every note is Non-Medical,
**Complete and sign** when a note will be signed, **Complete and send for co-signature** when a
Medical note will wait for a co-signer.

A credential without `chartMedical` (CHW, none) is never offered a Medical note type (6.2).

After Complete the app opens the patient's chart (PRD main 101).

As built (the phone's store, unit L3, 4.8): `finishNotes` asks the clock first (hard stop 3), then
each note's hash against the one the summary screen showed (9.6), then hard stop 2, then hard stops
1 and 5 note by note through `signoffEffect`. Each stops Complete with nothing written: the clock
as `ChartingPaused`, a changed hash as `NoteChanged`, hard stop 2 as a `LocalValidationError`
`needs_attention`, hard stops 1 and 5 with the server's problem, `incomplete` or
`red_flags_first`. Hard stop 4 is the domain layer's (L4). An empty draft is refused as `empty`,
or as `incomplete` when its finish check fails (the person's own Red flags note, hard stop 5),
unless a refused sign-off of it waits: Complete then sends that sign-off's fix, which changes
nothing and settles the refusal (3.4).

As built (the phone's domain layer, unit L4, `apps/mobile/lib/encounters/complete.dart`, with its
review): Complete is a plan, then a call.

- **The plan.** `openComplete(encounterId, redFlagsFinished:)` loads the definitions of the visit's
  notes, offline too, and gives the summary screen a `CompletePlan` (`readComplete` is the same, the
  definitions loaded): the notes Complete finishes, in the visit's order with the Red flags note
  last (the store sends it first); for each, the hash of what the phone holds (`contentHashOf`), its
  recap lines worked out in the same read (9.6), its act by the table above (`sign` for a Medical
  note when the saved profile's credential signs, else `complete`) and its statement version
  (`sign-2026-11` or `complete-2026-11`, 12.1 #5 and #23); the button's wording; the signing
  sentence when a note will be signed (3.5); the teammates' drafts that stay drafts, each named as
  its note names whoever acts as its author (D108); the person's notes sent for review; and what
  stops Complete, each a line naming the note it is about and, for a missing answer, the section and
  the answer to open.
- **What it finishes**, besides the drafts of the first paragraph: the person's own Red flags note
  while it is still an empty draft, when a Medical note is finished and the visit has no finished
  one, so its finish check asks the red-flag question (hard stop 5, forms 6.2); and each note of
  theirs whose sign-off was refused and that was finished since or removed (an empty draft), marked
  `settlesOnly`: its fix changes nothing and settles the refusal (3.4; review findings SFN-1 and
  SFN-7). Without it hard stop 2 would hold the visit for good. Such a note words no button and
  makes no signing sentence.
- **What stops it**, said before Complete is pressed: hard stops 1 to 5, each as the store would
  refuse it. Hard stop 1 is one line per missing answer ("{note}: {section}, “{field}” needs an
  answer."). Hard stop 5 comes with no note to open when the person has no Red flags note at all
  (the team's list on the phone named no Red flags type when the Medical note was added, say): the
  summary adds theirs (`addRedFlagsNote`, forms 6.2) and plans again. Then what the store refuses
  with less to say: a note whose last Complete still waits to send after a reopen (4.8), a note
  whose form the phone lacks, nothing of theirs to complete, and what the server would hold for a
  Program Admin, which the person could never fix: a role without `encounters.chart`, and a Medical
  note from a credential that doesn't chart Medical (4.2). Hard stop 4 is asked in the plan only:
  the store refuses removing a visit's patient (4.8), and while the visit's create is refused, hard
  stop 2 stops Complete.
- **The call.** `complete(plan, addToAssessment:)` refuses at once, writing nothing, with the
  plan's stops. It then asks, before the store, whether a note was sent for review, was finished,
  has left the phone or has a Complete waiting to send since the summary drew it, which the store
  would say only as `RecordLocked` (a note gone from the phone is "This note changed. Read it
  again."); then it calls `finishNotes` with the plan's hashes, acts and versions, the profile's
  `Signer`, the definitions loaded and the plan's `redFlagsFinished`. What was added to the
  assessment is an addendum to the visit, made in the same transaction and naming the first
  sign-off made, so it waits behind it (4.7, 9.6). Each refusal comes back as a `CompleteRefused`
  carrying the summary's sentence: the clock, `NoteChanged` ("This note changed. Read it again."),
  `needs_attention`, `incomplete`, `red_flags_first`, `not_author`, `empty` and `RecordLocked`. A
  sign-off the registry refuses is a fault of the app, and is thrown as it is.
- **A removed note whose fix waits** (the review; the coordinator's decision of Nov 18): a note the
  person removed (9.4), whose refused sign-off's settling fix still waits to send, is not the draft
  Add note opens again for its type, nor the one Expand fills: a new draft is made beside it. Opened
  again and charted on, it would be stopped by Complete as waiting to send, in a sentence about a
  Complete the person did not make; left empty, the fix settles the refusal at the next sync. It
  stays an empty draft of theirs after that, so Add note and Expand take a draft of the person's
  own that holds answers before an empty one: the draft charted on since opens, not the removed
  note, and Expand never fills the removed note beside it.

### 3.4 What a sign-off does

The server decides the `effect` of each sign-off. The phone shows the same effect at once and is
corrected by the receipt if the server decided otherwise.

| The note on the server | Act | The server's check | `effect` | Note afterwards |
|---|---|---|---|---|
| draft, Non-Medical note | `complete` | hash matches, finish check passes | `completed` | Complete |
| draft, Medical note | `complete` | same | `completed` | Waiting for a co-signer |
| draft, Medical note | `sign` | same, and the credential can sign | `signed` | Signed; attestation `waiting` if the credential needs it |
| draft, Medical note | `sign` | same, but the credential cannot sign | `saved_unsigned` | Waiting for a co-signer |
| draft | any | the hash does not match | refused: `content_changed` | Draft |
| draft | any | the finish check fails | refused: `incomplete` | Draft |
| draft, Medical note | any | the visit has no finished Red flags note | refused: `red_flags_first` | Draft |
| draft | any | the sender does not act as the author | `none` | Unchanged; the sender is told |
| draft, empty (every answer blank, 3.1) | any | the hash matches | `none` | Unchanged: a draft |
| draft, Non-Medical note | `sign` | treated as `complete` | `completed` | Complete |
| already finished | any | none | `none` | Unchanged |
| completed, Medical note | `cosign` (online, 5.3) | hash matches; a second person; can sign; can see every answer that counts | `signed` | Signed; attestation by the co-signer's credential |

Five of these need a word.

- **`saved_unsigned`** is the PRD's signing rule: "The author's credential can't sign this note
  type: saved as unsigned and routed to a co-signer instead" (PRD main 558). The phone only sends
  `sign` when its saved profile says the person can sign, so this happens when a credential was
  lowered while the phone was offline. The receipt is **accepted** and says what was done, and the
  person gets a notice with the existing sentence (`services/api/src/sync/apply.ts:34`). It is not
  a rejection, because the worker has nothing to fix, and an open rejection is a hard stop on
  their next route confirmation (PRD main 562). See 12.3 #2.
- **`none`** covers the same person completing a note from two phones. The second sign-off is
  stored and changes nothing. If its hash differs from the one that finished the note, the
  receipt says so and the person is told to open the note and read what was signed (the phone's
  own notice `finished_differently`, 9.13).
- **A sign-off from someone who does not act as the author** is stored with effect `none`. The
  screens never send one, and the worker could not fix a refusal (4.1).
- **A sign-off of an empty draft** is stored with effect `none`, reason `empty`, and the note
  stays a draft. An empty draft does not count (3.1), and there is nothing to fix by completing
  it, so it is never refused. Complete skips an empty draft (3.3), so the phone sends such a
  sign-off only as the fix of an earlier refused one, after the person removed the note (Remove
  this note blanks its answers, 9.4): it changes nothing, and so settles the refusal (the
  coordinator's decision on review finding SFN-7).
- **A refusal** (`content_changed`, `incomplete`, `red_flags_first`) leaves the note a draft on the server and puts
  the sign-off in Needs attention. The fix is the same act again: open the note, look, Complete.
  The phone then sends the same sign-off record again with the new hash, through `finishNotes`
  (4.8), so the refused one is settled and nothing that waited behind it is left waiting. Every
  refusal can be settled so: when the note was finished since (on the person's other phone, say)
  or removed since, the fix still goes, over the note as the phone holds it, and is stored with
  effect `none`, `already_finished` or `empty` (review findings SFN-1 and SFN-7).

### 3.5 Who may sign what, and under which credential

PRD module 1 (PRD main 206-216) and the capability table already in the code (1.3):

| Credential | Medical encounters | Signs | After signing | Co-signs a student's note | Attests |
|---|---|---|---|---|---|
| Attending | Yes | Yes | Nothing is held | Yes | Yes |
| Resident | Yes | Yes | In the chart at once; held out of the billing export until an attending attests | Yes, and the note then waits for attestation | No |
| NP | Yes | Yes | Same as resident (PRD main 212, 216) | Same | No |
| PA | Yes | Yes | Same as NP (PLAN-OPEN, plan section 6) | Same | No |
| Student | Yes | No: "routes to a co-signer" (PRD main 213, 385) | Waits for a co-signer | No | No |
| CHW, none | No | No | | No | No |

**What is held until attested.** Only the billing export (PRD main 216, 454, 649). The note is in
the chart at once, and nothing else waits on it. Phase 10 exports a note when `status = 'signed'`
and `attestation` is `not_needed` or `attested`; drafts and unsigned notes stay out (PRD main 99).

**What a co-signature or an attestation waits for.** Its own note alone. Neither waits for the
visit's Red flags note: with that note reopened to a draft, the visit's other waiting notes are
co-signed or attested all the same. The Red flags rule (`red_flags_first`, 3.3 hard stop 5, 3.4)
governs finishing a note, and a co-sign or an attestation adds a signature to content already
finished (the coordinator's decision on review finding LAC-6; 5.3).

**When an offline signature counts.** The default in `IMPLEMENTATION_PLAN.md` section 6 stands:
the signature time is the clock-corrected device time; the server receipt time is stored beside
it; the billing export will use the signature time. `note_signoffs` holds `signed_at`,
`signed_device_time`, `received_at` and `clock_verified`. A time the phone could not verify is
stored as it is and shown as "time not verified". PLAN-OPEN 12.1 #1.

**The credential a signature is recorded under.** "Signed notes keep the credential they were
signed under" (PRD main 133) and "moving down removes permissions at once" (PRD main 223). An
offline signature is checked days later, so the server must know the credential at the time of
signing, not at the time of syncing. A resident who signs on Monday, becomes an attending on
Tuesday and syncs on Wednesday signed as a resident, and that note needs attestation, when the
draft had reached the server before the signature. When the whole note arrives on Wednesday, the
Monday time is not trusted (rule 1, below): the row records the credential held when the server
received it, attending, with the claim (resident) beside it, and the note still waits for
attestation because the claim says resident (rule 4). PLAN-OPEN 12.1 #22.

The function `signedUnder` decides it, for a sign-off and for a correction alike (4.7). It is
server-only and pure:

| Input | From |
|---|---|
| `current` | The signer's membership now: credential and fields (also when they were removed since) |
| `laterChanges` | `membership_changes` rows of kind `credential` or `restored` for that membership, made after `signedAt`, oldest first, each with its `old_value` (1.3; 3.12) |
| `signedAt`, `receivedAt`, `clockVerified` | The change |
| `notBefore` | The time the server received the note's create |
| `claimed` | The credential the phone's saved profile showed |

1. The time is **trusted** when `clockVerified` is true, `signedAt` is not more than 5 minutes
   after `receivedAt` (the clock limit, `services/api/src/sync/push.ts:19`) and `signedAt` is not
   before `notBefore`. `clockVerified` is the phone's own word
   (`services/api/src/sync/records.ts:342`), so a time that claims to come before the note
   existed on the server is not believed: it could date a signature to before a credential was
   lowered. A time that cannot be read (`signedAt`, `receivedAt` or `notBefore`) is not trusted.
2. If the time is trusted and `laterChanges` is not empty, the credential and fields are the
   `old_value` of its first row: what the person held until that change.
3. Otherwise they are `current`.
4. The signature needs attestation if the credential found needs it, **or** the claimed one does.
   The claim can only make the answer more careful, never less.
5. If the credential found cannot sign, the effect is `saved_unsigned`.

The row stores the credential found, its NPI and fields, and the claim. When they differ, the
audit event says so.

**The wording a signer is shown.** The PRD gives none. Each is a fixed sentence with a version,
stored on the row. PLAN-OPEN 12.1 #5.

| Act | Version | Sentence |
|---|---|---|
| `sign` | `sign-2026-11` | "By completing, you sign this note as {name}, {credential}." |
| `cosign` | `cosign-2026-11` | "I reviewed this note and agree with it." |
| attest | `attest-2026-11` | "I reviewed this note and agree with the assessment and plan." |

### 3.6 A finished note never changes; addenda and corrections do

PRD: "A signed note is locked; changes become addenda with author and time" (PRD main 452).
"Nothing is ever overwritten or deleted" (PRD main 460). "Signed notes can't conflict: later
changes are addenda" (PRD main 583). This design applies the lock to every finished note, signed
or not, so a completed Non-Medical note is as final as a signed one (12.3 #3).

**A late edit is kept, not refused.** Two phones can hold the same draft. One finishes the note;
the other's edit arrives afterwards. Today that edit is refused with `record_locked`
(`fields.ts:200`), and the worker is left with a rejection nothing can fix. From phase 4:

- The edit is accepted and kept in the field's history (`kept_both`, history only). The note is
  unchanged. The receipt carries the note's value, so the phone shows what the note says.
- The person who made the edit is told: "The note was already finished. Your change was kept in
  its history. Add an addendum if it matters."
- The note's author is told when the edit came from someone else. This is the Oct 19 rule: "If the
  other value came from another user and the change is rejected, both versions are kept and the
  note's author is told" (PRD main 100).
- The same holds for an edit to the envelope of an encounter that has a finished note, and for a
  reopen that arrives after someone co-signed.

This follows D42: a race the worker can't fix is accepted as history with a notice.

**Reopen.** Before signing, "the author can change anything" (PRD main 458). A Medical note that
waits for a co-signer and was never signed can be sent back to draft by whoever acts as its
author. It is a `set` of the note's `status` to `draft`. Nothing else is ever reopened. A
co-signer who wants changes says so to the author; the PRD describes no "return" step
(PLAN-OPEN 12.1 #8).

**Addendum.** "A dated entry by its author attached below the note, such as a lab result that
came back later" (PRD main 459). Anyone with `encounters.chart` can add one to a finished note, or
to a visit that has a finished note. It is append-only and changes no state. It works offline:
written before its note's sign-off is confirmed, it waits behind that sign-off (4.7; PRD main
564).

**Correction.** "The author picks the wrong field, enters the right value and gives a reason. The
note shows the new value, and the old one stays visible struck through with who changed it and
when" (PRD main 460).

- Who: whoever acts as the note's author (3.8). "The original signer corrects their own note"
  (PRD main 461).
- What: one to ten answers (`data.<path>`) of a finished note, changed together, each with its
  new value and the version of the answer the person was looking at; and one reason of 3 to 500
  characters. Several go together because one answer can open another: correcting "EMS
  activated" to Yes makes the time required.
- The server writes the new values with history kind `corrected`, and a `note_corrections` row
  with the old values, the reason and who.
- If every answer already holds its new value, the correction is stored as `no_change`. So is one
  that changes nothing the note shows: every answer it changes is hidden by a condition before it
  and after it (4.7 step 7). Beside a change that shows, such an answer is written when the person
  held its version, which has not moved: they saw it and changed it. One they never held is left
  as it is, and the correction does not name it (review finding R1).
- If an answer changed since the person looked (another correction got there first), it is
  refused with `field_changed`. The fix is to look again and correct again, or leave it (4.1). An
  answer the note's read never sent the person has not changed for them, when they held no version
  of it: one blank now, as Complete leaves an answer it dropped, or one a condition hides as the
  note stands, as an earlier correction leaves an answer it hid (D109, 4.7 step 6).
- If the note would then fail its finish check, it is refused with `incomplete`: a correction
  can never leave a signed note without the consent a sensitive exam needs.
- A correction that reaches a draft is applied as an edit to the draft. This happens only when
  the note was reopened in between.
- The free-text summary is not corrected field by field. A wrong summary gets an addendum
  (PLAN-OPEN 12.1 #9).
- Works offline. The credential it is recorded under is found as for a signature (3.5).

**After a correction, a second look.** "A co-signed note goes back to the co-signer after a
correction" (PRD main 461).

| The note before | The corrector's credential | The note after |
|---|---|---|
| Signed, nothing held (an attending's own note) | attending | Unchanged: Signed |
| Signed, waiting or attested | resident, NP, PA | Signed, **waiting for attestation** again |
| Signed (a student's note that someone co-signed) | student | **Waiting for a co-signer** again; `signoff_id` cleared; `first_signed_at` kept, so it can't be reopened |
| Complete (Non-Medical) | any | Unchanged: Complete |
| Waiting for a co-signer | any | Unchanged |

A corrector whose credential can sign leaves the note signed: the correction row carries their
name and credential and stands as their signature on the change. The rule in one line: a note is
`signed` only while its current content is covered by someone who may sign.

The table is for a correction that changes what the note shows. One that changes only answers
hidden before it and after it is stored as `no_change` and does none of it: no co-sign is cleared,
no attestation undone, and nobody is told that a note they signed was corrected (review finding
F4).

**A patient's request to amend** "uses the same correction path, with the request and the
decision logged" (PRD main 463). The correction carries `requestedByPatient`. Accepting the
request is a correction. Refusing it is a correction with `outcome: 'declined'`: the value asked
for and the reason are stored and the note is unchanged. Phase 3 does the same for legal name and
birth date (`services/api/src/patients/corrections.ts:23-27`). What HIPAA §164.526 asks beyond the
log (a written answer within 60 days, the patient's statement of disagreement) is for counsel
(PLAN-OPEN 12.1 #10).

**A note already in a billing export**: "the correction flags it for Billing/Data to review"
(PRD main 462). Phase 10 builds the flag from the correction's time (2.6).

As built on the phone (the domain layer, unit L4, `apps/mobile/lib/encounters/note_actions.dart`,
with its review). The visit screen asks `mayReopen`, `mayAddAddendum`, `mayAddVisitAddendum` and
`mayCorrect` what to offer (9.7). Each action refuses, writing nothing, what the server would
refuse, or hold for a Program Admin where the person could never fix it, and waits while the store
is frozen or the clock check fails (3.11):

- **Reopen** (`reopen`) is the store's `reopenNote`, with the definition of the note's own version
  (4.8). It asks first whether the note was sent for review ("This note was sent to a Program Admin
  for review. It can’t be changed until they decide."), and refuses a role that doesn't chart and,
  for a Medical note, a credential that doesn't chart Medical: a reopen from a credential lowered
  since would be held (4.2).
- **An addendum** (`addAddendum`) is 1 to 4,000 characters once trimmed, below a note or below the
  visit itself. While a sign-off this phone made of the note (for the visit's own, of any note of
  the visit) waits to send, or waits refused in Needs attention, the addendum names it and waits
  behind it (4.7). It is refused `cannot_read` on a note the person may not read, which the server
  would hold (6.4), and so, offline, on a teammate's note whose definition the phone lacks. It is
  taken on a draft, as the server takes it; the screens offer it on a finished note only.
- **A correction** (`correct`) changes one to ten answers of a note finished as the phone knows it
  and not sent for review, by whoever acts as its author. Refused here: a draft (`draft`: a draft
  changes in the form, and the server would apply the correction as a draft edit the person never
  saw); an answer of a section that needs an ordering credential the person lacks (`read_only`, 6.4
  rule 5); what `checkAnswer` refuses; `no_change` when every answer already holds its new value or
  is hidden before the correction and after it, such an answer being left out of the correction
  ("Nothing changed: each answer already says that, or isn’t shown in the note."); `incomplete`
  when the note would then miss a required answer (4.7, step 8); and a reason outside 3 to 500
  characters. An answer that shows before or after is sent: a clear, a removed entry's marker, a
  detail changed beside the answer that hides it. A declined request is not asked `checkAnswer`,
  `no_change` or `incomplete`, as the server takes it (4.7, step 4 before step 5). The correction
  claims the saved profile's credential (3.5) and names a waiting sign-off of the note, as an
  addendum does.
- **A note or a visit not on the phone** is opened from the server first (`openServerRecord`, 4.8,
  8.2); offline the action says "This note isn’t on this phone. Connect, then try again.".
- **The correction's `baseVersion`** for each answer is the version the person read, the one the
  server will hold once this phone's own waiting changes are applied: a confirmed answer's server
  version; otherwise that version and one more for each change waiting here that writes the answer,
  the note's create (which writes each of its answers at version 1) and each set, but a Keep theirs
  choice (`keep_server`), which the server takes at the version it holds (review finding LCM-3). An
  answer never written is at 0. The phone's copy alone gave 0 for a note whose create had not been
  sent, which the server refused `field_changed`. A set waiting here whose value is the one the
  server holds already is still counted, which the phone cannot see, and that correction is refused
  `field_changed`: the store giving the version a correction saw would end the count (open, the
  store's).
- **An answer Complete dropped** (review finding LCM-1, D109). Complete takes an answer that does
  not count off the phone (4.8), and the server holds it blank at a version the phone never learns
  (D107), so a correction that brings it back sends `baseVersion` 0. The server refused that
  `field_changed`; correcting again sent 0 again, so the refusal could never settle, and while it
  waited in Needs attention it kept the visit on the phone and hard stop 2 stopped every later
  Complete of the visit. Step 6 now takes a change to an answer blank now that the sender held no
  version of, as a draft edit fills a blank (4.7; `note-correction.ts` and the test server, with a
  parity case). A refusal a phone already holds settles when **Correct again** sends the same
  record with the versions now seen, 0 for that answer. A sender who held a version of an answer
  blank now at a later one is still told `field_changed`.
- **An answer a correction hid** (review finding F2, the coordinator's decision of Nov 18, widening
  D109). A correction that hides an answer keeps it in the note at its version (4.7), and a
  finished note's read leaves it out, since it does not count, so the phone holds no row of it. A
  later correction that shows it again sent `baseVersion` 0 and was refused `field_changed` for
  good, as above. Step 6 now also takes a change at version 0 to an answer that does not count as
  the note stands; its old value goes to history, so the note shows it struck through. At step 7 a
  correction whose changes are all to answers hidden before it and after it is `no_change`, with
  none of the table's effects (review finding F4). Beside a change that shows, a hidden answer is
  written when the person held its version (two corrections made offline in a row on one phone,
  the first hiding an answer the second changes, as the phone still shows it), and one they never
  held is written only by a correction that shows it again; a `corrected` correction names only
  the answers it wrote, in its row, its audit event and the reads (review finding R1). The phone
  holds no row of a hidden answer, so it leaves one hidden before and after out of what it sends.
  A correction of only an answer that a correction still waiting on the same phone will hide is
  sent, as the phone still shows it, and the server stores it as `no_change`, telling nobody (open,
  the coordinator's: whether Correct should read the note with the phone's waiting corrections
  applied, and refuse it here).
- **Correct again** (`correctAgain`, for Needs attention, 9.13) sends a refused correction again
  as the fix of its refusal (the store's `fixRejected`): the same record, answers and reason, each
  answer at the version the person reads now by the rule above, 0 for one the phone holds no row
  of. It refuses, sending nothing, what **Correct** refuses of the note as the phone now holds it:
  `not_author`, `sent_for_review`, `draft` for a note reopened since, which the server would edit
  as a draft the person never saw, and `read_only` (review finding R3).
- **Leave it** (`leaveIt`, 9.13) sends the same record as the fix of its refusal with each answer
  at the value and version the phone now holds, so the server stores it as no change and the
  refusal settles. An answer the phone holds no row of (blank, or hidden as the note stands) is
  left out, so the server keeps its value: sent blank from 0 beside an answer that shows it again,
  step 6 would take it and step 7 clear it (review finding R2). With no answer held, the first
  goes alone, blank from 0, which counts neither before nor after. It is sent in any state of the
  note, since it changes nothing: on a note reopened since it is a draft edit that writes nothing,
  and from someone who no longer acts as the author it is stored as `not_author`. Needs attention
  holds no rule of its own for either button.

### 3.7 Co-sign and attest

Both are done by a second person, and both are online only (5.3, 5.4). The reason is in the
one-page summary: a second person must never be left with a refused change. An online answer
says at once "this note changed, read it again", and nothing waits on the phone.

- **Co-sign**: someone whose credential can sign reads a note that waits for a co-signer and
  signs it. The note becomes Signed. If the co-signer is a resident, NP or PA, it then waits for
  attestation; if an attending, nothing more is needed. PLAN-OPEN 12.1 #6: whether only an
  attending may co-sign.
- **Attest**: an attending reads a signed note that waits and attests it. "Attesting adds a dated
  statement below the note and doesn't change it" (PRD main 216).
- Nobody co-signs or attests a note they wrote, completed or act as the author of (as built,
  5.3: an assignment moves who acts as the author, not who wrote the note). Nobody attests a note whose
  current signature is their own: a resident who co-signed a student's note and later became an
  attending does not attest it.
- The person must be able to read every answer of the note that counts (6.4, rule 4). An
  attestation of a note one can't read in full would be untrue.
- Both carry the hash of the note as the person read it. If the note was corrected in between,
  the server answers `409 content_changed` and the screen loads it again.
- The queues are team-wide: every attending sees every note that waits (PRD main 216: "an
  Attestation queue"). Where a note comes back after a correction, the queue shows who signed or
  attested it before, first.

### 3.8 When the signer has left the team

"If they've left the team, a Program Admin assigns another clinician with the same or higher
credential" (PRD main 461).

- A note's **acting author** is `assigned_user_id` when set, otherwise `author_user_id`.
- A Program Admin (`team.manage_users`) assigns a note online (5.5), with a reason, when its
  acting author is no longer an active member of the team.
- The assignee must be an active member with `encounters.chart` and a credential whose `rank` is
  at least the rank the note was signed under (`note_signoffs.signer_credential` of the current
  signature), or, for an unsigned note, the author's last credential.
- The assignee can then do what the author could: correct a finished note, and complete a draft.
  A draft they complete carries their own signature and credential. The PRD names corrections
  only; drafts are included because a removed author's draft would otherwise stay a draft for
  ever (PLAN-OPEN 12.1 #7).
- Every assignment is a `note_assignments` row and an audit event.

### 3.9 The 24-hour incomplete alert

PRD: "a note still incomplete after 24 hours alerts its author, the route lead and the Program
Admin" (PRD main 99).

- **Overdue** means: the note is a draft on the server, and more than 24 hours have passed since
  its encounter started (`encounters.started_at`; when that time was not verified, the time the
  server received the encounter). One constant, `INCOMPLETE_AFTER_HOURS = 24`.
- It is worked out when it is read. Nothing is written at the 24-hour mark, so nothing can be
  missed by a job that did not run (1.2, last row).

| Who | Where it shows | From |
|---|---|---|
| The author | Phone Home: **Notes to finish**, with how many are older than a day (9.9) | Drafts on the phone, worked out offline; plus the server's list of their drafts that are not on this phone, when online (5.6) |
| The Program Admin | Portal Home: a count; the **Notes not complete** page (9.12) | `GET /v1/team/incomplete-notes` (5.6) |
| The route lead | Phase 7 | Routes do not exist yet (no route table in `db/migrations/`). The list route takes an author filter, which the post-run report and the lead's view will use. |

- **No notification leaves the app in phase 4.** Push notifications arrive in phase 6 (Build plan
  97). When they do, the text has no patient details, as PRD main 746 requires ("2 tasks due
  today"). The sentence reserved for it: "A note is waiting to be finished."
- A draft that never synced is unknown to the server. Its author still sees it on their phone,
  and the devices page already flags a phone holding work for more than 24 hours
  (`services/api/src/sync/devices.ts:408-409`).
- A note completed offline and not yet synced still shows as overdue to the admin. That is
  correct: the server does not hold it yet.
- An empty draft is not counted (3.1).

### 3.10 Encounters without a patient, and switching to Medical

- An encounter may have no patient (`patient_id` is nullable, 1.1). Phase 3 uses this for someone
  who declines to be registered (`docs/design/phase-3-patients.md:1933`). Such an encounter holds
  Non-Medical notes only: a Medical note needs a chart to live on. The create of a Medical note
  on an encounter with no patient is refused with `medical_note_needs_patient`; the fix is to
  name the patient, which stays possible at any time (3.1). PLAN-OPEN 12.1 #11.
- `kind` goes from Non-Medical to Medical at any time (PRD main 379), finished notes or not, and
  never back. Nothing is re-entered on a switch: the notes and their answers stay as they are.
- A Medical encounter offers every note type. A Non-Medical encounter offers the Non-Medical
  note types. A Medical encounter that ends up holding only Non-Medical notes is harmless: no
  note in it takes a signature.
- A visit charted on the wrong patient after a note is finished has no fix in the app in this
  phase (12.2, question 5).

As built on the phone (the domain layer, unit L4, `encounter_repository.dart`, with its review): a
Medical visit names its patient from the start. Start refuses, writing nothing, a Medical visit with
no patient (`medical_note_needs_patient`, "A clinical note needs a patient. Choose who this visit is
for."): the design said only that Switch to Medical asks for the patient first (9.3), and Start
follows the same rule, since a Medical visit is there for its clinical notes (12.1 #11). **Switch to
Medical** on a visit with no patient takes the patient with it, both set in one transaction, and
refuses a patient other than the visit's own; on a Medical visit it sends nothing. A Medical note is
refused on a Non-Medical visit (`not_offered`, "Switch this visit to Medical to add a clinical
note."), which offers Non-Medical note types only, and, as the server refuses it, on a visit with no
patient. Each refuses a role without `encounters.chart` and, for Medical, a credential that doesn't
chart Medical (`not_charting`, `medical_credential`): the server would hold either for a Program
Admin, which the person could never fix (4.2), where the design only hides such an action (6.2).

### 3.11 The clock pause

Encounters and notes already stop while the clock check fails (D35,
`apps/mobile/lib/sync/local_store.dart:414-422`). Sign-offs, addenda and corrections stop too:
their device time is what the record shows. A referral does not stop: its date is typed by the
person, and it registers something said in the street, like an alias or an allergy (D35).

As built (the phone's store, unit L3): `finishNotes`, the only way a sign-off is made or fixed
(4.8), and `reopenNote` throw `ChartingPaused` and write nothing while the check fails, so the
fix that settles a refused sign-off waits too. `createRecord`, `fixRejected` and
`replaceRejected` do the same for an addendum and a correction, by the registry's
`pausesWithClock`, which `_guardFor` reads, and not for a referral.

### 3.12 The small core: pure functions, pinned by vectors

The rules above are data. Each function is written once in TypeScript and once in Dart, has no
database or network in it, and is tested against one JSON file that both sides read, as
`packages/contract/test-vectors/access.json` is today (`docs/plan/patterns/shared-vectors.md`).
The sync core and the routes (level X and T) only load the inputs and write what a function says.

| Vector file (in `packages/contract/test-vectors/`) | Functions | TypeScript | Dart |
|---|---|---|---|
| `note-content-hash.json` | `noteContentHash` (4.5) | `services/api/src/encounters/content-hash.ts` | `apps/mobile/lib/encounters/content_hash.dart` |
| `note-lifecycle.json` | the ten functions below | `services/api/src/encounters/rules.ts` | `apps/mobile/lib/encounters/rules.dart` |
| `signed-under.json` | `signedUnder` (3.5) | `services/api/src/encounters/signed-under.ts` | none: the phone never decides this |

Each vector file has the shape the recipe gives: a `note`, and for `note-lifecycle.json` one list
of cases per function, each case `{ "name", "input", "expected" }`. The planner writes the vector
files and both readers (`services/api/test/encounter-rules.test.ts`,
`apps/mobile/test/encounters/rules_test.dart`) first. The functions are then T cards.

As built: `note-lifecycle.json` is `{ "note", "cases" }`, where `cases` is an object keyed by
function name (`cases.signoffEffect`, `cases.encounterStatus`, ...), each a list of
`{ "name", "input", "expected" }`, so a reader can check that the file holds exactly the ten
functions. `input` is the function's one argument; for `encounterStatus` it is the list of
notes, and the 0018 test reads those cases against the trigger. `signed-under.json` is
`{ "note", "cases" }` with one list. The Dart functions take named parameters and answer with
enums and sealed classes; `rules_test.dart` turns each answer back into the vector's JSON, so
both sides are held to one file. The content hash (4.5) is
`services/api/src/encounters/content-hash.ts` and `apps/mobile/lib/encounters/content_hash.dart`,
each with `noteContent` (the map hashed) and `noteContentHash`; the TypeScript one is async, as
WebCrypto is, and the Dart one is not. Both take the definition and read `noteTypeKey` and
`noteTypeVersion` from it, and write a missing patient or summary as `null`. They are pinned by
`packages/contract/test-vectors/note-content-hash.json` (`{ "note", "cases" }`, 21 cases, each
naming one of `forms-conformance.json`'s definitions, with the inputs and, expected, `effective`
(the answers that count), `content` (the text hashed) and `hash`), read by `services/api/test/note-content-hash.test.ts` and
`apps/mobile/test/encounters/content_hash_test.dart`.

The types the ten functions share:

```ts
type NoteStatus = 'draft' | 'completed' | 'signed';
type Attestation = 'not_needed' | 'waiting' | 'attested';
```

**`signoffEffect`** (3.4), for the acts `complete` and `sign`:

```ts
signoffEffect(i: {
  noteStatus: NoteStatus; medicalNote: boolean; act: 'complete' | 'sign';
  actsAsAuthor: boolean; canSign: boolean; needsAttestation: boolean;
  hashMatches: boolean; emptyDraft: boolean; finishOk: boolean; redFlagsDone: boolean;
}): { refuse: 'content_changed' | 'incomplete' | 'red_flags_first' }
  | { effect: 'none'; reason: 'already_finished' | 'not_author' | 'empty' }
  | { effect: 'completed' | 'signed' | 'saved_unsigned'; statusAfter: NoteStatus; attestationAfter: Attestation }
```

The checks run in this order, and the first that applies decides:

1. `noteStatus` is not `draft`: effect `none`, reason `already_finished`.
2. `actsAsAuthor` is false: effect `none`, reason `not_author`.
3. `hashMatches` is false: refuse `content_changed`.

   Then the check the vectors call `empty`: `emptyDraft` is true (every answer of the draft is
   blank, `noteIsEmpty`): effect `none`, reason `empty`. An empty draft does not count (3.1) and
   has nothing to fix by completing it, so it is never refused, and the fix of a refused sign-off
   of a note removed since settles that refusal (3.4). It comes after the hash, so a sign-off over
   content the server does not hold is still refused, and before the finish check. Added with the
   phone's store, as the coordinator decided on review findings SFN-1 and SFN-7; the checks keep
   their numbers, which the vector cases' names use.
4. `finishOk` is false: refuse `incomplete`.
5. `medicalNote` and not `redFlagsDone`: refuse `red_flags_first`. `redFlagsDone` is true when
   the visit has a finished Red flags note, or this note is one.
6. `medicalNote` is false, or `act` is `complete`: `completed`, status `completed`,
   `not_needed`. So `sign` on a Non-Medical note is treated as `complete`.
7. `canSign` is true: `signed`, status `signed`, `waiting` if `needsAttestation`, else
   `not_needed`.
8. Otherwise: `saved_unsigned`, status `completed`, `not_needed`.

`emptyDraft` is `noteIsEmpty` of the answers the note holds: on the server
(`services/api/src/sync/entities/note-signoff.ts`), in the phone's test server, and in the
phone's store over its own copy (4.8). `note-lifecycle.json` holds 38 cases of `signoffEffect`;
seven are about an empty draft: completed, signed, and the order against checks 1 to 5.

**`reopenEffect`** (the table in 4.4):

```ts
reopenEffect(i: { noteStatus: NoteStatus; everSigned: boolean; medicalNote: boolean; actsAsAuthor: boolean }):
  'apply' | 'nothing' | 'keep_in_history'
```

1. `draft`: `nothing`. 2. `signed`, or `everSigned`: `keep_in_history`. 3. Not a Medical note:
`keep_in_history`. 4. `actsAsAuthor`: `apply`. 5. Otherwise `keep_in_history`.

**`correctionEffect`** (the table in 3.6), called only for a finished note that a correction
changes (step 9 of 4.7):

```ts
correctionEffect(i: {
  noteStatus: 'completed' | 'signed'; attestation: Attestation;
  correctorCanSign: boolean; correctorNeedsAttestation: boolean;
}): { statusAfter: 'completed' | 'signed'; attestationAfter: Attestation; clearSignoff: boolean }
```

1. `completed`: unchanged, `clearSignoff` false.
2. `signed` and the corrector cannot sign: `completed`, `not_needed`, `clearSignoff` true.
3. `signed` and the corrector needs attestation: `signed`, `waiting`, false.
4. `signed` and the corrector signs with nothing held: unchanged, false. A note that was waiting
   stays waiting: an attending who corrects one answer has not attested the rest.

**`cosignEffect`** (5.3) and **`attestEffect`** (5.4), one call per note:

```ts
cosignEffect(i: {
  noteStatus: NoteStatus; medicalNote: boolean; actsAsAuthor: boolean; canSign: boolean;
  needsAttestation: boolean; seesAllThatCounts: boolean; hashMatches: boolean;
}): { refuse: 'not_waiting' | 'is_author' | 'cannot_sign' | 'cannot_see_all' | 'content_changed' }
  | { statusAfter: 'signed'; attestationAfter: Attestation }

attestEffect(i: {
  noteStatus: NoteStatus; attestation: Attestation; actsAsAuthor: boolean; isSigner: boolean;
  canAttest: boolean; seesAllThatCounts: boolean; hashMatches: boolean;
}): { refuse: 'not_waiting' | 'is_author' | 'is_signer' | 'cannot_attest' | 'cannot_see_all' | 'content_changed' }
  | { attestationAfter: 'attested' }
```

Each checks in the order its refusals are listed. `not_waiting` for a co-sign: the note is not
`completed`, or it is not a Medical note. For an attest: the note is not `signed`, or its
`attestation` is not `waiting`.

**`mayAssign`** (3.8, 5.5):

```ts
mayAssign(i: {
  actingAuthorActive: boolean; assigneeActive: boolean; assigneeCanChart: boolean;
  assigneeRank: number; neededRank: number; noteHasHiddenSection: boolean;
}): 'ok' | { refuse: 'author_active' | 'assignee_not_member' | 'assignee_cannot_chart' | 'credential_too_low' | 'cannot_see_all' }
```

`noteHasHiddenSection` is true when the note hides an answer from the assignee as if they were not
its author, asked of what the person assigning may see (5.5 as built; review finding PRD-1, the
coordinator's decision of Nov 20): where that person's keys could miss what a path of the
definition holds too, when a note of its type could hold there an answer the assignee could not
see, whatever the note holds; elsewhere, when the note holds an answer that counts that the
assignee could not see. Whoever acts as a note's author sees all of it (6.4), so the check is about
what the assignee's role allows today, before the assignment.

**`noteIsEmpty`**, **`encounterStatus`**, **`envelopeLocked`** and **`isOverdue`**:

```ts
noteIsEmpty(answers: Record<string, unknown>): boolean     // every answer is null, "", [] or {}
encounterStatus(notes: { status: NoteStatus; medical: boolean; empty: boolean }[]): NoteStatus
envelopeLocked(noteStatuses: NoteStatus[]): boolean        // true when any note is not 'draft'
isOverdue(i: { noteStatus: NoteStatus; startedAt: string; startedVerified: boolean;
               receivedAt: string | null; now: string }): boolean
```

`encounterStatus` is the rule of 2.2: leave out every note that is a draft and empty; then no
note, or any draft, is `draft`; a Medical note that is `completed` makes it `completed`; else any
`signed` note makes it `signed`; else `completed`.

`isOverdue` is true when the note is a draft and more than 24 hours lie between `now` and
`startedAt`, or `receivedAt` when the start time was not verified and a receipt time exists
(3.9). Times are ISO 8601 strings in UTC. The phone passes `receivedAt: null` for an encounter
the server has not confirmed.

**`signedUnder`** (3.5), server-only, in `services/api/src/encounters/signed-under.ts`, as built:

```ts
interface CredentialSnapshot { credential: Credential; fields: Record<string, string> }
interface CredentialChange { changedAt: string; oldValue: CredentialSnapshot }   // what was held until then
signedUnder(i: {
  current: CredentialSnapshot;            // the membership now, also when removed since
  laterChanges: CredentialChange[];       // rows of kind 'credential' or 'restored', with old_value
  signedAt: string; receivedAt: string; clockVerified: boolean;
  notBefore: string;                      // when the server received the note's create
  claimed: Credential | null;             // null for a complete and for an online act
}): { credential: Credential; npi: string | null; fields: Record<string, string>;   // fields without the NPI
      timeTrusted: boolean; canSign: boolean; needsAttestation: boolean; claimDiffers: boolean }
```

- **`laterChanges` are `membership_changes` rows of kind `credential` or `restored`**, each with
  its `old_value`. A restore is a re-invite of a removed person, who may come back with another
  credential or another NPI, so since wave A a restore writes `old_value { credential, fields }`
  (the values before it), as a credential change does (`services/api/src/services/memberships.ts`).
  Rows of other kinds carry no credential and are not passed. The portal's member history reads
  only a row's kind, who and the reason, so it did not change.
- The function itself passes over a row that is not strictly after `signedAt`, and takes the
  earliest that is, so a caller that passes the whole history, or another order, gets the same
  answer as one that follows 3.5. A row whose `changedAt` cannot be read is a fault of the
  server, never passed over: the function throws ("a credential change has a time that cannot be
  read"). A `signedAt`, `receivedAt` or `notBefore` that cannot be read makes the time untrusted.
- The result is what the `note_signoffs` row stores: the credential found, its NPI apart from
  its other fields, and `claimDiffers` for the audit event. `TRUSTED_AHEAD_MS` (five minutes) is
  its own constant, so the pure module never imports the sync core; a test holds it equal to
  `CLOCK_LIMIT_MS` of `sync/push.ts`.
- The vectors pin both readings of rule 1 (a time before the server knew the note is not
  believed; a draft that reached the server before the signature is) and rule 4 (a claimed
  student makes an attending's signature wait for attestation), and the restore cases.

## 4. Sync

Everything in this section is level X: it changes `services/api/src/sync/**`,
`apps/mobile/lib/sync/**` and the phone's test server. The frontier model builds it, a second review
reads it, and each rule gets a test that is checked to bite.

### 4.1 What changes, at a glance

| Entity | Change in phase 4 | Rule | Key | Team lock |
|---|---|---|---|---|
| `encounter` | `summary` and `locationText` become settable. `kind` can be set to `medical`. `status` stops being settable. A change that arrives after the first finished note is kept in history. The sync read says whether the visit holds a finished note (`hasFinishedNote`, 4.3). | draft rule while the envelope is open (4.3) | `encounters.chart` | every change |
| `encounter_note` | The note type and version must exist. Answers are checked against the note type. `status` takes one value from a phone: `draft` (reopen). A change to a finished note is kept in history. The sync read says the note's state, and whether it was ever signed (`everSigned`, 4.4). | draft rule while a draft (4.4) | `encounters.chart` | every change |
| `note_signoff` (new) | Create only | append-only (4.6) | `encounters.chart` | yes |
| `note_addendum` (new) | Create only | append-only (4.7) | `encounters.chart` | yes |
| `note_correction` (new) | Create only | append-only (4.7) | `encounters.chart` | yes |
| `referral` (new) | Create; `enteredInError`, set once with a reason | as `patient_allergy` (4.7) | `referrals.create` | yes |

No new reject reason is added. The seven in `services/api/src/sync/schemas.ts:96-106` stay. A
refused rule is `validation` with a `details.problem` that names the rule, the way
`encounter_missing` does today.

**A refusal is kept for what the worker can fix.** A refused change is never dropped, and an
open one stops the worker's next route confirmation (PRD main 562). So a rule the worker cannot
fix is not a refusal here: the change is accepted, kept in history or stored with no effect, and
the person is told. That leaves seven problems, each with the store call that settles it:

| `details.problem` | Raised by | The worker's fix, and how it is settled |
|---|---|---|
| `content_changed` | a sign-off whose hash differs from the note the server holds | Open the note, read it, Complete again. `finishNotes` sends the same sign-off record again (4.8), even for a note finished or removed since, which it then leaves as it is (3.4). |
| `incomplete` | a sign-off on a note that fails the finish check; a correction that would leave the note failing it | Fill in what is missing and complete, or correct, again. The same record is sent again. |
| `red_flags_first` | a sign-off of a Medical note on a visit with no finished Red flags note | Complete again: the Red flags note goes first (4.6). |
| `field_changed` | a correction whose answer changed since the person looked | Look again. **Correct again** sends the same correction record, its answers as they were, each at the version now seen. **Leave it** sends it with each answer at the value and version the phone now holds, which the server stores as no change; an answer the phone holds no row of (blank, or hidden as the note stands) is left out, so the server keeps its value, and with none held the first goes alone, blank from version 0, which changes nothing (3.6, review finding R2). |
| `medical_note_needs_patient` | a Medical note on a visit with no patient | Name the patient (always possible, 3.1). The store then sends the note's create again, and what waited behind it (D49). |
| `unknown_note_type` | a note on a key or version the team does not have | Choose the note type again. The phone only offers listed versions (forms 3.4), so this is a build fault. |
| a problem of `checkAnswer` (`wrong_type`, `unknown_option`, `out_of_range`, and the rest, forms 7.1) | an answer that breaks its definition | Correct the value: phase 2's fix for a refused set. |

What is accepted with no effect, in place of a refusal:

| Change | Answer |
|---|---|
| A `set` of a note's `status` to `completed` (an old build) | Kept in history, problem `use_signoff` |
| A `set` of `kind` to `non_medical` on a Medical visit; a `set` of `patientId` to nothing | Kept in history, problems `kind_cannot_go_back`, `patient_cannot_be_removed` |
| A sign-off, a reopen or a correction from someone who does not act as the note's author | Stored with no effect, problem `not_author`; the sender gets a notice |
| A sign-off of an empty draft (added with the phone's store) | Stored with no effect, reason `empty`; it settles an earlier refused sign-off of the note (3.4) |
| `sign` on a Non-Medical note | Treated as `complete` |
| A correction to a note that is a draft | Applied as an edit to the draft, by the draft rule |

A create that names a note or a sign-off the team does not have is refused with the existing
`stale_reference` (`encounter_note_missing`, `note_signoff_missing`), as any create with a
missing parent is (`services/api/src/sync/apply.ts:494-495`). It is held instead when the
sender's own create of that parent waits for review (`:466-482`). The phone's hold rule keeps
this from happening for a parent that is still on the phone.

**A rule that throws must not stop a queue.** Only a database error of class 23 becomes a stored
rejection today (`apply.ts:287-293`); any other error aborts the push at that change, on every
retry. The new rules call code that reads a definition. In the sync rules a throw from
`definitionFor`, `checkAnswer`, `finishCheck`, `effectiveAnswers` or the hash is caught and
stored as `validation` with `definition_error`.

Each problem gets one sentence in `apps/mobile/lib/features/sync/sync_labels.dart` (9.13).

As built on the phone after unit L5's review, each fix of the first table has its button in Needs
attention (9.13 as built), through the domain layer (4.8 as built): `medical_note_needs_patient` gives
the visit its patient and sends the note's create again (`choosePatientFor`); `unknown_note_type`
sends the create again on the version the team lists for its key now, carrying the answers the
phone holds so they reach the server and its history, then blanks each as a set, so the note counts
for nothing and nothing that never synced is deleted (since the phase's review, finding PS-4, the
coordinator's decision), and the type is then chosen again (`removeRefusedNote`; a type listed at no
other version stays in Needs attention, D121, since the rules let only a remote wipe and the tenth
wrong PIN delete unsynced data); a problem of `checkAnswer` is settled by the next save of the
answer (`saveAnswer`). The version the note is sent again on is one that takes every answer the
phone holds of it (`checkAnswer`, as the server checks each), not only one that has each path: a
version that dropped an option the note holds would refuse the create, and that refusal had no fix
(review finding VS-3, as the coordinator decided; `_carrierOf`). With none, the refusal stays in
Needs attention as D121 keeps a type listed at no version: its card asks the phone's files
(`canRemoveRefusedNote`) and, in place of **Remove this note**, says “This note can’t be removed on
this phone. Tell a Program Admin.”, and nothing is sent.

As built (unit L1, with wave D's review):

- **No new reject reason.** Beside the seven problems of the first table, the build answers
  these, each a stored rejection the queue moves past:
  - `definition_error`, when a rule cannot apply the note's definition: a row that fails its hash,
    or is filed under a key or version its definition does not hold (D79, forms 3.3); a set, a
    sign-off or a correction of a note whose version the team does not hold (a create answers
    `unknown_note_type`); any throw from the interpreter or the hash. `byDefinition` turns a throw
    into a `DefinitionError` and `definitionOf` a `DefinitionMismatch` into one
    (`services/api/src/sync/records.ts`); `applyInSavepoint` rolls back what the change wrote and
    stores the rejection (`apply.ts`). A database error still stops the push: it may pass on a
    retry.
  - `record_exists`: a sign-off or a correction sent under a record ID already taken. A
    correction asks it before anything else, since an applied one writes the note before its row.
  - `referral_in_future`: a referral dated more than a day after the server's date (4.7).
  - `nothing_to_resolve`: the answer to a conflict, sent on a change that never conflicts (a
    visit's `kind`, a note's `status`, a referral's `enteredInError`).
  - `too_many_fields`: the 1,000-answer bound, asked only of a value that would reach the chart
    (4.4).
  - `unknown_field`: a set of an encounter's `status` (4.3), or of any field of a sign-off, an
    addendum or a correction, which are create-only.
- **A refusal of an answer names it where the change does not**: `checkAnswer`'s problem on a
  create carries `{ problem, path }`, on a correction `{ problem, field }`, as `field_changed`
  does; on a set only the problem, since the set names its field.
- **`stale_reference` also answers what a key cannot read as missing**: `encounter_note_missing`
  for an addendum whose note belongs to another visit; `note_signoff_missing` for an addendum or a
  correction that names a sign-off of another note, or, naming no note, of a note of another visit
  (review finding REC-3, the coordinator's decision); `encounter_other_patient` for a referral, a
  problem, an allergy or a problem note that names a visit of a patient outside its patient's
  merged group (4.7). A note create with no `noteTypeVersion` answers `unknown_note_type`: the
  schema keeps the version optional, so the phone's fix path meets the problem this table names.
- **The second table, as built.** Each answers `accepted`: a change kept in history with the
  field as the server holds it and `details: { outcome: 'history_only', problem }`; a sign-off and
  a correction with the effect or the outcome stored.

  | Change | Answer | Who is told |
  |---|---|---|
  | `status` set to `completed` | kept, `use_signoff` | nobody |
  | `kind` set to `non_medical` on a Medical visit | kept, `kind_cannot_go_back` | nobody |
  | `patientId` set to nothing | kept, `patient_cannot_be_removed` | nobody |
  | the patient, the place or the summary after a finished note | kept, `encounter_has_finished_note` | the sender, and whoever acts as the author of each finished note of the visit, once each (4.3) |
  | an answer of a finished note | kept, `note_finished` | the sender, and the acting author when that is someone else (4.4) |
  | a reopen from someone who does not act as the author | kept, `not_author`, when the acting author's own reopen would have applied; otherwise a late change, `note_finished` | the sender alone, `change_not_applied`; a late change as the row above |
  | a sign-off from someone who does not act as the author | effect `none`, reason `not_author` | the sender alone, `change_not_applied` |
  | a sign-off of an empty draft | effect `none`, reason `empty` (3.4) | nobody |
  | a correction from someone who does not act as the author | outcome `not_author` | the sender alone, `change_not_applied` |
  | `sign` on a Non-Medical note | effect `completed`, as `signoffEffect` treats it as `complete` | nobody |
  | a correction to a note that is a draft | outcome `draft_edit`, by the draft rule (4.7) | nobody |

  `not_author` answers before the Medical gate for all three (review finding RD-8): a non-author
  whose credential was lowered is stored with no effect, and nothing waits for an admin who could
  only make it no effect. A note the sender may not read at all is held before either (6.4).

  The phone sends none of the first three rows. It never sets a note's status to `completed`, and
  it refuses a visit's kind set back from Medical and its patient removed, writing nothing (4.8):
  the server keeps both in history and tells nobody, so the person would believe them made.
- **Held for a Program Admin, never refused**: the Medical gate and the gate of a section that
  needs a capability (4.2), a set of an answer the sender may not see (4.4), and any change of a
  note the sender may not read at all (6.4). Each answers `rejected('permission')`, which a push
  holds for review with no `server` value and no details: the receipt and the `sync.quarantined`
  event say only `permission`. Open: whether the admin's queue should name the rule that held a
  change; never the sender's receipt, which would tell them something hidden is there.
- **The sentences**: `sync_labels.dart` names the four new kinds of record (Sign-off, Addendum,
  Correction, Referral), and `apps/mobile/test/features/sync_labels_test.dart` holds every kind of
  the registry to a name. The problems' sentences come with the screens (L5, 9.13).

### 4.2 The signer is loaded, not carried; the Medical gate; the team lock

**The signer.** The actor of a change carries the role's permissions and no credential
(`services/api/src/sync/records.ts:271-293`). It stays that way. When a Program Admin accepts a
held change, the actor is the admin's approval while the signer is still the change's author, so
the credential can't ride on the actor. A new module loads it:

```ts
// services/api/src/encounters/signer.ts
export interface Signer {
  userId: string;
  displayName: string;
  active: boolean;                    // false once removed from the team
  credential: CredentialName;         // the membership's credential now (its last one, if removed)
  fields: Record<string, string>;     // credential_fields now
}
export function loadSigner(tx: Tx, teamId: string, userId: string): Promise<Signer | null>;
export function credentialChangesAfter(tx: Tx, teamId: string, userId: string, at: Date): Promise<CredentialChange[]>;
```

`signedUnder` (3.5) takes what these two return. Both read inside the change's transaction.

**The Medical gate.** A change to a Medical note needs a credential with `chartMedical` (1.3):
the note's create, a `set` of an answer or of `status`, a sign-off and a correction. An addendum
does not: anyone who charts may add one. The same gate covers a section that needs a capability
(6.4, rule 5). The phone offers a Medical note type only to a
credential that may chart it (6.2), so the gate is reached only when a credential was lowered
while the phone was offline. The worker has nothing to fix, so the change is **held for a
Program Admin**, never refused: the rule answers `rejected('permission')` once the note is
loaded, and a permission refusal on a push is already held for review
(`services/api/src/sync/apply.ts:403-423`). When an admin accepts the held change it carries
`approvedBy`, and the gate lets it through; the audit event names who approved.

**The team lock.** `encounterRules.takesTeamLock` and `noteRules.takesTeamLock` return `true` for
every change, and so do the four new entities. A sign-off writes the note and, through the
trigger of 2.2, the encounter. With one lock per team these apply one after the other, so no
rule can read a half-applied sibling and no two changes can lock rows in opposite orders. D32
made this choice for patient-side changes, and encounter sets already take the lock for the same
reason (`services/api/src/sync/entities/encounter.ts:22-24`). The online routes of section 5
take the same lock first.

**Note changes take it already.** Since wave A `noteRules.takesTeamLock` returns `true` for
every note change (`services/api/src/sync/entities/note.ts`), in the same landing as the status
trigger's row lock (2.2). Without it, two note changes of one visit could each work out the
visit's status without the other's note; and a note change locked the encounter row through the
trigger and then waited for the team lock at its audit event, while an encounter set held the
team lock and waited for that row. `services/api/test/sync-concurrency.test.ts` holds it: a
phone's note change waits for another writer of its visit, and the visit's status is right. The
phone's test server has no counterpart: it serves one request at a time.

As built (unit L1, with wave D's review):

- **The signer.** `services/api/src/encounters/signer.ts` has the two functions sketched and
  `chartsMedical`, true only for an active member whose credential charts Medical. `loadSigner`
  names the team in its own query, not only through row-level security, and gives null for someone
  who was never a member. `credentialChangesAfter` passes over a `restored` row with no
  `old_value`: such rows predate wave A, so they are older than any versioned note and never fall
  after a trusted signature time. Any other row it cannot read throws. It rounds each row's time
  up to its millisecond, so the query's `>` and `signedUnder`'s comparison agree.
- **The Medical gate** is `medicalGate` in `services/api/src/sync/entities/note.ts`. It reads the
  sender's membership now, and an admin's accept (`approvedBy`) passes. It holds a Medical note's
  create, every set of one (an answer, a reopen), a sign-off and a correction. It does not hold an
  addendum: `services/api/test/sync-reads.test.ts` sends each of the six from a credential lowered
  offline. On a create it comes after `unknown_note_type` and `medical_note_needs_patient`, so a
  community health worker's Medical note on a visit with no patient is refused, not held; on a set
  it comes before `checkAnswer`, so a lowered credential's invalid answer is held, not refused.
  Whoever does not act as the author meets `not_author` before it (4.1).
- **A section that needs a capability** has its own gate, `needsGate` in the same file: an answer
  in a section marked `needs: 'orderMedications'` needs an active member whose credential orders
  medications, read now, **whoever acts as the author** (review finding NOT-1). Rule 1 of 6.4 is
  about seeing a note, and this gate is about the credential, as the Medical gate is. It runs on
  each answer of a create, on each set and on each change of a correction; an admin's accept
  passes.
- **The team lock.** `takesTeamLock` is true for every change of the visit, the note and the four
  new entities. `services/api/test/sync-encounters.test.ts` ("the team lock") lists every kind of
  change, the creates of addenda, corrections and referrals and a referral's `enteredInError`
  among them, and pins that an encounter naming no patient waits for another writer of the team.
  `sync-concurrency.test.ts` sends two sign-offs and a kind change of one visit at once, ten times
  over, and pins with fixed timing that a sign-off and a correction each wait at the team lock
  before they lock their note or their visit (review finding REC-1).

### 4.3 The encounter

- **Create** takes `kind`, `patientId`, `location` and, new, `locationText` (1 to 200 characters,
  PRD main 378).
- **Settable fields**: `patientId`, `location`, `locationText`, `summary` (1 to 4,000 characters)
  and `kind`.
- **`kind`** takes one value from a phone, `medical`. It applies at any time, finished notes or
  not (3.10). A `set` to `non_medical` on a Medical encounter is kept in history and not
  applied. The create of a Medical note also makes its encounter Medical (4.4), so a note is
  never refused for the kind of its visit.
- **`status`** is no longer in the encounter's field list
  (`services/api/src/sync/records.ts:111-117`), so a `set` of it answers as any unknown field
  does. The trigger of 2.2 owns the column.
- **The envelope lock.** While the encounter has no finished note, `patientId`, `location`,
  `locationText` and `summary` use the draft rule of
  `services/api/src/sync/entities/fields.ts:173-218`. Once any note of the encounter is finished,
  a `set` of one of them is kept and not applied: the rule calls the existing `keepInHistory`
  (`fields.ts:97-147`) with the problem `encounter_has_finished_note`. That function already
  writes the `kept_both` history row and the audit event, and answers `accepted` with `server`
  (the value the encounter holds) and `details: { outcome: 'history_only', problem }`. The
  receipt keeps that shape: the code that replays a stored receipt and the code that decides
  whether a later edit saw the value both read `details.outcome`
  (`services/api/src/sync/apply.ts:163-172`, `:199-205`). The sender gets a notice
  (`user_notices`, kind `late_change_kept`). One exception: a `patientId` set on an encounter
  that has no patient still applies. A patient is never taken off a visit: a `set` of
  `patientId` to nothing is kept in history. This replaces `record_locked` for encounters.
- **A merged patient.** A merge moves no rows (D27). An encounter keeps the patient ID it was
  made with, and every read takes the merged group, so an encounter never needs a redirect.
- **Last seen.** When an encounter that names a patient is accepted, and when a `patientId` set
  is applied, the server moves that patient's `last_seen_at` to the earlier of the encounter's
  `started_at` and the server's clock, if that is later than the value held. It never moves
  backwards, and never past the server's clock.

As built (unit L1, `services/api/src/sync/entities/encounter.ts`, `fields.ts`, `records.ts`):

- **Values.** `summary` and `locationText` are validated and never trimmed, as `values.ts` does
  for every text: a space at either end is refused, so the value stored is the value hashed (4.5),
  and the phone trims both before it sends them. A create takes `locationText`; it refuses a
  `summary`, being a strict object. A set of `status` answers `unknown_field`.
- **`kind` is a field**, at version 1 from the create (a phase 2 row reads it at version 0), no
  longer an attribute, and the snapshot shows no `status` field: the bookkeeping that phase 2 rows
  still carry for one is dropped when a visit is loaded. `kind` has a rule of its own (the
  `status` class, `kindSet`): it never conflicts, so a resolution answers `nothing_to_resolve`;
  the same value is accepted at its version; `medical` applies from any `baseVersion`, finished
  notes or not; `non_medical` on a Medical visit is kept with no notice. The envelope lock does
  not cover it.
- **The envelope lock is a hook of the draft rule**, `EntityRules.keptInstead`, which the note's
  late change uses too (4.4). The draft rule asks, for every entity, in this order: an answer of
  `keep_server`; the same value (accepted at its version, nothing written, nobody told);
  `keptInstead`; `too_many_fields`; then the replace, saw, blank and conflict branches. A
  `keep_server` whose base version is stale asks `keptInstead` first, so on a closed envelope or a
  finished note it is kept in history, never asked again (review finding NOT-10); one that saw
  the current value goes to phase 2's `keepServer`, which can tell the note's author
  `conflict_resolved`.
- **`envelopeKept`**: a `patientId` set to nothing is kept (`patient_cannot_be_removed`, no
  notice), finished notes or not; a `patientId` set on a visit with no patient falls through to
  the draft rule and applies. Otherwise, once any note of the visit is `completed` or `signed`,
  the change is kept (`encounter_has_finished_note`), and `late_change_kept` goes to the sender
  and to whoever acts as the author of each finished note, once each (review finding REC-2: the
  patient and the summary are part of what they signed, 3.6). An encounter is never
  `record_locked`: a signed visit keeps a late change, and takes a new note.
- **A Medical visit's summary from a sender who may not read it** (review finding VS-1, as the
  coordinator decided). The sync read leaves a Medical visit's `summary` out for a sender who does
  not read Medical notes (`medicalHidden`, 5.1). A set of it from such a sender is answered
  `rejected('permission')` and so held for a Program Admin, whatever version it names and whatever
  the visit holds, before the draft rule or the envelope lock answers with the value (`set`,
  `services/api/src/sync/apply.ts`; the fake's `_set`), as a hidden note answer is (4.4, D88). It
  never meets a conflict it could not see into, which no choice of its sender's could settle, and a
  blind Use my value never overwrites an assessment they never saw. A choice made on such a
  conflict from before this rule is held the same way. What a value kept in history or a retry
  sends such a sender of the summary is a field that holds nothing (`fieldForAnswer`, 6.4 rule 2;
  review finding PA-4). An admin's accept applies the held set as it was made, at the version it
  named, as `services/api/src/sync/review.ts` applies every held change (the coordinator's
  decision on the second pass's open question): once a note of the visit is finished it is kept
  in the visit's history, as any late change is (the envelope lock, which is asked first), whatever
  version the summary is at; before that, when the summary holds another value at a later version
  than the one named, the accept is refused `cannot_apply` and the reviewer can only reject it, and
  a summary cleared since is filled. So an accept never puts a value over one its sender never
  saw. A reviewer who may read both can write
  the visit's summary themselves, as anyone who charts may while no note of the visit is finished,
  and after that add to it by an addendum (3.6).
- **`hasFinishedNote`** (review finding SLK-1, as the coordinator decided, with the phone's store):
  the sync read's snapshot of a visit carries it in its attributes, true when a note of the visit
  that the reader is shown is `completed` or `signed`. It is worked out in `fetchRecords`' `asRead`
  (`services/api/src/sync/review.ts`) over the notes the visit's status is worked out from, those
  the reader may read (`notesShown`, `statusShown`, D95), and not in `encounter.ts`'s load, which
  does not know the reader. The phone's envelope lock reads it (4.8), since a visit whose status is
  a draft may hold a finished note: beside a teammate's draft, or a note added after it was signed
  (4.4); and the phone that signed may hold none of its finished notes once they have left it
  (8.2). A finished note the reader may not read leaves it false: their edit of the patient, the
  place or the summary is then sent, kept in history, and `late_change_kept` tells them so. They
  learn that the visit holds a finished note, and nothing more; that is accepted. The contract's
  description of a snapshot's attributes names it.
- **Last seen** moves on an accepted create that names a patient (after its insert) and on an
  applied `patientId` set, on the patient row the visit names, merged or not: reads take the
  group's latest (D27), and the team index's version moves with it. A visit whose start is after
  the server's clock moves it to the server's clock (review finding REC-4): the visit happened, so
  the patient was seen, and a phone's wrong clock never sets a time in the future.
- **Records made at a visit that moves to another patient stay with the first** (review finding
  REC-6, as the coordinator decided; a default, 12.1 #25). The referrals, problems, allergies and
  problem notes made at it keep their patient and still name the visit. Moving clinical records
  by themselves is riskier than showing them, and refusing the visit's move would keep the visit
  on the wrong patient. A chart says "at a visit" only when the visit's patient is in its merged
  group (8.4), so the first chart's records stop naming the moved visit. The visit screen (9.7,
  unit L5) lists the records made at the visit, whichever chart they are on, so the clinician can
  find each one, enter it in error on the first chart and chart it again on the second.

### 4.4 The note

- **Create** is accepted whatever state the encounter's other notes are in. Today it is refused
  with `record_locked` on a signed encounter (`services/api/src/sync/entities/note.ts:50`); from
  phase 4 the note is the unit (the one-page summary, point 1), and a teammate adding a Social
  needs note after the clinician signed must not lose it. The checks on a create, in order: the
  key and version are in the team's `note_type_versions`, else `unknown_note_type`; for a Medical
  note, the encounter names a patient, else `medical_note_needs_patient`; then the Medical gate
  (4.2). A Medical note makes its encounter Medical if it was not, and the note's `medical`
  column is set from its type (2.2).
- **A note with no version** exists only as a phase 2 preview row. It keeps the open path rule it
  was written under, is never checked against a definition, and counts as a Non-Medical note. No
  new note can be created without a version.
- **Phase 2's own tests** chart on made-up note types (`vitals`, `wound_care`) with free paths and
  set `status` to `completed` (`services/api/test/sync.test.ts`,
  `apps/mobile/test/sync/local_store_test.dart`, `sync_scenarios_test.dart`, `live_api_test.dart`,
  `apps/mobile/test/features/sync_flow_test.dart`). Card L1-legacy-tests gives them a test-only note type,
  installed by the API fixtures, the fake and the phone tests, with the paths those suites use,
  and rewrites their status tests as sign-offs. It lands before any rule here changes.
- **Two notes of one type** in one encounter are allowed. Two phones can each add Wound care
  offline, and refusing the second would strand its answers. The phone opens an existing draft of
  that type before it offers to make another (9.4).
- **Answers** (`data.<path>`): each set is checked by the forms part's
  `checkAnswer(definition, path, value)`. This replaces the open pattern rule
  (`services/api/src/sync/records.ts:21`). The check runs in the note's draft path, after the note
  is loaded (`fields.ts`): the schema hooks that run before the load do not know the note's type
  (`services/api/src/sync/apply.ts:507-516`). `MAX_NOTE_FIELDS` rises to 1,000 (forms 2.4). On a
  draft the draft rule applies, unchanged.
- **A sensitive section.** A `set` of an answer in a section the sender may not see (6.4) answers
  `rejected('permission')` and so is held for a Program Admin. This check runs first, for a
  draft and for a finished note alike, and a held change carries no `server` value: otherwise a
  set to a hidden path of a finished note would be answered with the answer it holds. The acting
  author may always set their own note's answers.
- **A conflict its sender may not see into is held** (review finding VS-1, as the coordinator
  decided), for every entity: when a change from a push meets a conflict and the field as that
  sender may see it (`fieldForAnswer`, 6.4) holds nothing, the change is held for a Program Admin
  instead (`decide`, `services/api/src/sync/apply.ts`; the fake's `_decide`). A conflict writes
  nothing, so nothing is undone. A sender is never asked to choose between their value and one they
  are not shown: that choice could never settle, and Use my value would overwrite blind. An admin's
  accept applies the held change as it was made, at the version it named, as `review.ts` applies
  every held change (the coordinator's decision on the second pass's open question): a record
  that takes no more values keeps it in its history first (3.6); otherwise, while the field holds
  another value at a later version than the one named, as it did when the conflict came, the accept
  is refused `cannot_apply` and the reviewer can only reject it, a field cleared since is filled,
  and one that holds the same value takes nothing. So an accept never puts a value over one its
  sender never saw. A reviewer who may read both can make the change themselves.
- **An answer that will not count.** A `set` that lands in a field another phone has hidden, or
  in an entry another phone has removed, is accepted as usual. Its receipt carries
  `details.notCounted` (`hidden_field` or `removed_entry`), and the phone says so on the field:
  "This part was removed. Your change was kept."
- **A change to a finished note** is kept, not refused (3.6): `keepInHistory` with the problem
  `note_finished`, the same receipt shape as in 4.3. The sender gets a `late_change_kept` notice.
  The acting author gets one too when the sender is someone else. This replaces `record_locked`
  (`fields.ts:200`).
- **`status`** from a phone takes one value, `draft`: the reopen of 3.6.

| The note on the server | Sender | Answer |
|---|---|---|
| `completed`, never signed, a Medical note | acts as the author | Applied: the note is a draft again, `completed_at` and `completed_by` are cleared |
| already `draft` | anyone | `accepted`, nothing changes |
| `signed`, or ever signed | anyone | Kept in history with a notice, as a late change |
| `completed`, a Non-Medical note | anyone | Kept in history with a notice: a completed Non-Medical note is final |
| `completed`, never signed, a Medical note | someone else | Kept in history with a notice, problem `not_author` |

A `set` of `status` to `completed` is kept in history (`use_signoff`). Nothing in the app sends
it.

- **What the sync read shows of a note.** The snapshot of a note in `/v1/sync/records` gains the
  attributes `attestation`, `actingAuthorId`, `completedAt` and `signoffId`, so the author's
  phone can show the state of a note it still holds.
- **The author's own sync read of a draft does not go through `visibleAnswers`.** That function
  gives only the answers that count (forms 7.1), and a draft keeps the answers of a hidden field
  so that they come back when the field shows again. Whoever acts as a draft's author is sent its
  stored answers, hidden ones included; everyone else gets the draft through `visibleAnswers`
  (6.4).

**What wave A leaves L1 to do for notes.** The database now refuses what today's note path
still sends, and L1 meets it:

- **Every note path runs under the team lock.** `takesTeamLock` is already `true` for notes
  (4.2); a new path that writes a note, the sign-off and the correction included, keeps it.
- The database refuses a note's `status` set to `completed` alone
  (`encounter_notes_completed_at_when_finished`) and any change of a finished note's answers
  outside a correction (`encounter_notes_finished_data`). Both are stored `server_constraint`
  rejections today, never queue stops. L1 writes `completed_at` and `completed_by` with the
  status, clears them on a reopen, sets `medical` at the create, and answers a late change as
  this section says, before the database is asked.
- `services/api/test/sync.test.ts`, "a signed note refuses changes", already signs its note the
  way the database requires (a `note_signoffs` row, then `status`, `completed_at`,
  `completed_by`, `first_signed_at`, `signoff_id` and `medical` on the note). It still answers
  `record_locked` until L1 replaces that path (3.6).

As built (unit L1, `services/api/src/sync/entities/note.ts`, with wave D's review):

- **The test-only note types** are in `packages/contract/test-vectors/sync-note-types.json`:
  `test_note` (Non-Medical) and `test_medical` (Medical, the same sections), each with a `more`
  section for an answer hidden by a condition; under `redFlags`, `test_red_flags`
  (`auto: 'medical'`), which the sign-off tests install; under `restricted`, `test_restricted` (a
  sensitive exam section, a treatment record, a `needs` section, a picker with a sensitive option,
  a repeating section of diagnoses), `test_sensitive` (`sensitivity: 'sensitive'`),
  `test_assess` (answers that do not count, beside a sensitive diagnosis) and `test_marked` (each
  place a sensitive exam's mark can sit outside an exam section: an Other option, a region, a
  grid's row, a picker in a repeating section). The API's fixtures
  install the first two in every test team (`services/api/test/sync-fixtures.ts`); the phone's
  tests read them through `apps/mobile/test/sync/test_note_types.dart`, and the fake holds them.
  The live job's team gets them from the `db` command `install-test-note-types`, which
  `tools/e2e-db.sh` runs only when `E2E_TEST_NOTE_TYPES=1` (`tools/live-sync.sh` sets it), and
  which refuses a database not marked `test`. Phase 2's tests chart on them; "a signed note
  refuses changes" is now "a signed note keeps a change in history, never applied".
- **A create**, after phase 2's parse and its parent check (a missing visit is
  `stale_reference` first, as for every entity): `unknown_note_type` (no version, or a key and
  version the team does not hold); `medical_note_needs_patient`; the Medical gate; the `needs`
  gate on its answers (4.2); then each answer by `checkAnswer`, the first refusal naming its
  `path`. The `medical` column is set from the type (`isMedicalType`: a type whose kinds leave out
  `non_medical`). A Medical note on a Non-Medical visit then writes the visit's switch as a set of
  its `kind` carrying the note's `changeId`: the field's next version, a history row of kind
  `set`, and an `encounter.updated` event. The note's receipt says nothing of it, and a held note
  changes nothing. A create's own answers are never told `notCounted`.
- **A set** (`noteSet`), in this order: any change of a note the sender may not read at all is
  held (6.4); an answer the sender may not see is held (below); a reopen from someone who does not
  act as the author goes to the status rule, ahead of the gate (4.1); the Medical gate; the status
  rule; the `needs` gate; a finished note's late change, through the draft rule, with no
  `checkAnswer` and no `notCounted`; a phase 2 note's answer by the draft rule alone; otherwise
  `checkAnswer` (its refusal names only the problem), the draft rule, then `notCounted`.
- **A sensitive section, as built** (`hiddenFromSender`, with `mayHoldHidden` in
  `services/api/src/sync/records.ts`; review finding RD-10, as the coordinator decided): whether a
  set from someone who does not act as the author is held depends only on the definition and the
  sender's keys, never on what the note holds, so one set gets one answer on every note. It is
  held whenever the answer could hold something they may not see: in a note type or a section
  they may not read; without `patients.view_sensitive_exams`, any field whose options, rows or
  regions carry the sensitive-exam mark (every part of a region, every row of a grid), the Other
  text of such a field, and, in a repeating section that holds one, each entry's own `entryAt` and
  `entryRemoved`, since an entry the exam was all of goes whole; without `patients.view_sensitive`,
  every answer of a section that holds a diagnosis (a `problem` field), in every entry of a
  repeating one, since a sensitive diagnosis takes its entry or its section with it. So a removal
  of an entry in such a section, and a write into one, are held whatever the entry holds (review
  findings RD-5, NOT-9). The reader is the sender's role and their credential now (`none` without
  a membership), never as the author. Whoever acts as the author, an admin's accept and a phase 2
  note pass. It answers before anything that would send the field back, a conflict or a late
  change. The receipt says only that the change is held (`permission`); why is the reviewer's to
  read. What it costs: of the standard roles only Program Admin holds
  `patients.view_sensitive_exams`, so a teammate's set of an exam picker with a GU, breast or
  rectal option (General primary care's `exam.systems`) on someone else's note always waits for
  a Program Admin; Healthcare Staff holds `patients.view_sensitive`, so its sets of a diagnoses
  section do not. "The acting author may always set their own note's answers" stands for seeing
  (6.4 rule 1); a `needs` section still asks for the credential (4.2). `answerHidden` still
  decides, value by value, what a reader is shown: the review queue and a correction in the sync
  read.
- **Open** (RD-5): a reader who may see the section still meets the draft rule's conflict, which
  can send back an answer that does not count; the existing tests pin that conflict.
- **A retry** is answered from its stored receipt with the field as its sender may see it now
  (`fieldForSender`, called from `apply.ts` `resultFromReceipt`; review findings NOT-4, RD-4). A
  conflict or a value kept in history keeps its status and carries a field that holds nothing,
  `{ value: null, version: 0, changedBy: null, changedAt: null }`, when the field could hold
  something the sender may not see now, by the set check's own rule (`mayHoldHidden`), so a
  retry tells no more than a fresh set would (RD-10): their role or credential was lowered since
  the push, or they no longer act as the author. Nothing was held, so it is not answered
  `permission`. Whoever acts as the author, and a phase 2 note, are answered as before; a
  definition that cannot be read hides the field.
- **`notCounted`** is sent only on a set whose value is now on the chart (accepted, no `server`,
  not `keep_server`), never for a blank or for an entry's own `entryRemoved`: `removed_entry` when
  the entry is not among its section's entries (removed, or with no `entryAt`), else
  `hidden_field`. A set of the value already held is told too, and a retry gets the same answer.
- **A late change** (`lateChange`, the note's `keptInstead`) is kept with `note_finished` at the
  field's version and audited `note.kept_in_history`; `late_change_kept` goes to the sender, and
  to the acting author (`assigned_user_id`, else `author_user_id`) when that is someone else, each
  once. It goes through the gates first, then the draft rule's first steps (4.3): the same value
  is a plain accept, and a `replace` or a stale `keep_server` is kept. `too_many_fields` never
  refuses one.
- **The status**: a resolution answers `nothing_to_resolve`; `completed` is kept (`use_signoff`,
  no notice); `draft` follows `reopenEffect`. `nothing` is accepted at the status's version;
  `apply` writes `draft`, clears `completed_at` and `completed_by`, and is audited `note.reopened`;
  a reopen the note takes no more is `not_author`, with `change_not_applied` to the sender alone,
  when the acting author's own would have applied, and a late change otherwise. The base version
  never matters.
- **The snapshot's attributes** gain `attestation`, `actingAuthorId`, `completedAt` and
  `signoffId`. The contract (`schemas.ts` `RecordSnapshot`) says what is true of attributes now:
  no change sets them, most are set at creation, and some follow what the server records later
  (these four, a patient's `lastSeenAt`, a problem's status times, merge and reversal request).
  What a reader is sent of a note is 6.4's.
- **`everSigned`** joined them with the phone's store (the coordinator's decision): true once the
  note's `first_signed_at` is set, so for a note signed once, signed now or not (a student's
  correction of a co-signed note leaves it completed, 3.6). Such a note's reopen is kept in history
  (the table above), and the phone passes `everSigned` to `reopenEffect`, so it refuses that
  reopen as the server would (4.8). Without it the phone offered the reopen, and every edit made
  offline after it was kept in history too. The contract's description names it, and both sync
  reads hold it (`sync-reads.test.ts`, `fake_reads_test.dart`: "a note’s snapshot shows its
  state: attestation, who acts as its author, when it was finished and the signature it names").
- **`createdAt` and `actingAuthorName`** joined them for the phone's domain layer (D108, the
  coordinator's decision). `createdAt` is when the server made the note
  (`encounter_notes.created_at`; an admin's accept, for a create held for review), never the
  phone's time, and no later change moves it: the visit read gives a visit's notes in that order,
  then by ID (5.1), and the phone keeps a record's attributes, not the snapshot's own `createdAt`,
  so it orders the notes it holds the same way. It is given to the microsecond Postgres keeps, with
  all six places (`2026-11-18T10:00:00.000900Z`), not as other times are, to the millisecond: each
  pushed change is its own transaction, so two phones' pushes can make a visit's notes inside one
  millisecond, which a time cut to the millisecond ties, and the phone would then order them by ID
  where the visit read orders them by the microsecond (review finding N2-R1). With every place
  kept, the text sorts as the time does. `actingAuthorName` is the display name now of whoever acts as the author
  (`users.display_name`, where the visit read's `UserRef` takes it from; the assignee's once a note
  is assigned, 3.8): a note keeps no name of its own. The phone shows it where a teammate's note is
  listed (9.4) and where their draft waits for them (9.6). Both are in every copy of the note a
  reader is shown, a teammate's included, and in none they are not (6.4). The contract's
  description names them.

### 4.5 The content hash

A sign-off carries a hash of what the person saw. The server computes the same hash over what it
holds. One pure function, in TypeScript and in Dart, pinned by
`packages/contract/test-vectors/note-content-hash.json`:

```
noteContentHash = sha256Hex(canonicalJson({
  v: 1,
  noteId, encounterId,
  patientId,          // the encounter's patient, or null
  noteTypeKey, noteTypeVersion,
  summary,            // the encounter's summary, or null
  answers             // the answers that count, blanks dropped
}))
```

- `canonicalJson` and `sha256Hex` are the functions the change hashes already use
  (`services/api/src/sync/canonical.ts:14`, `:58`; `apps/mobile/lib/sync/canonical_json.dart:14`,
  `:21`), so key order and number formatting are already agreed and already tested
  (`packages/contract/test-vectors/canonical-json.json`).
- **The answers that count** are the forms part's `effectiveAnswers(definition, data)`: answers
  in visible fields, in entries that were not removed. A signer is never shown an answer in a
  hidden field, so it is not in what they sign.
- **Blanks dropped**: an answer that is `null`, `""`, `[]` or `{}` is left out, at every depth. A
  field filled in and then cleared hashes the same as a field never touched.
- **A finished note holds only what was signed.** In the update that finishes a note, the server
  replaces the note's `data` with its answers that count. Each answer dropped gets a
  `field_history` row, so nothing is lost. The phone does the same to its own copy when it makes
  the sign-off (4.8). Without this, a later correction to a controlling field could bring a
  hidden answer back into a signed note, with no correction row of its own.
  On the phone, a finished note holds only the answers its sync read carries (D107, 4.8): that read
  gives the answers that count, as the reader may see them, and the refresh of a finished note
  drops from the phone's copy every other answer it holds, unless a change of the person's own to
  that answer still waits in the outbox, which keeps it until its receipt. So an answer Complete
  dropped does not outlive the finish on a phone that got it back from a refresh while the sign-off
  was held (D106), or on the author's other phone, which held the draft with it: kept there, a
  reopen could show it again, and a Complete over it would be refused `content_changed`, as the
  server holds it null. Not every answer the read leaves out is null on the server, though: one a
  correction hid stays in the note (4.7), and one kept from the reader is left out too. As built,
  the refresh drops those from the phone as well, so a reopen that shows such an answer's field
  again shows it empty there, while the server's draft holds it and it counts again; the Complete
  is then refused `content_changed`, and completing again after the refresh, which brings the
  answer back, settles it. A phone that first opened the note after the correction never held the
  answer, so it was the same there before D107. A new answer typed over the empty field offline
  meets the kept one as a conflict, both shown, and never writes over it unseen. The
  coordinator's decision (Nov 18, D107): this is an accepted cost, pinned by two tests (11.2).
  Narrowing the drop to the read that first finds the note finished would only shrink it, since
  that read may already follow the correction; removing it would need the server to send the
  author a finished note's kept answers, a change to a reviewed read rule for a rare path.
- **Why the patient and the summary are in it.** They are on the summary screen where Complete
  is pressed (9.6). If a teammate attached the visit to another patient, or rewrote the summary,
  between what the signer saw and what the server holds, the signature must not land. The hashes
  differ, the sign-off is refused with `content_changed`, and the person looks again.
- **What is not in it**: the kind (it decides nothing about a note, 3.1), addenda (each has its
  own author), corrections made later (each carries its own reason and author), the time, the
  device.
- A co-signer or attester hashes the same thing, so they must be able to see every answer that
  counts (3.7, 6.4).

As built (unit L0, on the forms interpreter of units F1 and F2):

- **What is hashed** is the canonical JSON of the map above, as `noteContent` builds it in
  `services/api/src/encounters/content-hash.ts` and `apps/mobile/lib/encounters/content_hash.dart`.
  Each takes the note's ID, its encounter's ID, the encounter's patient and summary, the
  definition of the note's own version, and the note's data as stored. `noteTypeKey` and
  `noteTypeVersion` are read from that definition, never passed apart from it. `answers` is
  `effectiveAnswers(definition, data)` (forms 7.1): blanks, answers `checkAnswer` refuses, and
  answers in a hidden field, a hidden section or a removed entry are left out; an entry that is
  there keeps its `entryAt`. No reader's filter is applied: the hash is taken before
  `visibleAnswers`.
- **The canonical form** is the change hashes' own, pinned by `canonical-json.json`: keys in
  UTF-16 code-unit order at every depth, so the eight come as `answers`, `encounterId`, `noteId`,
  `noteTypeKey`, `noteTypeVersion`, `patientId`, `summary`, `v`; no whitespace; a whole number
  with no decimal point (37.0 is `37`) and any other number in its shortest round-trip form, -0
  as 0; only the quote, the backslash and the characters below U+0020 escaped, every other
  character as it is. The hash is the lowercase hex SHA-256 of the text's UTF-8 bytes,
  `noteContentHash`: async in TypeScript, as WebCrypto's digest is, and not in Dart.
- **A missing patient or summary is `null`, never left out.** Canonical JSON drops a key whose
  value is undefined, so the TypeScript `noteContent` writes `patientId ?? null` and
  `summary ?? null`. An encounter read from the database with no summary would otherwise hash
  without the key the phone always writes, and every Complete on it would be refused with
  `content_changed`. In Dart both are required parameters, and may be null.
- **The vectors**: `packages/contract/test-vectors/note-content-hash.json` is `{ note, cases }`,
  21 cases. A case has `name`, an optional `why`, `definition` (the name of one of
  `forms-conformance.json`'s definitions, which both interpreters already read), `noteId`,
  `encounterId`, `patientId`, `summary` and `answers`, and expects `effective` (what
  `effectiveAnswers` gives, key for key and in order), `content` (the canonical text) and `hash`.
  `sameHashAs` names a case whose hash must be the same, and every other two cases must differ.
  The text and the hash were worked out apart from both implementations. Between them the cases
  change the patient, the summary, the note and the version one at a time, store the same answers
  in another order, and give no patient, no summary, no answers, a hidden field, a hidden section,
  a removed entry, blanks, zero, an answer `checkAnswer` refuses, text with quotes, a tab, a line
  break, accents and an emoji, and numbers written three ways.
- **The readers** are `services/api/test/note-content-hash.test.ts` and
  `apps/mobile/test/encounters/content_hash_test.dart`. Neither holds an answer of its own. Each
  refuses a case with a key it does not read or without one it needs, holds the `sameHashAs`
  pairs together and every other case apart, and for each case checks `effective` against its
  own interpreter's `effectiveAnswers`, key order included, then `content` and `hash`. The
  TypeScript reader also holds that a missing patient or summary hashes as `null`, which a vector
  cannot say: JSON has no undefined.
- **Who calls them.** The sign-off (4.6) calls the TypeScript one since unit L1, over the
  answers the note holds and the visit's patient and summary. The phone's test server calls the
  Dart one for the same (4.9), and its parity cases send every case of `note-content-hash.json`
  through a real sign-off. On the phone, since L3's store cards, `contentHashOf` gives the summary
  screen the hash it shows and `finishNotes` works it out again over what the phone holds, the
  visit's patient and summary included (4.8).

### 4.6 The sign-off

`note_signoff` is a create-only entity. Its value:

```ts
{ noteId: uuid, act: 'complete' | 'sign', contentHash: /^[0-9a-f]{64}$/,
  claimedCredential: CredentialName | null, statementVersion: string }
```

The time is the change's device time and `clockVerified`, as for every create (`createInput`,
`services/api/src/sync/records.ts`). Parent: the note (4.1 says what a missing parent answers).

What the server does, in the change's transaction, under the team lock:

1. Load the note for update, its encounter, and the note type definition.
2. Work out the inputs of `signoffEffect` (3.12): `medicalNote` (3.1), `actsAsAuthor` (3.8),
   `hashMatches` (4.5), `finishOk` (the forms part's `finishCheck` returns nothing),
   `redFlagsDone` (the visit has a finished Red flags note, or this note is one, forms 6.2),
   and from `signedUnder` (3.5) `canSign` and `needsAttestation`.
3. Call `signoffEffect`. The sync code holds no rule of its own: it writes what the function says.
4. **Refuse**: `rejected('validation', { problem })`. Nothing is written but the stored rejection.
5. **Effect `none`** (the note is already finished, the sender does not act as its author, or the
   note is an empty draft, 3.4): insert the `note_signoffs` row with `effect: 'none'`. The
   receipt's details carry the reason and `hashMatches`.
6. **Any other effect**: insert the `note_signoffs` row; update the note in one statement:
   `data` (the answers that count, 4.5), `status`, `completed_at`, `completed_by`, and when
   signed `first_signed_at`, `signoff_id` and `attestation`; write a `field_history` row for
   `status` and one for each answer dropped. The trigger updates the encounter.
7. One audit event, in the same transaction: `note.completed`, `note.signed`,
   `note.saved_unsigned` or `note.signoff_repeated` (10.1).
8. `saved_unsigned` also writes a notice to the signer (`user_notices`, kind
   `note_saved_unsigned`).

The receipt is `accepted` with `details: { effect, status, attestation, hashMatches }`. The
phone writes that onto its copy of the note (4.8).

**The Red flags note goes first.** `finishNotes` puts the sign-off of the person's Red flags
note ahead of their other sign-offs of that visit, so `redFlagsDone` is true when the others
arrive. If the Red flags sign-off is refused, the others are refused with `red_flags_first`, and
one Complete fixes all of them. This is the server's half of hard stop 5 (3.3); hard stop 4 is
the refusal of a Medical note on a visit with no patient (4.4).

**Sent twice.** The same change sent again answers with its stored receipt, as every change does
(phase 2). A second sign-off for a note that is already finished is effect `none`.

**After a refusal.** The phone sends the same sign-off record again with the new hash (a create
that supersedes the refused one, made by `finishNotes`, 4.8). The server applies it as a fresh
sign-off; for a note finished since, or an empty draft, it stores it with effect `none`, which
settles the refusal all the same (3.4).

**From a removed person.** Their changes are held for a Program Admin
(`services/api/src/sync/apply.ts:403-443`). When the admin accepts a held sign-off it applies as
above. `signedUnder` reads the membership as it is now, removed or not, and its history.

As built (unit L1, `services/api/src/sync/entities/note-signoff.ts`, `values.ts`, with wave D's
review):

- **The value** is `NoteSignoffCreate`, strict, every key required. `statementVersion` is any
  text of 1 to 40 characters from `a-z`, `0-9`, `_`, `.` and `-`, stored as it is sent: the server
  does not check it against the sentences of 3.5 (12.1 #23). A `complete` that claims a credential
  is refused at `claimedCredential`. A set of a sign-off answers `unknown_field`.
- **The order of the steps**, under the team lock, once `apply.ts` has found the note (a missing
  one is `stale_reference` `encounter_note_missing`; one whose own create is held for review holds
  the sign-off with it). The note is loaded for update, then its visit. A note the sender may not
  read at all is held (6.4). The Medical gate is asked of whoever acts as the author only: anyone
  else goes on to effect `none` (4.1). The definition comes next: a note with no version, or one
  whose version the team does not hold, is `definition_error`. Then the inputs of
  `signoffEffect`: the hash over the answers the note holds, with the visit's patient and summary;
  `finishCheck`; `redFlagsDone`, asked of a Medical note only (its own type has
  `auto: 'medical'`, forms 6.2, or a finished note of the same visit has; the Red flags note is
  found by `auto`, never by its key); and `signedUnder`'s `canSign` and `needsAttestation`. A
  refusal stores only the rejection, and the same record sent again with `supersedes` is applied
  fresh and settles it. A record ID already taken is `record_exists`.
- **`signedUnder`'s times.** `signedAt` is the change's clock-corrected time. `receivedAt` is when
  a push held the sign-off for review, if it was held, else now, on the database's clock as
  `membership_changes` is. `notBefore` is when the server received the note's create: the held
  create's `received_at` when an admin accepted it later, else the note's `created_at`
  (`createReceivedAt` in `records.ts`; review finding NOT-2). The row keeps `signed_at` and the
  phone's own `signed_device_time` beside `received_at` (pinned, NOT-3), and a removed signer's
  sign-off handed over and accepted by an admin applies under the membership as it is now
  (NOT-11).
- **Any other effect** writes the row, then the note in one statement: `data` becomes the answers
  that count; `status`, `completed_at` (the signature's time), `completed_by` and `attestation`
  are set; `first_signed_at` and `signoff_id` only when the effect is `signed`. The status and each
  answer dropped, blanks included, take their next version and a history row of kind `set`, a
  dropped answer to null; the note's record version rises once. The row's `needs_attestation` is
  `signedUnder`'s answer whatever the effect (3.12: what the row stores); the note's `attestation`
  is what billing and the queues read.
- **The receipt.** Any effect but `none`: `accepted`, `serverVersion` 1,
  `details: { effect, status, attestation, hashMatches }`, where `hashMatches` is always true.
  Effect `none`: `details: { effect: 'none', reason, status, attestation }`, the reason
  `already_finished`, `not_author` or `empty` (an empty draft: `noteIsEmpty` of the answers the
  note holds, 3.4), the note's state now, so the phone settles every receipt the same way, and
  `hashMatches` **only to whoever acts as the author** (review findings RD-2, NOT-6): sent to
  anyone else it would check any guess of what the note holds, a hidden answer included. For
  `already_finished` it compares with the hash of the sign-off that finished the note, not with
  the note as it is now (NOT-7): the row by `completed_by` at `completed_at` with an effect other
  than `none`, the latest received on a tie, else the note's own hash. A co-signature (L2) must
  leave `completed_at` and `completed_by` as they are for this to keep naming the signature that
  finished it. The contract's description of `SyncResult.details` names a sign-off's keys and the
  three reasons.
- **Notices and the audit event**: `note_saved_unsigned` to the signer, `change_not_applied` to a
  sender who does not act as the author, both on entity `encounter_note` and the note; one event
  on the note, with `signoffId` in its details (10.1).
- **A held sign-off that will not reach the chart** (review finding NOT-12, as the coordinator
  decided). Its phone let go of it when it was held (4.8), so nothing else would tell the worker
  that the note is still a draft. When a Program Admin rejects it, or their accept is refused
  because the note no longer matches it (`content_changed`), its sender gets `signoff_not_applied`
  on entity `note_signoff`, naming the held sign-off (`signoffNotApplied`,
  `services/api/src/sync/review.ts`), and its note in `note_id` (D104, migration 0022), which the
  notices' list gives as `noteId`: a held sign-off is in no sync read, so a phone that never held
  it finds the note by that alone. Once per sign-off, whether or not they have read an earlier
  one: a refused accept and the reject that follows tell them once, and a second held Complete of
  the same note, a sign-off of its own, is told on its own. A kind of its own means no phone needs
  state of its own to word it (review findings SRC-1, SRC-2 and SRC-5, as the coordinator
  decided). As first built it was `change_not_applied` on the note, written unless an unread one
  named the note already: a second held Complete rejected before the phone's read of the first
  notice reached the server told nobody, and the note stayed "Sent for review" for good, which the
  live job now pins against the real API (`apps/mobile/test/sync/live_api_test.dart`, "each held
  Complete is told on its own: rejected twice before the first notice’s read arrives"). A refused
  accept runs in a savepoint that is rolled back, so the item stays pending and the chart is
  untouched; it answers 409 `cannot_apply` with `details.problem`, and is logged as
  `quarantine.accept_refused` on the note with its patient (10.1). Any other refused accept tells
  nobody, and its reviewer rejects it, which then does. Only a sign-off of a note on the chart
  tells anyone, and, since the second pass, a correction: a held change of another kind, rejected,
  tells nobody.
- **A held correction that will not reach the chart** (review finding VS-6, as the coordinator
  decided). A correction held for review is taken, once the sign-off it names is rejected, as
  naming none (4.7, PS-2), and on a note still a draft that is an edit of the draft (3.6): if the
  draft moved since (a teammate's edit of the answer, `field_changed`) the accept is refused
  `cannot_apply`. Its phone let go of it when it was held, and Complete never makes it again, so
  its sender gets `correction_not_applied` on entity `note_correction`, naming the held correction
  and its note in `note_id` (`correctionNotApplied`, `services/api/src/sync/review.ts`; the fake's
  `_correctionNotApplied`), so they can open the note and correct it again: on any refused accept
  of a held correction of a note on the chart, logged as `quarantine.accept_refused` on the note,
  and on its reject, once per correction. The notice holds no text of it. The phone words it by its
  kind ("Your correction of this note wasn’t applied. Open it and correct it again.") and Needs
  attention's card opens the note, as for `signoff_not_applied`. A refusal at accept time is
  not stored as a rejection of the change: the item is still the reviewer's to decide. The phone's
  half is the store's (4.8): the notice settles only the held sign-off it names, so its note is a
  draft to complete again, fetched again by the note the notice names if it had left the phone
  (9.13).
- **The snapshot** in the sync read: the signer's ID as the record's `authorUserId`, and in its
  attributes `noteId`, `act`, `effect`, `contentHash` (to whom 6.4's rule 4 gives it), `signerName`
  and `signerCredential`, `claimedCredential`, `needsAttestation`, `statementVersion`, `signedAt`
  and `clockVerified`. `signerName` (D108) is the name stored with the row (`signer_name`, 0019),
  the one they signed under, as an addendum's `authorName` is: a signature keeps the name and the
  credential it was made under, whatever the person is called later. A co-signature (5.3) is read
  the same way. The NPI and the credential's other fields stay with the billing export.

### 4.7 Addenda, corrections and referrals

**`note_addendum`**: `{ encounterId: uuid, noteId: uuid | null, text: 1..4000, signoffId: uuid |
null }`. Parents: the encounter, the note when given, and `signoffId` when given. The phone fills
`signoffId` with its own sign-off while that sign-off is not yet confirmed, so an addendum
written a moment after Complete waits behind the sign-off on the phone: "an addendum to a
rejected note ... held, not sent" (PRD main 564). The server accepts an addendum in every state
of the note. It is text with its own author and time, and refusing it would leave the worker
with something they cannot fix (4.1). Audit: `addendum.added`. The database refuses an
addendum whose note is not a note of its visit (2.3), so L1 checks the `(encounterId, noteId)`
pair before the insert: a mismatch answers `stale_reference`, as a missing parent does, rather
than a `server_constraint` rejection the worker could not read.

**`note_correction`**: one reason, and one to ten answers changed together.

```ts
{ noteId: uuid,
  changes: [{ field: `data.${path}`, newValue: unknown, baseVersion: number }],   // 1 to 10
  reason: 3..500, requestedByPatient: boolean, declined: boolean,
  claimedCredential: CredentialName | null, signoffId: uuid | null }
```

Several answers go together because one answer can open another: correcting "EMS activated" to
Yes makes the time required. Corrected one at a time, the note would pass through a state that
fails its own finish check.

- Parents: the note, and `signoffId` when given. The phone fills `signoffId` with its own
  sign-off of that note while that sign-off is not yet confirmed. The phone's hold rule then
  keeps the correction waiting if that sign-off is refused
  (`apps/mobile/lib/sync/local_store.dart:976-1018`), and releases it when the same sign-off
  record is sent again and accepted.
- What the server does, in order:
  1. The sender does not act as the author: the row is stored with `outcome: 'not_author'`,
     nothing changes, the sender gets a notice.
  2. The note is a draft: each change is applied as an edit to the draft by the draft rule, and
     the row is stored with `outcome: 'draft_edit'`.
  3. For a Medical note, the Medical gate (4.2).
  4. `declined` (only with `requestedByPatient`): the row is stored with `outcome: 'declined'`
     and the note is unchanged.
  5. Each `newValue` passes `checkAnswer`, else the correction is refused with that problem.
  6. Each answer's version equals its `baseVersion`, else `field_changed`. An answer the note's
     read never sends, that the sender held no version of (`baseVersion` 0), is taken (D109): one
     blank now, as a draft edit fills a blank (Complete leaves an answer it dropped blank at a
     version the read never sends, D107), or one that does not count as the note stands, a
     condition hiding it (a correction that hides an answer keeps it at its version). A sender who
     held a version of an answer that moved since is still refused `field_changed`, which tells
     them someone corrected it first.
  7. Nothing the note shows changes: stored with `outcome: 'no_change'`. An answer whose
     `newValue` is what it holds is not written. One hidden by a condition before the correction
     and after it changes nothing the note shows: when every changed answer is such, the
     correction is `no_change`, which clears no co-sign, undoes no attestation and tells nobody
     (3.6). Beside a change that shows, a hidden answer is written when the sender held its
     version (step 6 found it has not moved), and left as it is when they held none
     (`baseVersion` 0). So a hidden answer is written from version 0 only by a correction that
     makes it count again. A `corrected` correction's row and audit event name only the answers
     it wrote (review finding R1).
  8. The forms part's `finishCheck` passes on the answers as they would be, else `incomplete`. A
     correction can never leave a signed note without, say, the consent a sensitive exam needs.
  9. Otherwise: `set_config('app.note_correction', noteId, true)`, each answer is written with
     history kind `corrected` (the guard of 2.2 lets it through), the `note_corrections` row is
     inserted with the history rows' IDs, and `correctionEffect` (3.12) says what happens to
     `status`, `signoff_id` and `attestation` (the table in 3.6). The value set is the loaded
     row's ID (`id::text`), not the `noteId` as the phone sent it; the guard compares it without
     case (2.2) all the same.
- **The corrector's credential** decides what `correctionEffect` returns, and a correction made
  offline is checked days later, as a signature is. It is found by `signedUnder` (3.5) with the
  correction's time, its `clockVerified` and its `claimedCredential`. For a sign-off and a
  correction alike, `credentialChangesAfter` (4.2) reads the membership's `membership_changes`
  rows of kind `credential` and `restored`, each with its `old_value` (3.12).
- Two small changes to `services/api/src/sync/records.ts` make step 9 possible: `'corrected'`
  joins the `HistoryKind` type (`:228-237`), and `appendHistory` returns the row's ID
  (`:256-264`).
- A correction can hide a field that holds an answer, or show one again. The answer stays in the
  note and counts or not by the definition, as `effectiveAnswers` says. The signer saw it when
  they signed. The note's read leaves out an answer that does not count, so a correction that
  shows one again sends it at version 0, which step 6 takes.
- Audit: `note.corrected`, `note.amendment_declined`. The details name the field paths and the
  outcome, never a value.

**`referral`**: `{ patientId: uuid, referredOn: date, details: 1..2000, encounterId: uuid | null }`.
Its shape copies `patient_allergy` (`services/api/src/sync/entities/allergy.ts`), with its own
rule for who may act:

- Create needs `referrals.create`.
- One settable field, `enteredInError`, of class `set_once`, with the value `{ reason }` the
  allergy uses (`allergy.ts:127`). It needs `referrals.create`, and `mayChange` allows it for the
  referral's author or for anyone who holds `encounters.chart`. A community health worker can
  take back their own referral; a clinician can take back anyone's. The entity writes
  `error_reason`, `error_by` and `error_at` together with the status, as `allergy.ts` does: the
  database's `referrals_error_with_status` needs all three (2.5).
- `referredOn` may not be more than one day in the future (`valueProblem`, as a birth date is
  checked).
- Parents: the patient, and the encounter when given. A visit that names a patient outside the
  referral's merged group is refused with `stale_reference` (`encounter_other_patient`); the
  fix is **Send without the visit** (8.4). The same check joins the creates that already name a
  visit: a problem, an allergy, a problem note.
- Audit: `referral.created`, `referral.entered_in_error`.

As built (unit L1, `services/api/src/sync/entities/{note-addendum,note-correction,referral}.ts`,
`values.ts`, with wave D's review):

- **The values** are strict, and every key is required; the nullable IDs (`noteId`, `signoffId`,
  `encounterId`) are present and may be null. Texts are validated, never trimmed. A correction's
  `changes` name distinct fields (a repeat is refused at `changes`), each `newValue` must be
  present (it may be null), each `baseVersion` is a whole number from 0, and `declined` needs
  `requestedByPatient` (refused at `declined`). A set of an addendum or a correction answers
  `unknown_field`.
- **An addendum**: parents in this order, the visit, the note, the sign-off. Then a note of
  another visit is `stale_reference` `encounter_note_missing`, compared from the loaded rows; a
  note the sender may not read at all holds the addendum (6.4); a `signoffId` must name a sign-off
  of its note, or, naming no note, of a note of its visit, else `note_signoff_missing` (review
  finding REC-3). No Medical gate. Its `author_credential` is `signedUnder`'s with no claim, at the
  addendum's time, with `notBefore` when the server received the visit. It is taken in every
  state of its note, `serverVersion` 1, with no details.
- **A sign-off a reviewer rejected** (since the phase's review, finding PS-2, the coordinator's
  decision). An addendum or a correction whose `signoffId` names a sign-off that is not on the
  chart, whose held create a Program Admin rejected, and of which no held create still waits, is
  taken as if it named none (`records.ts` `withoutRejectedSignoff`, before the parents are
  checked; the test server's `_rejectedInReview`). The link only orders it after the sign-off on
  the phone, which let go of both when they were held. Held behind the sign-off (`awaiting_review`)
  and accepted after its rejection, or sent later, it is applied: an addendum as any is, and a
  correction, which then reaches a note that was never finished, as an edit of the draft (3.6,
  "A correction that reaches a draft is applied as an edit to the draft"), stored with its reason
  as `draft_edit`. A sign-off simply missing is still `note_signoff_missing`.
- **A correction, in the order built.** The design's step numbers are kept, and the tests are
  named by them. Before step 1: a record ID already stored is `record_exists`, asked before
  anything is read; a `signoffId` of another note is `note_signoff_missing`; a note the sender may
  not read at all is held. Then step 1 (`not_author`, with `change_not_applied` to the sender,
  ahead of the gate); step 3 (the Medical gate); the note's definition, where a version the team
  does not hold is `definition_error`; the `needs` gate for each answer, the author's included
  (review finding NOT-1); step 4 (a declined request is stored, the note unchanged, in any state);
  a finished note with no version is `definition_error`; step 5 (`checkAnswer`,
  `{ problem, field }`); the 1,000-answer bound (`too_many_fields`); step 2 (the draft edit);
  step 6 (`field_changed` `{ field }`, an answer never held by the sender taken when it is blank
  or hidden as the note stands, D109); step 7 (`no_change`, when no answer that changes shows
  before or after; beside one that does, a hidden answer is written only from a version the
  sender held, review finding R1; whether an answer would count, its field showing in an entry
  that is there, is the interpreter's `NoteReading.counts`, asked of the note before and after);
  step 8 (`incomplete`, on the note with the answers step 7 writes); step 9. The gates and a declined
  request come before the draft edit, unlike the order written above: a draft edit changes a
  Medical note as any set of it does, and a declined request must never edit a reopened note.
- **The draft edit** cannot answer a conflict, being part of a create. Each answer the person saw
  is written as `set`, a blank as `filled_blank`, the same value not at all; one they did not see
  refuses the whole correction with `field_changed`, and nothing is written. It is stored
  `draft_edit` even when nothing changed. A phase 2 draft is edited under its open path rule.
- **Step 9 as built**: the answers are written in one update, `app.note_correction` set to the
  loaded row's ID for that statement and reset to `''` after it; `correctionEffect` sets
  `status`, `attestation` and `signoff_id` in the same statement; a status that moves takes its
  next version and a `set` history row, the answers `corrected` ones, an answer filled from blank
  at step 6 included (its old value null, D109), and one shown again from version 0 (its old value
  the one it kept while hidden, which the note shows struck through). Then the row, naming each
  history row; an answer it names that step 7 left as it was has no history row (`historyId`
  null). Every correction's receipt is `accepted`, `serverVersion` 1, `details: { outcome, status,
  attestation }`.
- **The corrector's credential** is `signedUnder`'s, with the claim, at the correction's time,
  `notBefore` from the note's create as for a sign-off. A correction carries no statement version
  (12.1 #24).
- **The snapshots** name their person as stored with the row, as they were then (0019): an
  addendum its author (`authorName`, `authorCredential`, since L1), and a correction its corrector
  (`correctorName`, D108, beside `correctorCredential`), the person's ID being the record's
  `authorUserId`. A correction's other attributes are `noteId`, `changes` (each field with its old
  and new value, so it goes only to whoever may read both, 6.4), `outcome`, `reason`,
  `requestedByPatient`, `claimedCredential`, `correctedAt` and `clockVerified`.
- **`note_corrected`** goes to the co-signer whose co-signature the correction clears, and to
  every attester of the current signature when an attested note is no longer attested: each once,
  never the corrector (pinned with a corrector who had attested the note, review finding REC-8).
  An attending's correction of an attested note leaves it attested and tells nobody. Open: a
  co-signer whose co-signature stays, and an attester whose attestation stays, are not told,
  though what they signed has changed.
- **A referral**: `referredOn` more than a day after the server's date is `referral_in_future`,
  and a year below 100 is refused on both sides (`IsoDate`; the phone's `isRealDate`). Its
  `enteredInError` takes `referrals.create`, then its author or anyone with `encounters.chart`;
  anyone else is held for review. A resolution on it is `nothing_to_resolve`; a second mark is
  kept in history. Its entered-in-error event names its visit (review finding REC-5).
  Since the phase's review (finding PS-3, the coordinator's decision): a referral does not pause
  with the clock (3.11), so a phone whose clock has no reference may be days ahead. The phone's own
  check then takes no date past the phone's own day (its local day, or the UTC day where that is
  later), the server's day ahead being for a clock it has measured (`LocalStore`
  `_unreferencedProblem`). A referral the server refused `referral_in_future`, the one value
  problem a referral meets there, gets **Change the date** in Needs attention: a sheet in the
  sheets' gate whose date is typed in three private boxes or picked on the calendar alone, as every
  date the phone takes is (D92, review finding PX-3), and `Referrals.changeRefusedDate`, which sends
  the create again on the date chosen through `fixRejected`, so the refusal settles and a visit it
  was made at no longer waits in Needs attention.
- **A visit of another patient** is checked by `visitOfOtherPatient` (`records.ts`) for the
  creates of a referral, a problem, an allergy and a problem note, whose patient is its problem's
  (review finding REC-7); a visit with no patient passes. A problem made at a visit is stored with
  `source` `encounter` (8.3). A problem's status set that names a visit is not checked: this
  section names creates.

### 4.8 The phone

`apps/mobile/lib/sync/entities.dart` mirrors every rule of 4.3 to 4.7:

- `encounter`: `summary` and `locationText` settable; `kind` settable to `medical`; `status`
  removed.
- `encounter_note`: `status` takes `draft` only. The registry keeps the path pattern for
  answers. The definition check is not in the registry, which is synchronous and holds no
  definitions (`entities.dart:493-507`): the domain layer calls the Dart `checkAnswer` before it
  calls `setField` (forms 8.1).
- The four new entities, each `patientSide`, so `createRecord`
  (`apps/mobile/lib/sync/local_store.dart:623`) takes them and they join the patient's local
  work. Their parents are listed, so the hold rule covers them with no new code.
- The patient of a sign-off, an addendum or a correction is found through its note, as the
  store already does for a problem note (`local_store.dart:513-522`).
- The referral's date rule joins the phone's `valueProblem`, which checks patients only today
  (`entities.dart:514-515`).
- `ems_handoff.shown` and `notes_to_finish.viewed` join the list of actions a phone may log
  offline, on the phone and on the server (`services/api/src/sync/entities/values.ts:269-277`;
  `apps/mobile/lib/sync/entities.dart:357-360`). The list is closed, and `appendAudit` throws on
  an action the server would refuse (`local_store.dart:878-881`). Both screens show patients'
  details offline, and a read that can't be logged is refused.

`apps/mobile/lib/sync/local_store.dart` gains:

1. **`finishNotes`**. It takes, for each note, the hash the summary screen worked out when it
   drew the note. One transaction. If the store's hash of a note differs from the one shown,
   it stops and nothing is written: a sync has brought in a teammate's change since the person
   read the note, and a signature must cover what was on the screen, not what arrived behind it.
   Otherwise, for each note, the Red flags note first (4.6), it drops from the phone's copy the
   answers that do not count (4.5), then makes the sign-off: a new `note_signoff` create, or, for a note
   whose last sign-off was refused, the fix of that create (the same record ID, the new hash,
   `supersedes`, `:1328-1345`). It never leaves two sign-offs of one note in the outbox. It marks
   each local note with the effect the phone expects (`localEffect`, worked out by the Dart
   `signoffEffect`). A note with a `localEffect` is finished as far as the phone is concerned.
2. **The lock follows the effect.** `setField` throws `RecordLocked` when the local note's
   status is not `draft` or it has a `localEffect`, in place of today's check for `signed`
   (`:802-835`). The same holds for a locked envelope field. One set gets through the lock:
   `status` to `draft`, when the Dart `reopenEffect` says `apply`.
3. **`createNote` on any encounter.** It refuses a note on a signed encounter today (`:593`).
   That check goes.
4. **Receipts settle the effect.** When a sign-off is confirmed, the note takes `status` and
   `attestation` from the receipt's details and the `localEffect` is cleared. A sign-off that was
   held for review is confirmed with no details (`:1147-1153`): the note keeps its `localEffect`
   and says "Sent for review". When a sign-off is refused, the `localEffect` is cleared and the
   note is a draft again; the refusal shows in Needs attention. All of this runs in the
   transaction that stores the receipt, through the hooks phase 3 added (`store.onConfirmed`,
   `store.onRejected`).

**What stays on the phone.** A draft the person authors stays until it is finished (3.2). A
finished note leaves once its sign-off and every change to it are confirmed: the domain layer
calls `closeRecord` then (8.2). The purge itself does not change.

**The clock.** `_guardFor` stops sign-offs, addenda and corrections while the clock check fails,
and lets referrals through (3.11).

As built (unit L3, card L3-registry, `apps/mobile/lib/sync/entities.dart`):

- **`encounter`**: its fields are `patientId`, `location`, `locationText` and `summary` (each text
  trimmed, 1 to 200 and 1 to 4,000 characters, or null) and `kind`, which has a rule of its own
  (`FieldClass.status`); `status` is not settable. The create takes `locationText`, and refuses a
  summary; its `createdFields` are `patientId`, `location`, `locationText` and `kind`; it has no
  attributes on the phone.
- **`encounter_note`**: `status` takes `draft` only, as its own rule (`FieldClass.status`);
  answers stay `FieldClass.draft`; `maxNoteFields` is 1,000. The fake lets the one value
  `completed` past the registry for a note's status, since the API keeps it as `use_signoff`.
- **The four new entities** are `patientSide`, with the API's values exactly and its parents in
  its order. Sign-offs, addenda and corrections go under the outbox category `notes`, need
  `encounters.chart` and pause with the clock (`pausesWithClock`, which `_guardFor` reads); a
  referral goes under `patients`, needs `referrals.create`, never pauses, and its
  `enteredInError` is set once. Until its receipt, a sign-off and a correction are `pending`, an
  addendum `written`, a referral `active`.
- **The patient of a new record** is declared by `EntityRules.patientVia`: the problem for a
  problem note, the visit for a note and an addendum, the note for a sign-off and a correction; a
  referral names its own (`patientOfCreate`). The store reads it for every create since its own
  cards (below).
- **Values**: `referral_in_future` joins `valueProblem`; a date in a year below 100 is refused, as
  the API refuses it (review finding FAK-2); a correction's missing `newValue` is a problem of its
  own kind (`_present`), since the API's schema still runs its refinements then; the two audit
  actions join `auditActions`. `packages/contract/test-vectors/sync-values.json` binds the new
  values on both sides, a visit's summary and place and an empty correction among them:
  `entities_test.dart` reads it through the registry and `patient_rules_test.dart` through the
  fake. Still owed: the registry's bound on `noteTypeVersion`, the API's `MAX_VERSION` (review
  finding FAK-1), and its vector; the fake checks the bound itself until then.
- **What the store still did as phase 2 left it** (`createEncounter` wrote `kind` as an attribute
  and `status` as a field; the refresh read a visit's status from a field the snapshot no longer
  has; a visit's fixed create dropped the place typed by hand) went with the store's cards, below.

As built (unit L3, cards L3-store-finish, L3-store-lock and L3-store-receipts, with their review;
`apps/mobile/lib/sync/local_store.dart`, the notices' sentences in
`apps/mobile/lib/features/sync/sync_labels.dart`, the tests in
`apps/mobile/test/sync/store_encounters_test.dart`, run against the test server, 11.2). Each rule
was taken out by a script to see its test fail; 11.2 names the one check no test can show failing.

- **The visit as the server keeps it.** `createEncounter` takes `locationText`, checked as the
  server checks it, and writes the registry's created fields (`patientId`, `location`,
  `locationText`, `kind`) at version 0, pending its create: no attribute, no `status` field. The
  phone never works out a visit's status: the refresh takes the snapshot's. The fix of a refused
  visit create carries the place typed by hand, as it carries the patient and the location.
- **Complete is `finishNotes(notes, signer:, definitionOf:, redFlagsFinished:)`.** One transaction
  for the whole call: a note refused undoes the notes before it. It returns what the phone expects
  of each note (`LocalEffect`), by note, in the order the sign-offs go, the Red flags note first
  (found by its type's `auto`, as the server finds it). What the caller (L4) passes:
  - for each note a **`NoteToFinish`**: its ID, the hash the summary screen showed
    (`contentHashOf`, over the visit's patient and summary and the note's answers by the
    definition of its own version, 4.5), the act and the statement version. The caller decides
    the act (`complete` or `sign`, 3.3's table), since it words the button and the signing
    sentence (3.5, 9.6); the store works out the effect by `signoffEffect`, so a `sign` on a
    Non-Medical note shows as completed;
  - a **`Signer`** from the saved profile: the credential a `sign` claims (`claimedCredential`,
    sent on a `sign` only), with `canSign` and `needsAttestation`. The store holds no capability
    table, and the receipt corrects what the server decides (`saved_unsigned`);
  - **`definitionOf`**, a synchronous lookup by key and version, since the store holds no
    definitions: the notes' own, and those of the visit's other notes, to find a finished Red flags
    note among them;
  - **`redFlagsFinished`**: the visit has a finished Red flags note the phone does not hold (the
    visit read shows it). Otherwise a Red flags note counts as finished when it is the note
    itself, another note of the same call, or a note on the phone finished as the phone knows it
    (by the server's status, or by a sign-off made here that was not refused).
- **What Complete refuses, writing nothing** (3.3): `ChartingPaused` while the clock check fails;
  `NoteChanged`, naming the notes, when the hash of what the phone holds differs from the one shown
  (a sync brought in a teammate's change after the screen was drawn); a `LocalValidationError`
  `needs_attention` while anything about the visits or their notes waits in Needs attention, a
  change to one of them or to a record that names one (`parentsOf`: a sign-off, an addendum, a
  correction, a problem made at the visit), hard stop 2. A refused sign-off of a note being
  completed now does not count: completing again is its fix. Without hard stop 2, Complete dropped
  an answer whose refusal still waited, its fix conflicted with the person's own value, and the
  sign-off covered a note without it (review finding SLK-4, the coordinator's decision). Then note
  by note, through `signoffEffect`, with the hash matching and `finishCheck` as `finishOk`: the
  server's problem, said at once rather than after a sync, for what it would refuse (`incomplete`,
  `red_flags_first`) or store with no effect (`not_author`); `RecordLocked` for a note finished
  already, here or on the server, with no refused sign-off to settle, and for one whose sign-off
  waits to send, is held for review or is confirmed but not yet settled, so a note never has two
  sign-offs in the outbox; `empty` for an empty draft with no refusal to settle, or `incomplete`
  when its finish check fails (the person's own Red flags note, hard stop 5); and a sign-off the
  registry refuses (a statement version of other characters), which would be refused however often
  it was sent. A note given twice is an `ArgumentError`; a note, a definition or a
  visit not on the phone a `StateError`. Hard stop 4 is the domain layer's.
- **What Complete writes**, note by note. The answers that do not count leave the phone's copy
  (their field rows), as they leave the server's when it finishes the note (4.5), so nothing done
  here later, a correction, can bring back an answer the signer never saw; a change to one that is
  not confirmed yet stays in the outbox, and the server drops it into history. Then the sign-off: a
  new `note_signoff` create; or, for a note whose last sign-off was refused, its fix, the same
  record ID with the new value and hash, superseding every refused sign-off of the note, so the
  refusal is settled and what names it (an addendum) still does. The local record of the refused
  sign-off is deleted and made again under the same ID, its patient worked out again. The note
  keeps its `LocalEffect` (the effect, status and attestation expected, and the sign-off expected
  to give them) in its record's attributes under `localEffect`, which no change sets, so no
  schema change was needed; a note with one is finished as far as the phone is concerned.
  Completing again marks read every `signoff_not_applied` notice about the note, whichever phone
  made the Complete it is about: by the note the notice names (D104), and by a sign-off of the note
  this phone holds or held (its `held_note` record). Before D107 it read them by the sign-offs alone,
  so a phone that never held the sign-off kept the notice after the person had completed the note
  again. It settles nothing else: no `localEffect` is cleared and no held record changes.
  `createRecord`, `fixRejected` and `replaceRejected` refuse a `note_signoff` with an
  `ArgumentError`, so a sign-off is made and fixed only here, its hash checked against what was
  shown (review finding SFN-3).
- **Every refused sign-off can be settled** (the coordinator's decision on review findings SFN-1
  and SFN-7). When a note's last sign-off was refused and the note is finished since (on the
  person's other phone, say) or is now an empty draft (Remove this note, 9.4), Complete sends that
  sign-off's fix all the same, over the note as the phone holds it, and expects nothing of it: the
  note keeps what it holds, gets no `localEffect` and is left out of the map returned. The server
  stores the fix with effect `none` (`already_finished` or `empty`, 3.4), which settles the
  refusal, and `hashMatches` says whether what was finished is what this phone saw
  (`finished_differently`, below). Before, such a refusal waited in Needs attention for good, and
  hard stop 2 then stopped every later Complete at the visit.
- **What Complete dropped still reaches the server** (review finding SFN-5). When a note's own
  create is refused after Complete and then fixed, `_fixNote` carries in the fixed create the
  answers Complete dropped that an unresolved create or set of the note still holds
  (`_droppedAtComplete`), without bringing them back to the phone's copy, so the server's sign-off
  drops each into history as usual. With hard stop 2, a note's create can be refused with a Complete
  waiting behind it only when the refusal comes after Complete. And the fix of a refused set whose
  field has no row here (an answer an earlier Complete dropped) builds on the version the person
  saw, the refused entry's `baseVersion` (SLK-4).
- **The lock follows the effect** (`setField` throws `RecordLocked`, after the clock guard and
  before any check of the value). A note is locked while it is finished as this phone knows it
  (`_noteStatusHere`): the status its `localEffect` expects until a receipt settles that sign-off,
  else the server's. Two things get through. The reopen, by `reopenNote`, not by a set, since
  `reopenEffect` needs to know whether the note is Medical, which is its type's. And settling:
  `fixRejected` and `resolveConflict` on a note finished since still go, and the server keeps them
  in history; a lock there would leave a rejection that could never leave the phone. `createNote`
  takes a note on any visit, its notes finished or not.
- **The envelope lock reads the server** (review finding SLK-1, the coordinator's decision). A
  visit's patient, place (`location`, `locationText`) and summary are locked when its snapshot says
  `hasFinishedNote` (4.3) or a note of it on the phone is finished here (`envelopeLocked`). The
  visit's status is not read: a visit is a draft while any of its notes that counts is a draft,
  finished notes beside it or not, and the phone that signed may hold none of its finished notes
  once they have left it (8.2). Two exceptions, as on the server: a patient given to a visit with
  none, which takes nothing from what anyone signed, and the kind, which goes to Medical at any
  time (3.10). A finished note the person may not read leaves `hasFinishedNote` false, so their
  edit goes, and the server keeps it in history and tells them: they learn that the visit holds a
  finished note, and nothing more, which is accepted. After every finished note of a visit is
  reopened here, the envelope stays locked until a refresh brings `hasFinishedNote` false, and a
  closed visit is not refreshed until it is opened again (review finding SLK-2, kept as built):
  the phone may refuse for a while an edit the server would take, never send one it would keep in
  history.
- **`reopenNote(noteId, definition)`** sends the one change the lock lets through: a set of
  `status` to `draft`, from the field's server version and following its pending change, when
  `reopenEffect` says `apply`. The definition, of the note's own key and version, says whether the
  note is Medical; the status is the one the phone knows; `everSigned` is the snapshot's (4.4), so
  a note signed once is refused here as the server would keep it. It clears `localEffect`, and the
  note is a draft at once and takes edits again. It returns `nothing` for a draft, writing nothing.
  It throws, writing nothing: `RecordLocked` for what the server keeps as it is (signed, signed
  once, or a Non-Medical note completed: an addendum or a correction is the way) and while the note
  is sent for review (on the server the note is a draft, so the reopen would change nothing, and
  the admin's accept would finish the note after it); `LocalValidationError` `not_author` for
  someone else's note that its author could reopen; `ChartingPaused` while the clock check fails.
- **A reopen while the note's sign-off waits to send** is allowed (the coordinator's decision):
  the sign-off goes first, the server finishes the note and then reopens it, as the person did,
  and Complete again waits for that sign-off's receipt (`RecordLocked`). Where the server keeps the
  note finished after all, it is finished with what the person completed: when that sign-off is
  held and later accepted (the reopen reached a draft and did nothing), or when the note's own
  refused create is fixed (the fix folds the reopen in, and the sign-off goes after it; answers
  changed after the reopen make the hash differ, and the person completes again).
- **Who acts as the author** is the snapshot's `actingAuthorId`, else the note's author (3.8): an
  assignment made online moves Complete and the reopen to the assignee at the refresh.
- **Two visit changes are refused here** (the coordinator's decision): `setField` refuses, writing
  nothing, a visit's kind set back from Medical (`LocalValidationError` `kind_cannot_go_back`) and
  its patient removed (`patient_cannot_be_removed`). The server keeps both in history and tells
  nobody, so the person would believe them made (4.1). Clearing the patient is still allowed while
  the visit's own create is refused: the fixed create carries the person's choice.
- **The patient of a new record** is found through `EntityRules.patientVia` for every create, so a
  sign-off, an addendum and a correction keep their patient's chart while they wait, as a note
  and a problem note already did. `_fileUnder` files the sign-offs, addenda and corrections hung
  off a visit, records and waiting outbox entries, under the visit's patient as it stands here,
  whenever that differs from where they are: after a set of the visit's `patientId`, a conflict's
  choice of it, a receipt that kept the server's value, the fix of the visit's create, and the
  visit's refresh. As first built (`_fileUnfiled`) it filed only records with no patient, and left
  them under a patient filled here when the visit ended up with another (review finding SFN-4).
  `importServerRecord` files a record that names no patient the same way. A note's own outbox
  entries are not refiled: the open visit keeps their chart, as in phases 2 and 3. For an addendum
  or a correction on a note the phone does not hold, the domain layer opens the note first
  (`openServerRecord`), so it is filed under its patient; the store takes no patient hint (the
  coordinator's decision).
- **Receipts settle the effect inside the receipt's transaction.** `confirm` and `reject` call the
  settling themselves (`_settleSignoff`, `_signoffRefused`), not as `onConfirmed` and `onRejected`
  hooks, which run in savepoints that swallow their failures: a lost settle would leave a note
  locked as finished with nothing to undo it. A confirmed sign-off: the note takes the status and
  attestation the receipt gives, which are the server's decision whatever the phone expected (a
  credential lowered meanwhile saves a signature unsigned), into its record's status, its status
  field's value (the field's version left alone: a status never conflicts, and the refresh brings
  it) and `attestation` in its attributes, the key the snapshot uses. The `localEffect` is cleared
  only for the sign-off it names, and a reopen made after the sign-off and still waiting keeps the
  note a draft. A receipt that gives no state leaves the note as the phone expected, locked, until
  the refresh. A refused sign-off clears the `localEffect`: the note is a draft again, and the
  refusal waits in Needs attention for Complete to fix. `noteState(noteId)` gives the status, the
  attestation and whether the note is sent for review, as the phone shows them.
- **A sign-off held for review** is confirmed with no details: the note keeps its `localEffect`,
  stays locked, and is "Sent for review" (`sentForReview`). The store records it in its database's
  `kv` table, IDs only: `held_signoff.<noteId>` names the held sign-off until a decision reaches the
  phone, and `held_note.<signoffId>` names its note for good, so a later notice about a sign-off
  settled here already is known. The record is kept by note because phase 2's `in_review` table
  names no note, and the notice must work after the note has left the phone. The `in_review` rows
  stay as phase 2 keeps them: a count of what was sent for review, never decided on the phone, in
  which a held sign-off counts like any held change (the coordinator's decision). An admin's accept
  is settled by the refresh (4.10), with no notice.
- **`signoff_not_applied`** is the server's notice that a held sign-off will not reach the chart
  (4.6), worded by its kind alone (9.13). It settles only the held sign-off it names: the one this
  phone holds as sent for review loses its `localEffect`, and the note is a draft here again, to
  read and complete again, fetched again first if it has left the phone (`openServerRecord`). A
  notice about a sign-off settled here already (its note finished since) is stored read, never
  shown, and its read reaches the server at the next contact. A notice about a sign-off this phone
  knows nothing of (another phone's, or one from a database erased at a synced sign-out) is kept as
  it came, with the note it names (below). A held receipt that comes after its notice (the first receipt was lost, and the notices
  were fetched before the retry) is settled at once. `change_not_applied` always keeps its own
  sentence. The coordinator's decision on review findings SRC-1 to SRC-5: as first built the phone
  turned a `change_not_applied` on a note with a held sign-off into a local `signoff_not_applied`,
  matched by note, which a second phone could not word and a late reject of an earlier held
  sign-off could take for a later one.
- **`finished_differently`** is a notice of the phone's own, made from a confirmed sign-off with
  effect `none`, reason `already_finished` and `hashMatches` false: the note was finished over
  other content, and the person opens it and reads what was finished (3.4, 9.13). A receipt with no
  `hashMatches` (given only to whoever acts as the author, 4.6) tells nothing.
- **The refresh takes a note's attributes** (4.10): the server's, `localEffect` kept, unless the
  note's own create still waits. The `localEffect` stays while the server's copy is a draft or a
  sign-off of the note still waits, and goes, with the held record, once the server's copy is
  finished. An existing visit takes the server's attributes too, `hasFinishedNote` among them.
  The refresh of a finished note (by the rules' status, `completed` or `signed`) also keeps only
  the answers its read carries (D107, 4.5): each answer field of the note the snapshot leaves out
  leaves the phone's copy (`_dropAnswer`, as Complete drops one), unless an outbox entry of the
  person's own names that field (a change pending, refused or in conflict; a field's pending change
  is always one), which keeps it until its receipt. The note's other fields and its attributes, a
  draft's refresh and other records are as above. So a late change of the person's own keeps its
  row until its receipt, which keeps it in the server's history, and the refresh after that receipt
  takes the row away; a refused change to such an answer keeps its row while it waits in Needs
  attention, and its fix goes the same way.
- **What it costs.** A visit whose create is refused only after Complete, and then fixed with a
  patient, costs a second Complete: the fixed create reaches the server ahead of the waiting
  sign-off, whose hash had no patient, so the sign-off is refused `content_changed`. Refused before
  Complete, hard stop 2 has the visit fixed first, and the sign-off covers the patient. Sending the
  patient as a set after the sign-off would not fit the hold rule, which sends it in the same push
  as the fixed create, ahead of the sign-off; so this records the cost, the review's other choice
  (review finding SFN-6; D106). And an addendum sent in the same push as its note's sign-off, when the
  sign-off is refused, is refused `stale_reference`, as any child sent beside a refused parent is
  (phase 2's rule). As first built nothing fixed it, and hard stop 2 then refused the sign-off's
  fix for good (review finding PS-1). Since the review, completing the note again sends the fix and,
  after it, each refused create of an addendum or a correction refused only for naming that sign-off
  (`stale_reference`, `note_signoff_missing`), again as it was made, each a new change superseding
  the refused one, as `_resendDependants` sends what waited on a refused create (D49); hard stop 2
  leaves those out (`finishNotes`, `_refusedNamingSignoff`). So "Add to the assessment" goes again
  with its Complete, and a correction is never left with Leave it as the only way out. One naming a
  refused sign-off of a note not completed now still counts. Tested on the test server
  (`store_encounters_test.dart`) and live (`live_api_test.dart`). The summary's own hard stop 2
  (`complete.dart`'s `_waitsInNeedsAttention`, which draws the stop before the store is asked)
  leaves them out the same way, through the store's `noteCompletedAgainFor`: without it the summary
  refused the Complete the store takes, so completing again from the app never sent them (found
  building C-1). Needs attention's card for such a create says so, in plain words, “This waits for
  its note to be completed again.” and “It’s sent, as you made it, when you complete the note
  again. Open the note to complete it.”, and offers **Open the note**, the note whose refused
  sign-off it names (for Add to the assessment, the note of that sign-off), as the refused
  sign-off's own card does; a correction keeps Leave it beside it. Once Complete sends it again the
  refused entry is superseded and the card is gone (the coordinator's decision on review finding
  C-1; `test/features/encounters/needs_attention_test.dart`).
- **Open the note on a `signoff_not_applied` notice** (9.13). The notice names a sign-off, and a
  held sign-off is not on the chart: the sync read loads a sign-off from `note_signoffs`
  (`note-signoff.ts`), while the held value is in `quarantine_items`, and the test server's held
  sign-off is not in its records either. So a phone that knows nothing of the sign-off could not
  find the note from it. The coordinator's decision (Nov 18, D104), as built in wave F: the notice
  also names the note, in `user_notices.note_id` (migration 0022), which `signoffNotApplied` fills
  from the note it already reads and every other notice leaves null; the notices' list gives it as
  `noteId`; the test server writes and returns it the same way; `ServerNotices` hands it to the
  store, which keeps it with the notice (`LocalNotice.noteId`, in `kv` as
  `notice_note.<local notice ID>`, so the database's schema did not change). A phone that never
  held the sign-off, a second phone or one whose database a synced sign-out erased, opens the note
  by it (`openServerRecord('encounter_note', noteId)`), as Needs attention will (L5). It settles
  nothing: a held sign-off is still settled by its own ID alone, so the notice about one phone's
  held Complete leaves a later Complete of the same note, held on another phone, "Sent for review".
  The other choice, giving a sender their own held sign-off in the sync read, would send values
  from `quarantine_items`, which were never checked against a schema. Since D107, Completing the
  note again reads the notice on any phone, by the note it names (above, "What Complete writes"),
  and a phone that holds the note but not the sign-off files the notice under the note's patient:
  `ServerNotices` gives the patient of the sign-off's record, which only the sender's own phone
  holds, and `addNotice` takes the note's (through its visit, to the chart that holds them now)
  when it is given none. A phone that holds neither files it under no patient, as before.
  A notice read on the server before this phone fetched it (the person completed the note again
  on another phone, or tapped Got it there) still settles the held sign-off it names:
  `ServerNotices` hands a read `signoff_not_applied` notice to `addNotice` as it does an unread
  one, and keeps it read and acknowledged. Skipped, as a read notice of any other kind still is,
  it left the sender's held sign-off Sent for review and locked while the server held a draft
  (D107's review, finding F1).
- **Accepted** (the coordinator's decision of Nov 18, D106). With `empty` before the finish check,
  an empty Red flags note's sign-off sent beside Medical notes is stored with no effect, and the
  Medical notes are refused `red_flags_first`, not the Red flags note `incomplete`. The phone never
  sends it (it refuses it as `incomplete`); another client could, and nothing is finished that
  should not be. And while a sign-off is held, the refresh brings back into the phone's copy the
  answers Complete dropped, since the server's draft, and the author's own sync read of it, still
  hold them (4.4). They are in hidden fields or removed entries, so nothing shown changes, nor the
  hash; after a reject and its notice the draft is the server's, those answers included. The design
  expected the accept's refresh to take them away again; as first tested, in wave F, it did not: a
  finished note's read gives only the answers that count, so the phone kept such an answer at the
  version it had, while the server held it null at the next, and a reopen could show it again. The
  coordinator's decision (Nov 18, D107), as built: a finished note on the phone holds only the
  answers its sync read carries, so the accept's refresh takes them away (above, "The refresh takes
  a note's attributes"), unless a change of the person's own to one still waits (11.2).
- **For the domain layer and the screens** (the card index's L4 and L5 rows): Complete passes each
  note's act and statement version (3.3, 3.5), a `Signer` from the saved profile, a synchronous
  `definitionOf`, and `redFlagsFinished` when the visit read shows a teammate's finished Red flags
  note; draws the summary with `contentHashOf`; shows `NoteChanged` as "This note changed. Read it
  again."; expects the map to leave out a note whose fix only settles a refusal, and expects
  `needs_attention`, `empty` and `RecordLocked` (after a reopen, `RecordLocked` means the last
  Complete must sync first); and checks `sentForReview` before `finishNotes` or `reopenNote`, to
  say the note was sent for review rather than that it is finished. Remove this note, on a note
  whose sign-off was refused, calls `finishNotes` for it once blanked, so the refusal settles at
  the next sync. The close sweep (8.2) leaves open a note `sentForReview`, so the refresh settles
  it and the notice finds it. The screens show "Waiting to send" while a note has a `localEffect`
  and is not sent for review.

As built for the screens (the domain layer after unit L5's review, the coordinator's decided work;
`apps/mobile/lib/encounters/`). Its interface changed in these places, beside the visit read's new
fields (5 as built on the phone):

- **Reading a visit.** `EncounterRepository.openVisit` is unchanged, but the visit screen no longer
  reads through `EncounterApi.openVisit`'s order: it asks the server first, online (9.7 as built).
  `othersMayHaveAdded(encounterId)` says whether to ask at all: true for any visit but one made here
  whose create still waits, which nobody else can have reached; it reads no value and logs nothing.
  `serverReadLimit`, six seconds, bounds that read and the Red flags question below.
- **`NoteActions.holdNote(encounterId, noteId)`**, public, was `_hold`: it brings the visit and the
  note onto the phone when it lacks them, as an addendum or a correction does, so the store files
  them under their patient. Without signal or an engine it throws "This note isn’t on this phone.
  Connect to open it."; a record the server lacks is a `StateError`. The visit screen's Correct calls
  it, then `openNote`, in place of the engine's hook.
- **`openHandoff(encounterId)`** reads the phone's copy as `openVisit` reads and logs it, and writes
  `ems_handoff.shown` on the visit with its patient in the same transaction; it is null, logging
  nothing, when the phone holds no such visit, and throws `ChartingPaused` while the store is frozen.
  The handoff screen writes nothing to the store itself (9.8 as built).
- **`saveAnswer`** sends a save of an answer whose set waits refused as that refusal's fix
  (`store.fixRejected`), which supersedes it, so it settles at the next sync and nothing waits behind
  it; any other save is a `setField`, as before (9.13 as built). A note's create carries no answers,
  each going as a set of its own, so a refused create holds no answer of the form's; were one to, its
  fix would be the create's.
- **The refusals' fixes** (`refusal_fixes.dart`, a part of `encounter_repository.dart`):
  `settledByVisit`, `settledByPatient` and `settledByRemoving` say which card offers what;
  `sendWithoutVisit`, `hasVisitsToChoose` (which reads and logs nothing), `visitsToChoose` (which
  logs each visit it lists), `moveToVisit`, `choosePatientFor` and `removeRefusedNote` each send
  their fix through `fixRejected`, linked to the refused change, and refuse, writing nothing, while
  the store is frozen; the screen offers them only while the clock check passes (8.4 and 9.13 as
  built).
- **The Red flags note.** `finishedRedFlagsIn(visit)` gives the finished Red flags note a visit read
  shows. `EncounterApi.finishedRedFlags(encounterId)` asks the server's read for one within
  `serverReadLimit`: null without signal, for a visit the server lacks, after the limit or while the
  store is frozen, and the screens pass whether there is one as `redFlagsFinished` (8.2 as built).
  `RedFlagsNote.finishedRedFlagsNote(encounterId)` finds one the phone holds by a scan of the store,
  which reads no note for anyone and logs nothing (9.5 as built).
- **Co-sign and Attest** (`cosignPlan`, `attestPlan`): on a visit read from the server, the notes the
  read marks `canCosign` or `canAttest`, each with the hash it gives, and those it holds from the
  reader as `cannot_see_all` that wait; on any other copy, the phone's own rule, as a plan that reads
  the visit from the server first (`readOnline`). Each is null for a role that doesn't chart and for
  a saved credential that can't sign, or attest. The `is_author` refusal reads "You can’t co-sign a
  note you wrote, completed or act as the author of." (and the same of attest), as the API words it
  since unit L6's review, so no assignee is told they wrote a note.
- **Home's tiles** (`homeTiles`): online, a queue's tile only when the counts carry its number.
- **Referrals**: "Recorded by" from the record's `authorName` (`user.nameFor(…, named:)`), held or
  listed from a chart (9.10 as built).

### 4.9 The phone's test server

`apps/mobile/test/sync/fake_server.dart` mirrors the API by hand (plan risk 7). Each rule below
gets the same change in the fake and one case in `apps/mobile/test/sync/fake_parity_test.dart`
or `fake_reads_test.dart`, which hold the fake to the API's answers (D52). The API side of each
case is an API test with the same name.

| # | Rule the fake must mirror |
|---|---|
| 1 | An encounter's `status` is not settable; `summary` and `locationText` are; `kind` goes to `medical` at any time and never back |
| 2 | The envelope lock: a late change is `accepted` with `server` and `details.outcome: 'history_only'`; sent twice, it answers the same; a blank patient can still be filled |
| 3 | A Medical note needs a patient, and makes its encounter Medical |
| 4 | A note create is accepted on an encounter whose notes are finished; an unknown key or version is refused |
| 5 | A change to a finished note is kept in history, with a notice to the sender and to the author |
| 6 | Each row of the reopen table in 4.4; a `status` of `completed` is kept in history |
| 7 | Every case of `signoffEffect` in `note-lifecycle.json`; `red_flags_first`; a sign-off sent again after a refusal |
| 8 | The content hash over the answers that count, from `note-content-hash.json`; a finished note holds only those answers |
| 9 | An addendum is accepted in every state |
| 10 | Each step of a correction, in the order of 4.7, with several answers at once; each row of the table in 3.6 |
| 11 | A referral: create; `enteredInError` once, by its author or a charting role; the date rule; a visit of another patient |
| 12 | The Medical gate holds every kind of change to a Medical note for review |
| 13 | The encounter's status follows its notes (the trigger of 2.2, as code in the fake) |
| 14 | An answer that fails `checkAnswer` is refused with `validation`; an answer that will not count carries `details.notCounted`; a rule that throws is `definition_error` |
| 15 | `ems_handoff.shown` is an offline audit action |
| 16 | The sync read: a note's new attributes; for a reader who may not see a section, its answers, their versions and their history marks are all absent; who may read a sign-off, an addendum, a correction and a referral (6.4) |
| 17 | What is accepted with no effect, row by row of the second table in 4.1 |

The fake reads the same vector files, so rules 7 and 8 cannot drift.

As built (unit L3, cards L3-fake-encounter, L3-fake-signoff, L3-fake-rest and L3-parity, with
wave D's review). Each case of `fake_parity_test.dart` and `fake_reads_test.dart` is named after
the API test that holds the same rule, in `services/api/test/sync-{encounters,signoffs,corrections,referrals,reads}.test.ts`.

| # | In `fake_server.dart` | As built |
|---|---|---|
| 1 | `_create`'s encounter case, `_kindSet`, the registry | |
| 2 | `_envelopeKept` in `_draftSet` | Its notices go to the authors of the visit's finished notes too (4.3) |
| 3 | `_create`'s note case, `_makeMedical` | The parity case holds a held Medical note to no switch (review finding FAK-4) |
| 4 | `_create`, through `_definition` | A `noteTypeVersion` past the largest a change may name is refused by the fake itself until the registry bounds it (FAK-1) |
| 5 | `_lateChange`, `_lateKept` | |
| 6 | `_noteStatusSet` | A reopen from someone who does not act as the author is answered before the gate (4.1) |
| 7 | `_signoff`, `_finishedRedFlags`, `_isRedFlags`, `_finishingHash` | Every `signoffEffect` case of `note-lifecycle.json` goes through a real sign-off, its note type, credential, Red flags note and hash built from the case, an empty draft's on a note with no answers. Since the phone's store `_signoff` passes `emptyDraft` (`noteIsEmpty`), and a case holds that an empty draft's sign-off settles the refusal of an earlier one (3.4) |
| 8 | `_contentHash`, `_finishNote` | Every case of `note-content-hash.json`: the wrong hash is refused, the vector's is taken, and the note keeps exactly `effective` |
| 9 | `_create`'s addendum case, `_signoffOfOther` | |
| 10 | `_correction`, `_writeAnswers`, `_reviewersUndone` | Each step in the order of 4.7 as built |
| 11 | `_create`'s referral, problem, allergy and problem note cases, through `_visitOfOtherPatient`; `_set`'s `mayChange` | |
| 12 | `_medicalGate`, from the note create, `_noteSet`, `_signoff` and `_correction`; `_needsGate`, from all but `_signoff` | |
| 13 | `_refreshVisit` | Its case is named after the db test `db/test/encounter-lifecycle.test.ts`, "the encounter’s status follows its notes", and reads `note-lifecycle.json`'s `encounterStatus` cases through the fake's sync read; no API test has that name |
| 14 | `checkAnswer` in the note create and `_noteSet`, `notCounted`, `_byDefinition` and the `forged` rows, stored as `definition_error` by `_decide` | |
| 15 | the registry's `auditIssues`, in `_decide` | |
| 16 | `_fetch`, `_asRead`, `_noteAsRead`, `_noteSnapshot`, `_readSnapshot`, `_medicalHidden`, `_notesShown`; `_hiddenFromSender`, `_unreadableBySender`, `noteReader`, `mayHoldHidden`, `answerHidden` | With the read rules of 6.4 as built, a set held by what the answer could hold (`mayHoldHidden`, 4.4), and a retry answered from `_Receipt.result` as its sender may see the field (4.4). Since the phone's store: a note's `everSigned` (4.4), and a visit's `hasFinishedNote` from the notes the reader is shown, as its status (4.3), each held by a read case named after its API test |
| 17 | `_noteStatusSet`, `_kindSet`, `_envelopeKept`, effect `none`, `_correction`'s `not_author` and `draft_edit` | One case walks the second table of 4.1 row by row; `sync-corrections.test.ts` has the API test of its name (FAK-7) |

What else the fake does, as the API does: `signedUnder` is a copy of `signed-under.ts`
(`FakeSyncServer.signedUnder`), and every case of `signed-under.json` runs through it;
`_signedUnderFor` reads `credentialChanges` and `heldAt`, and a note's `storedAt` (when it was
held, else when it was made) is `notBefore`. A visit moves its patient's last seen to the earlier
of its start and the server's clock, later only (review findings FAK-5, REC-4), so the team index's
version moves too.

**The fake's defaults:**

- **Anyone the fake does not list** has the role Healthcare Staff and the credential `attending`
  (`FakeSyncServer.defaultCredential`), kept as built (as the coordinator decided): the default
  role is one that charts, so its credential is one that signs, and a test that needs a lower
  credential sets one (`credentials`, `changeCredential`). The API's membership default is `none`,
  so a phone test that never sets a credential passes the Medical gate on the fake where the API
  would hold it; the parity cases of the gate set the credential they test.
- **The CHW preset** holds `referrals.create` and `routes.view`, as `permissions.ts` does.
- **People and credentials**: `credentials`, `changeCredential` (which records the credential
  replaced) and `removedUsers`; the credential's capabilities are a copy of `CAPABILITIES`.
- **Note types**: `noteTypes`, by key and version, starts as the test-only types of
  `test_note_types.dart`; the Red flags and restricted types come from `sync-note-types.json`
  (`testRedFlags`, `testRestricted`, `testSensitive`, `testAssess`); `forged` names rows whose hash
  fails (D79).
- **Test hooks** stand in for what the fake has no route for: `finishNote` sets a note's state
  directly; `cosign()` and `attest()` stand in for L2's online routes, as the API tests' inserts
  do; `acceptHeld` is an admin's accept and `rejectHeld` their reject. Both tell the sender of a
  held sign-off that will not reach the chart as the API does (`_signoffNotApplied`, 4.6:
  `signoff_not_applied` naming the sign-off, once per sign-off, read or not), and a
  handed-over change that was rejected answers its retry with `decision: 'rejected'`, as
  `push.ts` does.

As built since the phase's review: the fake mirrors each of the review's fixes to the sync rules,
each held to the API by a parity case (but not the read logged for a value sent back, PA-1, since
the fake keeps no audit events of sync writes, below; and the online acts' fixes, PA-2 and PA-3, are
routes it does not have): an addendum or a correction naming a sign-off a reviewer rejected, taken
as naming none (`_rejectedInReview`, 4.7, finding PS-2); a Medical visit's summary set from a sender
who may not read it, held before anything (`_set`, 4.3), and a conflict its sender may not see into,
held (`_decide`, 4.4; VS-1); every value sent back, a retry's from `_Receipt.result` included, as
the sync read would show it to its sender, through one copy of the read rules (`_fieldForAnswer`,
`_readsRecord`, `_readsEntity`, `_summaryWithheld`; 6.4 rule 2, PA-4, VA-1); and a held correction
that will not reach the chart, whose sender `acceptHeld` and `rejectHeld` tell as the API does
(`_correctionNotApplied`, 4.6, VS-6).

**What the fake does not mirror**: the audit events of sync writes (it keeps the offline appends
and the online reads only); the team lock (it serves one request at a time); credential fields,
the NPI, signers' and correctors' names and `approvedBy` on stored rows; the database's guards and
constraints; the review queue's route; and a record's own version in most snapshots, which say
version 1 and the time of the read, except a filtered note, versioned and dated by the fields it
shows (6.4), and a problem, read as its chart shows it.

### 4.10 What a phone learns later

Co-signing, attesting and assigning happen online, on another device. The author's phone learns
of them in three ways:

- **A notice** (`user_notices`) on the next sync. New notice kinds, none with any text:
  `note_cosigned`, `note_attested`, `note_assigned`, `note_saved_unsigned`, `late_change_kept`,
  `change_not_applied`, `signoff_not_applied` (a held sign-off that will not reach the chart,
  added with the phone's store), `note_corrected` (to a co-signer or attester whose note was
  corrected).
- **The record refresh**, for a note the phone still holds open: the snapshot's new attributes
  (4.4) show its state. The refresh covers open records only
  (`apps/mobile/lib/sync/sync_engine.dart:497-517`).
- **The visit read** (5.1), for everything else. A finished note has left the phone, and a
  teammate's addenda, corrections, co-signatures and attestations are rows the phone never held.
  The visit screen asks the server for the whole visit and shows it from memory. It is not saved
  on the phone, and it is not available offline (8.2).

As built (unit L1): the notices the sync rules write, each with no text, on entity
`encounter_note` and the note unless the table says otherwise. Each person is named once, and a
retry, answered from its receipt, tells nobody again.

| Kind | To | When |
|---|---|---|
| `late_change_kept` | the sender, and the acting author when that is someone else | a change to a finished note kept in history (4.4) |
| `late_change_kept`, on entity `encounter` | the sender, and whoever acts as the author of each finished note of the visit | a change to the patient, the place or the summary kept in history (4.3) |
| `change_not_applied` | the sender alone | a reopen, a sign-off or a correction from someone who does not act as the author (4.1) |
| `signoff_not_applied`, on entity `note_signoff` and the held sign-off, naming its note in `note_id` (the list's `noteId`, D104) | its sender | a held sign-off a Program Admin rejects, or whose accept is refused as `content_changed`; once per sign-off, whether or not an earlier notice was read (4.6). Until the phone's store it was `change_not_applied` on the note, unless an unread one named the note |
| `correction_not_applied`, on entity `note_correction` and the held correction, naming its note in `note_id` | its sender | a held correction a Program Admin rejects, or whose accept is refused; once per correction (4.6, review finding VS-6) |
| `note_saved_unsigned` | the signer | a sign-off saved unsigned (4.6) |
| `note_corrected` | the co-signer whose co-signature a correction clears; every attester of the current signature when an attested note is no longer attested; never the corrector | a correction applied (4.7) |
| `conflict_resolved` (phase 2) | the note's author, when the value kept was someone else's | an answer of `keep_server` that saw the current value, a finished note's included (4.3) |

`note_cosigned`, `note_attested` and `note_assigned` come with the online routes (L2). As built,
`note_cosigned` and `note_attested` name the visit (entity `encounter`), once per visit however
many of its notes the act covered (5.3, 5.4). A change
kept with `use_signoff`, `kind_cannot_go_back` or `patient_cannot_be_removed` sends none: the
receipt's `details.problem` tells the phone, which sends none of the three (4.1, 4.8). An addendum
tells nobody, nor does a sign-off of an empty draft (3.4). One notice is the phone's own, made from
a receipt and never sent by the server: `finished_differently`, for a sign-off that found its note
finished over other content (3.4, 4.8, 9.13).

The record refresh reads the note's new attributes (4.4). In every copy but the acting author's
copy of a draft, a note's `version` and `updatedAt` are those of the latest field it shows, so
they do not move when only a hidden answer changes (6.4); the phone reads only the fields'
versions.

As built on the phone (unit L3's store, 4.8): the refresh of a note takes the server's
attributes (`attestation`, `actingAuthorId`, `everSigned`, `completedAt`, `signoffId`), keeping the
phone's own `localEffect`, unless the note's own create still waits; so an attestation made online,
or an assignment (3.8), reaches a note the phone holds. It also settles a sign-off held for review
once the server's copy is finished (a Program Admin accepted it, or the note was finished another
way), with no notice. The refresh of a visit the phone holds takes the server's attributes too,
`hasFinishedNote` among them (4.3), which the envelope lock reads.

Since D107, the refresh of a finished note also leaves the phone's copy with only the answers its
read carries (4.5, 4.8): an answer the read leaves out leaves the phone, unless a change of the
person's own to it still waits, which keeps it until its receipt. The server holds most such
answers null in its history; one it keeps from this reader, and one a correction hid, which stays
in the server's note (4.7), leave the phone too (4.5 says what that costs at a reopen). A teammate's or the author's other phone's Complete thus reaches
every phone that holds the note as what was finished, with nothing the finish dropped. And a
`signoff_not_applied` notice is read on any phone once the person completes its note again there,
by the note it names, and is filed under that note's patient on a phone that holds the note but not
the sign-off (4.8, 9.13).

## 5. API routes that only work online

All are `@hono/zod-openapi` routes in a new file, `services/api/src/routes/encounters.ts`, with
their logic in `services/api/src/encounters/`. Each checks its permission first, runs in one
transaction and writes its audit event in that transaction. A refusal of access (403) is logged
too, as `access.denied` with the reason's name; a state conflict (409), input the route cannot
take (422) and a record the team does not have (404) are not, as in phases 1 to 3, and neither is
`reauth_required`, which asks for a fresh sign-in and refuses no access (10.1; review finding
LPM-2). `services/api/test/permissions.test.ts` gets a row for each route.

**Every route that writes** (5.3, the attest of 5.4, 5.5) calls `lockTeamWrites` as its first
statement, as every online writer does today (`services/api/src/sync/locks.ts:13-15`;
`services/api/src/patients/corrections.ts:37`), and then loads each note it will change for
update. A push takes the team lock first and a note's row second; a route that did it the other
way round could deadlock with one, or check a hash and then sign a note that a correction had
just changed.

| # | Route | Key | Credential |
|---|---|---|---|
| 5.1 | `GET /v1/encounters/{encounterId}` | `patients.view` | none |
| 5.2 | `GET /v1/patients/{patientId}` (existing) gains `timeline`, and the phone's `POST /v1/patients/charts` `timeline` and `recentVisits` (as built, unit L6); `GET /v1/patients/{patientId}/timeline` | `patients.view` | none |
| 5.3 | `POST /v1/encounters/{encounterId}/cosign` | `encounters.chart` | `sign` |
| 5.4 | `GET /v1/team/cosign-queue`, `GET /v1/team/attestation-queue`, `POST /v1/encounters/{encounterId}/attest` | `encounters.chart` | `sign` for the first; `attest` for the other two |
| 5.5 | `POST /v1/notes/{noteId}/assign` | `team.manage_users`, and a recent sign-in | none |
| 5.5 | `GET /v1/notes/{noteId}/assignees` (unit L6) | `team.manage_users` | none |
| 5.6 | `GET /v1/me/notes-to-finish`, `GET /v1/team/incomplete-notes`, `GET /v1/me/counts` | `encounters.chart`; `team.manage_users`; any member | none |
| 5.7 | `GET /v1/encounters/{encounterId}/ems-handoff` | `patients.view`, and a recent sign-in | none |

As built (unit L2, with its review): `registerEncounterRoutes`, which `services/api/src/app.ts`
calls, holds the eleven operations, `getEncounter`, `getPatientTimeline`, `cosignEncounter`,
`getCosignQueue`, `getAttestationQueue`, `attestEncounter`, `assignNote`, `getNotesToFinish`,
`getIncompleteNotes`, `getHomeCounts` and `getEmsHandoff`; the phone's generated client has every
one but the last, whose answer is a file (5.7). Unit L6 added a twelfth, `getNoteAssignees` (5.5),
for the portal's Assign picker. The team scope checks each key before the route's
transaction and logs its refusal as `access.denied` with the key and the route's pattern; a route
that needs a recent sign-in asks for it after the key. A credential is checked by the act's own
rule (5.3, 5.4). Co-sign and attest read the caller's membership again once the team lock is
theirs (5.3).

As built for the portal (unit L6, its API job; the coordinator's decisions of Nov 19, with the
review of the unit's earlier build): the routes answer what the portal's pages would otherwise
work out, so a page holds no rule of its own. Who may co-sign or attest a note is decided in one
module, `services/api/src/encounters/second-person.ts` (`actNote`, `cosignOf`, `attestOf`,
`maySecondSign`, `secondPersonView`), which co-sign, attest, the queues' `canAct` and the visit
read's `canCosign`, `canAttest` and `heldBecause` all ask (5.1, 5.3, 5.4). A patient is named by
`preferredNames` (`read.ts`) wherever a list or the visit read names one: the chart's, or the
chart's they were merged into, and only to a reader with `patients.view` (5.1, 5.4, 5.6). Each
field added to an answer carries a default in the contract (a field a phone may hold from before
it is optional there), so a chart's timeline or recent visit cached before it, and a scripted
answer written before it, still reads (`encounters-read-actions.test.ts`, "the contract"); the
API always sends each one that has a default, so the portal reads them as given (the
coordinator's decision). No page reads `GET /v1/forms/note-types`, which may install presets:
each list gives each note's `title`.

As built on the phone (the domain layer, unit L4, `apps/mobile/lib/encounters/encounter_api.dart`,
with its review): `EncounterApi` calls, through the generated client and as the person in the open
team, the routes the phone uses: the visit read, earlier visits, co-sign, attest, the two queues,
the person's notes to finish and Home's counts (assigning, the team's incomplete notes and the
handoff are the portal's). It asks nothing while the store is frozen. Each answer becomes what a
screen draws (a visit through `visitFromRead`, 9.7 as built) and each refusal an
`EncounterRequestFailed`, with the sentence the screen shows, the server's code and the notes a
co-sign's or an attest's refusal names. No signal gives each call's own sentence ("Connect to
co-sign.", "This visit isn’t on this phone. Connect to open it."); a 401, or a 403
`reauth_required`, "Sign in again to go on."; another 403 the rule's sentence, from the API's code
where it names one (`is_author`, `is_signer`, `cannot_sign`, `cannot_attest`, `cannot_see_all`,
`not_a_member`); a 404 "This visit can’t be found." or its like; a 409 `content_changed` or
`not_waiting` "This visit changed. Read it again." (9.9); any other 400, 409 or 422, a fault of the
app, "Something about this request was wrong. Load it again."; anything else "Something went wrong.
Try again.". These sentences are this layer's where the design gives none.

- **Co-sign and Attest** (5.3, 5.4; the coordinator's decision). `cosignPlan` and `attestPlan` ask
  the server's own rules (`cosignEffect`, `attestEffect`, 3.12) of each waiting note as if its hash
  matched, as a queue's `canAct` is asked: never a note the person wrote, completed or acts as the
  author of; for Attest, never one whose current signature is theirs; nothing to a role that
  doesn't chart or a credential that can't sign or attest. A waiting note the server's read gave
  without a hash holds a part they can't open, and says so ("This note has a part you can’t open.
  Ask a Program Admin."). They act only on a visit read from the server, with the hashes that read
  gave: a plan from a visit read from the phone or from a chart's cache says `readOnline`, and the
  screen reads the visit online first, so the hash sent is of what the server holds and the person
  read (3.7). `secondAct` sends every note of the plan, all or nothing, and gives back what each
  note is now. Since unit L5's review a plan on a visit read from the server is that read's own
  answer, the notes it marks `canCosign` or `canAttest` with its hashes and those it holds as
  `cannot_see_all`; the rule above decides only whether a copy read elsewhere offers to read the
  visit online first (4.8 as built). The phone reads each note's `canCosign`, `canAttest` and
  `heldBecause`, the visit's `preferredName` and `recordsOnAnotherChart` (5.1 as built for the
  portal's visit page), and each queue note's `heldBecause` (5.4).
- **The rest**: the queues (`cosignQueue`, `attestationQueue`), earlier visits (`earlierVisits`)
  and the person's drafts on the server (`notesToFinish`) are the routes' answers, logged by the
  server. Home's tiles (`homeTiles`) never throw for want of signal or of an answer: Home shows the
  phone's own numbers then (9.9 as built).
- **Tests**: against scripted answers (`apps/mobile/test/encounters/scripted_api.dart`), the phone's
  test server having none of these routes, and against the real API in
  `apps/mobile/test/encounters/live_domain_test.dart`, which `tools/live-sync.sh` runs (11.2).

### 5.1 Read a visit

Answer: the envelope (`kind`, `status`, `startedAt`, `clockVerified`, `locationText`, `summary`,
`patientId`), the visit's own addenda, and for each note the reader may see (6.4):
`noteTypeKey`, `noteTypeVersion`, `status`, `attestation`, author and acting author (ID and
display name), `read` (the note laid out for reading by the forms part's `readModel`, which the
portal and the phone draw), `signoffs`, `addenda`, `corrections`, `attestations`, `contentHash`.

- `read` is built from the answers the reader may see (the forms part's `visibleAnswers`, 6.4).
  A note the reader may not see at all is absent, not blanked, and so is everything that hangs
  off it. A correction to an answer the reader may not see is absent too: its old and new
  values would give the answer away.
- **A correction is absent when its old or its new value holds anything `visibleAnswers` hides
  from the reader**, not only when the answer itself is hidden: a picker corrected from heart
  and GU to heart alone would show GU's label to a reader without
  `patients.view_sensitive_exams`. The server tests each change by putting its old value, and
  then its new one, in place of the answer and comparing what `visibleAnswers` keeps at that path
  with what `effectiveAnswers` keeps; a change in a section or an entry the reader may not see is
  absent whatever its values. `readModel` is given only the corrections that remain: it lays out
  every corrected change it is given, an answer the correction took away as an item with no
  value under its old one struck through (forms 7.1).
- `contentHash` is present only when the reader sees every answer that counts. Co-sign and
  attest need it.
- Refusals: `404` for an encounter the team does not have. Audit: `encounter.viewed`, with the
  patient ID and the note IDs shown.

As built in the sync read (unit L1, `services/api/src/sync/review.ts` `fetchRecords`), which
this route matches (unit L2, below):

- **A note** is missing when the reader may not read it, and when the server cannot read its
  definition: what it would hide cannot be told. Otherwise it holds only the answers the reader
  may see, each with its version; whoever acts as the author of a draft gets every answer it
  holds. A correction is missing whole, not stripped, when its old or its new value at any field
  it changes is hidden from the reader (`answerHidden`), as this section says.
- **`contentHash`** of a sign-off goes only to whoever acts as the note's author, its signer, and
  a reader who sees every answer of any note: `patients.view` with `encounters.chart` or
  `billing.view_codes`, `patients.view_sensitive`, `patients.view_sensitive_exams`, and a
  credential that charts Medical (`readsWhole`; review findings NOT-5, RD-1). The rule asks this
  of the reader, never of what the note holds: given whenever the reader sees every answer that
  counts in this note, its absence would tell that something is hidden. It is stricter than the
  bullet above: a Program Admin without a clinical credential gets no hash. Since unit L2's review
  it is never given over a visit's summary withheld from the reader, whoever they are: the hash
  covers the summary (review finding LRD-5). The visit read gives a sign-off's hash by this
  rule. A note's own `contentHash`, which co-sign and attest (5.3, 5.4) need, the visit read
  gives more widely, as decided below (review finding LRD-3).
- **A Medical visit's summary**, and an addendum to a Medical visit that names no note, are
  Medical content (6.4, row 1): read with what reads its notes, `patients.view` with
  `encounters.chart` or `billing.view_codes` (review finding RD-7). Anyone else gets the visit
  without its summary, its version or its mark, and the addendum is missing. Open: whether a
  Medical visit's `locationText` is Medical content too; it is still read.
- **A note's version and time**: in every copy but the acting author's copy of a draft, the
  highest version among the fields it shows, and the latest of their times, never before the
  note was made (review finding RD-6), so a change to a hidden answer moves neither.
- **The audit**: one event for each record the read returns, not one per visit with `noteIds`
  (10.1).

As built (unit L2, with its review; `services/api/src/encounters/read.ts`, `getEncounter`):

- **One copy of each read rule.** `read.ts` exports `readsWhole`, `medicalHidden`, `readerOf`,
  `seenBy`, `noteAsRead`, `statusShown`, `hiddenCorrections` and `signoffHashShown`, and the
  sync read, the timeline, the lists of 5.6 and the queues call them, so a fix lands once (the
  coordinator's decision after the review). The one difference is an option of `noteAsRead`: the
  sync read sends whoever acts as the author of a draft every answer it holds, without the
  interpreter, while the visit read lays every note out by `visibleAnswers`, the author's too.
  The phone's test server keeps its own copy, held to the API by its parity cases.
- **The answer** (`VisitRead`): `encounterId`, `patientId`, `kind`, `status`, `startedAt`,
  `clockVerified`, `locationText`, `summary` (absent, not null, when a Medical visit's summary is
  withheld from the reader), the visit's own `addenda` (none, then), `notes`, and `records`: the
  referrals, allergies, problems and problems' notes made at the visit, whichever chart they are
  on, each as the chart shows it to the reader (a problem and its notes need the problem list's
  keys, a sensitive one `patients.view_sensitive`; 9.7, D91). Each note (`VisitNote`) also has
  `title`, `group`, `completedAt` and `recap`. A correction (`CorrectionView`) names its
  `fields`, not its values, which `read` holds; an attestation's own hash is never sent. Each
  sign-off, addendum and correction names its person and credential as stored with it, and each
  attestation its attending.
- **The recap** (8.1; D108, the coordinator's decision): each note's `recap` is the forms
  part's `recapLines` over `seen`, the answers that count that the reader may see, the same answers
  its `read` is laid out from. Whoever acts as the author gets the lines of every answer that
  counts; anyone else none of a section, a treatment record, a diagnosis or any answer
  `visibleAnswers` keeps from them; a sensitive exam is in no line for anyone (6.4 rules 2, 3 and
  8). A diagnosis left out takes its entry with it, so the entries after it are numbered as if it
  had never been there. The phone shows it for a visit read from here or from a cached chart's
  recent visits (5.2), having no answers of its own to work it out from (9.7). It is worked out at
  each read, never stored (2.6), from the answers as corrected: `read` shows the corrections.
- **Left out**, besides what 6.4 hides: an empty draft (3.1), and a phase 2 note with no
  version, which has no definition to lay it out by (the sync read sends that one whole). The
  visit's `status` is worked out from the notes shown (`statusShown`: `encounterStatus` over
  them, an empty draft not counted), so it says nothing of a note left out (review finding
  LRD-2). The timeline and the sync read give the visit's status the same way.
- **A correction** is asked of every state the note has held, not only of the note as it is now
  (`hiddenCorrections`; review finding LRD-1): also with the later corrections undone, in the
  order they were applied, and, since corrections received in one push share their time, with
  each one's old or new values put back. One made while its entry held a sensitive diagnosis
  stays hidden after a later correction moves the code off the sensitive list.
- **The note's `contentHash`** goes to whoever acts as the note's author, a reader who sees every
  answer of any note (`readsWhole`), and a reader who may co-sign or attest (`encounters.chart`
  and a credential that signs or attests) and sees every answer that counts in this note; never
  over a summary withheld from the reader. This closes the Open of the sync read's bullet above
  (the coordinator's decision on review finding LRD-3). Unlike D86's rule for a sign-off's hash,
  it asks what the note holds, so a reader who may co-sign or attest learns from a missing hash
  that the note holds content they may not see. The queue's `canAct` already tells them so (5.4;
  6.4 rule 4), and the online act needs the hash. The sync read keeps D86: it sends no note's
  hash, and a sign-off's only by `signoffHashShown`.
- **Refusals**: without `patients.view`, 403, logged. A visit the team does not have is 404, and
  an ID that is not a UUID 422; neither is logged.
- **The audit**: one event per record returned, as the sync read logs it (10.1), each on its
  entity and ID, with its patient and `{ source }`: `phone` when the request comes from a
  registered phone of the reader's, else `portal` (`cache` for the phone's cached chart's recent
  visits, 5.2; `chart`, for the portal's chart read, went with unit L6). The visit is
  `encounter.viewed`. Each note, sign-off, addendum, correction and
  attestation is `note.viewed`, on `encounter_note`, `note_signoff`, `note_addendum`,
  `note_correction` or `note_attestation`. Each record made at the visit is `patient.viewed` on
  its own entity and its own patient, which can be another chart's.
- The visit read gives `locationText` to every reader; the Open above about a Medical visit's
  still stands.

As built for the portal's visit page (unit L6, 9.11), `VisitRead` and `VisitNote` also answer:

- **`preferredName`**: the patient's, from the chart they were merged into when they were, as a
  queue row names them (`preferredNames`); null for a visit with no patient.
- **`hasHandoff`**: a Red flags note the reader reads shows its `show_handoff` action, asked by the
  export's own test (`showsHandoff`, `handoff.ts`) of every Red flags note the reader may read, so
  the page offers Export EMS handoff (PDF) exactly when the route would give the file; false for a
  reader who may not read that note, whom the export refuses `cannot_see_red_flags` (5.7).
- **`recordsOnAnotherChart`**: the IDs of the records made at the visit that are on a chart other
  than the visit's now, by the patients' canonical charts, so a record kept under a merged ID of the
  visit's own patient is on its chart, and every record of a visit with no patient is on another.
  The page says "On another chart now" from it rather than comparing patient IDs (the coordinator's
  decision on the review of unit L6), and since unit L5's review so does the phone's visit screen
  for a visit read from the server (9.7 as built).
- **Each note's `medical`**, beside its `title`.
- **`canCosign` and `canAttest`**: the act's own rule (`cosignOf`, `attestOf`) asked of the reader
  as if the hash they would send matched, as a queue's `canAct` is, and false for a role without
  `encounters.chart`, which the routes refuse. The page sends exactly the notes so marked, each with
  its `contentHash` (5.3, 5.4).
- **`heldBecause`**, for a note that waits for a co-signature or an attestation the reader may not
  give, whenever the act's first refusal of them, in the rule's order, is about the note, whatever
  their credential: `wrote` (they wrote it), `acts_as_author` (it was assigned to them; an assignee
  is never told they wrote it), `completed` (they completed it, as whoever acted as its author
  then), `signed` (its current signature is theirs) or `cannot_see_all` (6.4 rule 4). So a
  resident or a student is told of a note they wrote, though their credential could not co-sign it
  either: the sentence is true, and the refusal it gives comes first (the coordinator's decision on
  the review of unit L6). Absent when the note waits for nothing, the reader may act, the first
  refusal is about their credential, or their role does not chart, which the page shows by
  offering no action. The queues give it on each note too (5.4).

None of these adds an audit event: the read logs each record it returns, as above.

### 5.2 The timeline, and recent visits

The chart answer (`services/api/src/patients/charts.ts`, `projection.ts`, `schemas.ts`) gains:

- **`timeline`**: the merged group's encounters, newest first, the first 50, each with
  `encounterId`, `startedAt`, `kind`, `status`, and its notes as
  `{ noteId, noteTypeKey, group, status, attestation }`; and the group's referrals. `group` is
  the note type's timeline group (forms 2.2): one of the PRD's filter names, "clinical, psych,
  social, referrals, outreach, harm reduction, wound" (PRD main 725). A note the reader may not
  see is left out of its encounter's list. An empty draft is left out (3.1).
- **`recentVisits`**: the last three visits in full, each as 5.1 answers it. The PRD's offline
  copy of a chart holds "charts, allergies, alerts, recent notes" (PRD main 533), so a worker
  can read what happened last time with no signal. PLAN-OPEN 12.1 #17 (how many).
- **`GET /v1/patients/{patientId}/timeline?before=<encounterId>`** returns the next 50, for
  "Show earlier visits" on the phone and the portal. Audit: `chart.timeline_viewed`.

On the phone both ride in the patient record's `_chart` field (D44), under the chart's 24-hour
cache, so the profile shows the timeline and the last three visits offline. The file that builds
that field names its keys by hand (`apps/mobile/lib/patients/chart_cache.dart:40-56`, `:145`):
card L4-chart-cache adds `timeline`, `recentVisits` and the referral snapshots to it.

As built (unit L2, with its review; `services/api/src/encounters/timeline.ts`):

- **Where.** `GET /v1/patients/{patientId}` and the phone's `POST /v1/patients/charts` carry
  the timeline, and the phone's alone the recent visits (unit L6, below). Both are optional in
  `PatientChart`: a chart shown beside a decision (the duplicate pair page, an identity
  correction's answer) shows no visit, so it carries neither and logs none.
- **`timeline`** is `{ encounters, referrals }`. Each visit is `{ encounterId, startedAt, kind,
  status, notes }`, newest first by its start and then its ID, the first 50 (`TIMELINE_PAGE`).
  Also left out of a visit's notes: a phase 2 note with no version, and a note whose definition
  the server cannot read. A visit's `status` is worked out from the notes listed (`statusShown`;
  review finding LRD-2), and a visit whose notes are all left out is still listed, a draft with
  no notes. The referrals are the group's, read whole with `patients.view` as the sync read gives
  them, in the order they were recorded; a screen that lists them newest first by `referredOn`
  (7) sorts them itself.
- **`recentVisits`** are the newest three visits of the timeline (`RECENT_VISITS`, PLAN-OPEN
  12.1 #17), each read and logged by the visit read for the same reader (5.1), with `source`
  `cache`, on `POST /v1/patients/charts` alone (`cachedRecentVisits`). So each of their notes
  carries its recap as that reader may see it (D108), which the phone shows from its cached chart
  offline (8.1, 9.7). The portal's chart read, `GET /v1/patients/{patientId}`, carries the
  timeline alone (`chartTimeline`), part of its own `patient.viewed`, and reads and logs no visit
  in full: the portal opens a visit on its own page, and a read is logged where it is shown (unit
  L6; the review of its earlier build found the portal's chart logging three visits' notes it never
  showed). The visit read's `source` `chart` went with it.
- **Each timeline note** also has `title` and `medical` (unit L6), so no page reads the note types
  list to word it.
- **A referral's snapshot** (the timeline's, the sync read's and the records made at a visit) names
  who recorded it, `attributes.authorName` (unit L6), as an addendum names its author. A referral
  keeps no name of its own and the unit added no migration, so it is the recorder's display name
  now, as a note names who acts as its author (D108).
- **Earlier visits** (`getPatientTimeline`) needs `patients.view` and answers `{ encounters }`:
  the next 50 after the visit named, by start and then ID, so a visit at the same time as the
  last one shown is not skipped; without `before`, the first page. A merged ID answers its group.
  A patient the team does not have, or a `before` visit outside the group, is 404; a `before`
  that is not a UUID is 422. Logged as `chart.timeline_viewed` on the canonical patient, with
  `resultCount` and `before` (10.1).
- **No projection step.** Both are built for the reader, so `projection.ts` did not change, nor
  did the projection key, which names neither `patients.view_sensitive_exams` nor the
  credential. A cached chart's recent visits follow a change of either at the chart's next
  refresh, and a phone offline keeps what it holds until it syncs, at most 24 hours, as phase 3's
  charts do (the coordinator's decision on review finding LPM-8; a comment at `fetchCharts` in
  `charts.ts` says so).

As built on the phone (unit L4, card L4-chart-cache, `apps/mobile/lib/patients/chart_cache.dart`,
with its review): `ChartMeta` keeps the chart answer's `timeline` and `recentVisits` in the patient
record's `_chart` field and gives them back typed, with the timeline's referral snapshots
(`referrals`). They live and die with the chart: purged with it, never sent to the server, replaced
whole at each refresh, so an answer that carries neither leaves nothing of the last (D100), and
kept as they are while the phone is offline. A copy opened from the index has none. They are read
defensively (review finding LRA-4): what no longer reads by the contract the app was built with (a
chart cached before D108 made a note's recap lines required) is treated as not cached, so the chart
still opens offline: such a recent visit is left out and opens online, a timeline that no longer
reads is none, and each referral is read on its own. The profile's timeline (9.1), a recent visit
(9.7) and the Referrals sheet (9.10) read them from here. The referral snapshots stay in the cached
timeline and are not taken onto the phone as records, but for one marked entered in error offline
(7 as built).

### 5.3 Co-sign

A visit often has several notes (a Medical visit has at least two, forms 6.2), and "the timeline
shows one entry per visit" (PRD main 97). So a second person signs a visit's waiting notes in one
action, not one note at a time.

Body: `{ notes: [{ noteId, contentHash }], statementVersion }`. The list must hold every Medical
note of the encounter that waits for a co-signer and that the caller may act on. Each note is
checked by `cosignEffect` (3.12): it is a Medical note that is `completed`, else `409
not_waiting`; the caller does not act as its author, else `403`; the caller's credential can
sign, else `403`; the caller sees every answer that counts, else `403`; the hash matches, else
`409 content_changed`. A `409` names the notes that failed, and nothing is written: the screen
loads the visit again.

Then, in the same transaction, for each note: a `note_signoffs` row (`act: 'cosign'`, the
server's time) and the note becomes `signed`, with `attestation` from the co-signer's credential.
Audit: one `note.cosigned` per note. Notice to each author: `note_cosigned`, one per visit.

As built (unit L2, with its review; `services/api/src/encounters/cosign.ts`, `cosignEncounter`):

- **The body** is `NoteActInput`: one to 50 notes, each named once, each hash 64 hexadecimal
  characters, and a `statementVersion` of 1 to 40 characters from `a-z`, `0-9`, `_`, `.` and
  `-`; anything else is 422. The version is recorded and not checked against `cosign-2026-11`,
  as a sync sign-off's is (12.1 #23): the portal shows the current statement (kept as built).
  The answer is `NoteActResult`, each note's `{ noteId, status, attestation }`.
- **Under the team lock** the caller is read again, their membership, role, credential and its
  fields, since the request's were read before the lock and a demotion or a removal that held it
  first may have committed since (review finding LAC-4). The act is asked of, and recorded under,
  who they are then: one no longer an active member is refused `not_a_member`, and one whose role
  no longer charts is refused as the route would refuse them; both are 403 and logged. Then each
  note named is loaded for update.
- **Each note named.** One of another visit, one the team does not have, and one the caller may
  not read at all are `not_waiting`, before the rule is asked, so no answer tells the state of a
  note the caller may not read (6.4 rule 5; review finding LAC-5). `is_author` covers whoever acts
  as the note's author now, its writer and whoever completed it: a writer whose note was assigned
  away while they were gone, and who came back with a credential that signs, is no second person
  (review findings LPM-1, LAC-3). Attest and the queues' `canAct` ask the same.
- **A waiting note left out** of the list that the caller may act on is `409 content_changed`,
  naming it: their screen showed an older visit. A note they may not act on may be left out.
- **Refusals of several notes**: the one first in the rule's order (`not_waiting`, `is_author`,
  `cannot_sign`, `cannot_see_all`, `content_changed`) is answered, and `error.details.noteIds`
  names every note refused for it (kept as built). Nothing is written but the log of a refusal
  about the caller, a 403 (`is_author`, `cannot_sign`, `cannot_see_all`): `access.denied` on
  entity `encounter` and the visit, with its patient, `{ reason, route, noteIds }`, whenever a
  note has one, even when a 409 is answered (review finding LAC-7). A 409, a 422 and a 404 are
  not logged (10.1).
- **What it writes**, for each note: a `note_signoffs` row with act `cosign` and effect `signed`,
  its ID made by the server, `signed_at` the server's time and `clock_verified` true, the
  credential, NPI and fields the caller holds once the lock is theirs (`signedUnder` is not
  asked: online, an act's time is its receipt's), no claimed credential and no change, and the
  caller's phone when the request comes from one registered to them. The note becomes `signed`,
  names the sign-off, takes the attestation the credential needs, and keeps `first_signed_at`
  when it was signed before a correction sent it back; `completed_at` and `completed_by` stay.
  Its `status` is written as a field, with a version, its meta and a history row by the
  co-signer, so a phone that holds the note learns of it (4.10). One `note.cosigned` per note, on
  the note, with the visit's patient: `{ signoffId, credential, needsAttestation }`. One
  `note_cosigned` notice to each note's acting author, on entity `encounter` and the visit, once
  for the visit.
- **The Red flags note.** A co-sign does not wait for it: with the visit's Red flags note reopened
  to a draft, its other waiting notes are co-signed all the same (3.5; the coordinator's decision
  on review finding LAC-6).
- **The `is_author` message** names everyone the code covers: "You can’t co-sign a note you wrote,
  completed or act as the author of." (attest's: "You can’t attest a note you wrote, completed or
  act as the author of."), so it never tells an assignee they wrote the note (the coordinator's
  decision on the review of unit L6). The portal shows no refusal's message: it loads the visit
  again, and the note says why (9.11 as built).
- **Since the phase's review.** A note named that the caller may not read at all, still answered
  `not_waiting`, is logged too, as `access.denied` with reason `cannot_read` and the note IDs, on
  the visit with its patient, in the request's transaction (D98 as amended; 10.1). That each
  act's event is written in the act's own transaction is held by tests that compare the
  transaction (`xmin`) of the act's row with its event's: the co-signature's `note_signoffs` row
  with `note.cosigned`, an attestation's `note_attestations` row with `note.attested` (5.4) and an
  assignment's `note_assignments` row with `note.assigned` (5.5), each failing when the event is
  written after the act commits (`encounters-acts-audit.test.ts`, review finding PA-2).

### 5.4 The queues, and attest

- `GET /v1/team/cosign-queue`: visits with a Medical note that is `completed`, oldest first. Each
  row is one visit: the encounter ID, the patient (ID and preferred name, as the reader's
  projection allows), when it started, and its waiting notes (ID, note type, author, when it was
  completed, and who signed it before if it came back after a correction).
- `GET /v1/team/attestation-queue`: visits with a note whose `attestation` is `waiting`, the
  same row shape.
- A waiting note that holds an answer the caller may not see (6.4) is listed with
  `canAct: false`, so the queue can say why the person cannot sign it.
- Both are audited as queue views that name the patients shown in `details.patientIds` (D53):
  `cosign_queue.viewed`, `attestation_queue.viewed`.
- `POST /v1/encounters/{encounterId}/attest`: the same body as 5.3. Each note is checked by
  `attestEffect`: it is `signed` with `attestation = 'waiting'`, else `409 not_waiting`; the
  caller does not act as its author and is not the signer of its current signature, else `403`; the credential can attest; the caller sees
  every answer that counts; the hash matches, else `409 content_changed`. All or nothing, as in
  5.3. Then for each note a `note_attestations` row and `attestation = 'attested'`. Audit: one
  `note.attested` per note. Notice to each signer: `note_attested`, one per visit.

As built (unit L2, with its review; `queues.ts`, `attest.ts`):

- **The queues** (`getCosignQueue`, `getAttestationQueue`) need `encounters.chart`, then a
  credential that signs or attests, else 403 `cannot_sign` or `cannot_attest`, logged as
  `access.denied` with `{ reason, route }`. Each answers `{ rows }`, one row per visit, oldest
  first by its start and then its ID: `{ encounterId, patientId, preferredName, startedAt,
  notes }`, each note `{ noteId, noteTypeKey, author, completedAt, signedBefore, attestedBefore,
  canAct }`. `preferredName` is the canonical chart's, so a merged patient shows the chart they
  were merged into, and is null without `patients.view`. `author` is the note's writer, by their
  name now. `signedBefore` is whoever made the latest signature other than the current one, and
  `attestedBefore` whoever attested it last, each by the name stored with the act, or null. The
  queues are not paged.
- **What is listed.** A note the caller may not read at all, or whose definition the server
  cannot read, is absent, as on the timeline (6.4 rule 2), and so is a visit left with none, so a
  role that charts without `patients.view` gets empty queues. `canAct` is the act's own rule asked
  as if the hash matched, so the queue and the act never disagree: it is false for a note with an
  answer the caller may not see, one they act as the author of, wrote or completed, and, in the
  attestation queue, one whose current signature is theirs.
- **The audit**: `cosign_queue.viewed` and `attestation_queue.viewed` name no patient in the
  row's own column and list the patients shown in `details.patientIds`, with `resultCount` (D53;
  10.1).
- **As built for the portal (unit L6)**: each queue note also has its type's `title`; `canAct` and
  the act are `second-person.ts`'s, the same rule the visit read's `canCosign` and `canAttest` ask
  (5.1), and a row's `preferredName` is `preferredNames`'s. A note listed with `canAct` false has
  the visit read's `heldBecause` (5.1), by the same rule, so the queue says why the person cannot
  sign it in the visit page's words (the coordinator's decision on the review of unit L6). It adds
  no inference D97 does not already accept: such a reader can tell from a note they did not write
  being listed as not theirs that it holds something they may not see.
- **Attest** (`attestEncounter`) takes co-sign's body and gives its answer, and runs as 5.3's
  as-built notes say: the caller read again under the team lock; a note of another visit, or one
  the caller may not read, answered `not_waiting`; a waiting note left out `content_changed`; the
  first refusal in the rule's order (`not_waiting`, `is_author`, `is_signer`, `cannot_attest`,
  `cannot_see_all`, `content_changed`) answered, and a refusal about the caller logged; the
  statement's version recorded, not checked; no wait for the Red flags note (3.5).
- **What an attestation writes**, for each note: a `note_attestations` row naming the note's
  current signature (`signoff_id`), never a later sign-off that signed nothing nor a student's
  saved unsigned before a co-signature, which the database's key cannot tell apart (2.4); the
  attending's name, NPI and fields as held once the lock is theirs; the server's time; the hash
  sent. Only the note's `attestation` changes, to `attested`, with no field version, since it is
  not a field: a phone learns of it through the notice and the visit read (4.10). One
  `note.attested` per note, `{ attestationId, signoffId }`; one `note_attested` notice to whoever
  made each note's current signature, on entity `encounter` and the visit, once for the visit. A
  note attested, corrected and waiting again is attested again: a second row, the first kept.

### 5.5 Assign a note

Body: `{ toUserId, reason }` (3 to 500 characters). Like every `team.manage_users` route it
needs a recent sign-in (`services/api/src/routes/members.ts:157`). Checked by `mayAssign` (3.12): the note's
acting author is not an active member, else `409 author_active`; the assignee is an active
member with `encounters.chart`; the assignee's credential rank is at least the rank the note was
signed under, or for an unsigned note the author's last credential, else `422
credential_too_low`; the note hides no answer from the assignee (6.4), asked by what the person
assigning may see (below), else `422 cannot_see_all`. Then a `note_assignments` row and
`assigned_user_id`.
Audit: `note.assigned`. Notice to the assignee: `note_assigned`.

As built (unit L2, with its review; `services/api/src/encounters/assign.ts`, `assignNote`):

- **The body** is `AssignInput`, strict; the answer `NoteAssigned`, `{ assignmentId, noteId,
  fromUserId, toUserId }`. The key is asked first, then the recent sign-in: without one, 403
  `reauth_required`, not logged (10.1).
- **Under the team lock** the note is loaded for update; one the team does not have, or the
  caller may not read (`noteAsRead`), is 404, as the assignees route answers, so the act and its
  picker agree on the note and no answer tells the state of one the caller may not read (6.4 rule
  5; review finding PAC-3).
- **What `mayAssign` is given**: whether whoever acts as the author is an active member; whether
  the assignee is one and holds `encounters.chart`; the rank needed, from the credential the
  note's current signature was recorded under, else from its writer's credential on their
  membership, which is kept when they are removed, else, for a writer with no membership, the
  highest rank; and whether the note hides something from the assignee, asked of their role as
  if they were not the author (`hidesFrom`): true when the role may not read a Medical visit's
  summary or a note of the type, and when the definition cannot be read; otherwise asked path by
  path of the definition, with the caller's read of the note (`noteAsRead`), by what the caller
  may see there (the coordinator's decision of Nov 20, narrowing D116):
  - where the caller's keys could miss what a path holds too, true when a note of its type could
    hold there an answer the assignee's role could not see (`mayHoldHidden`, asked of both: a
    sensitive exam's section or marked option, a treatment record, a section with a diagnosis),
    whatever the note holds, as a hold is decided (D88). The picker's list is read with every
    visit page, and one that left out whoever could not see a treatment record the note holds
    would tell a Program Admin who reads none that the note holds one (review finding PRD-1, the
    coordinator's decision of Nov 19);
  - elsewhere, true when the note holds an answer that counts that the role could not see
    (`seenBy`, the read rule, against `effectiveAnswers`): the caller reads every such answer on
    the visit page, so leaving someone out for it tells them nothing new. An answer the assignee
    could not see lies where `mayHoldHidden` marks for them, as a hold relies on, so where it
    marks for the caller too the first rule has answered already, whatever the note holds.

  A phase 2 note with no version hides nothing. A note no active member qualifies for stays in
  Notes not complete (PLAN-OPEN 12.1 #31).
- **Refusals**: 409 `author_active`; 422 `assignee_not_member`, `assignee_cannot_chart`,
  `credential_too_low` and `cannot_see_all`, each a person the picker should not have offered.
  None writes anything, and none is logged (10.1). A note whose assignee is active is theirs, so
  assigning it again is `author_active`; one whose assignee has left is assigned again.
- **What it writes**: a `note_assignments` row with the reason; the note's `assigned_user_id`;
  one `note.assigned` on the note, with the visit's patient, `{ fromUserId, toUserId }`, never
  the reason; and a `note_assigned` notice to the assignee, on entity `encounter_note` and the
  note.

As built for the portal's picker (unit L6, 9.12): **`GET /v1/notes/{noteId}/assignees`**
(`noteAssignees`, `assign.ts`) answers `NoteAssignees`, `{ assignees: [{ userId, displayName,
credential }] }`, every active member, by name, for whom `mayAssign` allows the note, asked through
the function the assign route asks (`assignDecision`), so the picker lists exactly the people the
route takes and holds no copy of the credential ranks. Whether the note hides something from each is
`hidesFrom`'s, asked with the caller's read of the note (above), so the list tells the caller
nothing of what they may not read in it. Two callers may be given different lists for one note, and
that is intended: a Program Admin, who reads sensitive exams, is offered a Healthcare Staff
attending for a General / primary care note with no GU exam in it, while a manager whose role reads
none is not, since to them whom the list leaves out would say whether the note holds one. It needs
`team.manage_users` and no recent sign-in: it is a read, as the list of members and the team's
incomplete notes are, and the assignment asks for one (the coordinator's decision of Nov 19). A note
the team does not have, or the caller may not read (`noteAsRead`, as the visit read leaves one out),
is 404, as the act answers since the review; a note whose acting author is an active member is 409
`author_active`, as the act answers, so the page offers Assign only where the list answers 200.
Neither was logged as first built; since the phase's review a note the caller may not read is
(below), and the others are not (10.1). The list is logged as one `note.assignees_viewed` on entity
`encounter_note` and the note, with the visit's patient, `{ resultCount }`, no name. The visit page
asks it of every note it shows, for a person with `team.manage_users` (9.12 as built; the
coordinator's decision).

As built since the phase's review (findings PA-3 and VA-2, and D98 as amended): once the team lock
is theirs, assign reads the caller again, as co-sign and attest do (`callerNow`, from `cosign.ts`).
One no longer an active member is refused 403 `not_a_member`, and one whose role lost
`team.manage_users` is refused 403 `forbidden`, each logged as `access.denied` in the request's
transaction (the second with the permission it lacks); the note is read, and the assignment asked,
by who they are then, so a role that lost `patients.view` meanwhile is answered 404. A note the
caller may not read, asked of the act or of the assignees route, is still 404, and is now logged as
`access.denied` `cannot_read` on the note, with its patient; a note the team does not have is not.
`assignNote` and `noteAssignees` return such a refusal from the transaction and throw it after, so
the logged refusal commits (10.1).

### 5.6 Notes that are not complete

- `GET /v1/me/notes-to-finish`: draft notes the caller acts as the author of. Each row: note and
  encounter IDs, patient ID, note type, `startedAt`, `overdue` (3.9). The phone merges it with
  the drafts it holds (9.9).
- `GET /v1/team/incomplete-notes?author=<userId>`: every draft note of the team, with its author,
  whether the author is still a member, and `overdue`. The `author` filter is for phase 7's route
  lead and post-run report.
- Neither lists an empty draft (3.1).
- Audit: `notes_to_finish.viewed`, `incomplete_notes.viewed`, with `details.patientIds`.
- `GET /v1/me/counts` gives the numbers Home shows: the caller's notes to finish and how many are
  overdue; the visits waiting for their co-signature or attestation; for `team.manage_users`,
  the team's incomplete notes. It returns numbers and names no patient, so it logs no patient.
  The list routes log every patient they show; a count built on them would put a view in each
  patient's access report every time someone opened Home.

As built (unit L2, with its review; `incomplete.ts`, `counts.ts`):

- **Notes to finish** (`getNotesToFinish`) answers `{ notes }`, each `{ noteId, encounterId,
  patientId, noteTypeKey, startedAt, overdue }`: the drafts the caller acts as the author of, an
  assigned one included. **The team's list** (`getIncompleteNotes`) adds `author`, whoever acts as
  the author (the assignee when there is one), and `authorActive`; its `author` filter is on the
  acting author, by ID, and one that is not an ID is 422. It needs no recent sign-in: it is a
  read, as the list of members is (kept as built).
- **Both** list the server's drafts, oldest visit first, as `draftsAsRead` reads them: an empty
  draft, a note the caller may not read, a phase 2 note with no version and a note whose
  definition the server cannot read are left out, as on the timeline (6.4 rule 2). `overdue` is
  `isOverdue`, worked out when read; for a visit whose start was not verified it counts from the
  visit row's `created_at`, when the server received it (kept as built).
- **The audit**: `notes_to_finish.viewed` and `incomplete_notes.viewed` name no patient in the
  row's own column and list the patients shown in `details.patientIds`, with `resultCount`, and
  the team's list the `author` filter's ID when there is one (10.1).
- **The counts** (`getHomeCounts`) answer `{ notesToFinish?, notesOverdue?, cosignWaiting?,
  attestationWaiting?, teamIncomplete?, teamOverdue? }`. Any member may ask, and a number for a list the caller
  may not open is absent: the first two need `encounters.chart`, `cosignWaiting` that and a
  credential that signs, `attestationWaiting` that and one that attests, `teamIncomplete`
  `team.manage_users`. Each is the length of its list, built by the list's own function: the
  drafts by `draftsAsRead`, the queues by `queueRows`, the rows a queue shows the caller, read
  without its audit event, so a number can never drift from its list (the coordinator's decision
  after the review). A queue's number counts every visit the queue shows, those whose notes all
  have `canAct` false included, and the counts write no audit event (both kept as built).
- **As built for the portal (unit L6)**: `teamOverdue`, beside `teamIncomplete` and under the same
  key, counts the team's drafts the list marks `overdue`, so Home's "4 notes not complete. 2 are
  older than a day." (9.12) never disagrees with the list. Each row of the team's list also has its
  type's `title` and the patient's `preferredName` (`preferredNames`: none without
  `patients.view`); the caller's own notes to finish name no patient, as before.

### 5.7 The EMS handoff

"Sineobex builds a handoff summary from the encounter. It is shown full-screen for the medic and
can be exported as a PDF; both are audit-logged. There is no copy-to-clipboard or share-sheet
option" (PRD main 413). The phone shows the summary full-screen, offline, built by the forms
part's `handoffLines` (9.8). The PDF comes from the portal: this route returns
`application/pdf`, built on the server from the same lines. A PDF made on the phone would have
to leave through a share sheet, which the PRD rules out (PLAN-OPEN 12.1 #12). On the server and
on the phone, each note goes through `visibleAnswers` for the reader before `handoffLines`
reads it, so a handoff never shows a reader a note they may not open.

A file leaves our control, so the PRD's rule for desktop exports applies (PRD main 602):

- The route needs a recent sign-in. Without one it answers `reauth_required`, and the portal
  sends the person through its existing `/reauth` page.
- Every page is stamped with who exported it and when.
- The answer is sent with `Cache-Control: no-store`, and the file's name holds no patient
  details.
- Audit: `ems_handoff.exported`.

The PRD says two things about who may export: a clinician exports the handoff (PRD main 413),
and exports are for "Admin or Billing/Data only" (PRD main 602). Default: whoever may read the
Red flags note may export its handoff (PLAN-OPEN 12.1 #18).

As built (unit L2, with its review; `services/api/src/encounters/handoff.ts`, `getEmsHandoff`):

- **Who.** `patients.view`, then a recent sign-in: without one, 403 `reauth_required`, not
  logged, and the portal sends the person through `/reauth`. Then the reader must read the
  visit's Red flags note (the note whose type has `auto: 'medical'`), as `noteAsRead` reads it.
  One who may not is refused 403 `cannot_see_red_flags`, logged as `access.denied` on entity
  `encounter` and the visit, with its patient, `{ reason, route }`: the visit's kind already
  tells a reader of no Medical note that it has a Red flags note (kept as built; 12.1 #18).
- **When there is one.** A visit has a handoff when its Red flags note, as the reader reads it,
  shows its `show_handoff` action, which the form offers once EMS is activated (9.8). Otherwise,
  and for a visit with no Red flags note, 404 `no_handoff` (kept as built). A visit the team does
  not have is 404 `not_found`, and an ID that is not a UUID 422. None of these is logged.
- **The reader's time zone.** The portal may send `?timeZone=`, an IANA zone's name: letters,
  digits, `_`, `+` and `-`, in up to three parts (`TIME_ZONE_PATTERN`, which the contract
  carries), so the query string can carry nothing else, and a zone the runtime knows; anything
  else is 422, not logged. The file's times are printed in that zone and named with it; without
  one, in UTC, labelled UTC (PLAN-OPEN 12.1 #28).
- **What reaches EMS.** The notes in the order they were made, each through `visibleAnswers` for
  the reader (`noteAsRead`) and then for EMS (`EMS_READER`, a reader of Medical notes without
  `patients.view_sensitive` or `patients.view_sensitive_exams`), keeping only what both may see;
  then `handoffLines` reads them with phase 3's sensitive list. So no note of a sensitive type,
  nothing of a sensitive exam, no treatment record and no sensitive diagnosis reaches EMS,
  whoever exports the file (D82; the coordinator's decision on review finding LRD-4; PLAN-OPEN
  12.1 #29). An empty draft and a phase 2 note with no version are left out. A draft that holds
  something is in, and each note's title is marked with its state: draft, complete, signed, or
  signed and attested.
- **The file.** A4, in the standard Helvetica, which needs no font file, so it builds in every
  runtime the API runs in (`pdf-lib` 1.17.1, pure JavaScript, at an exact version); a character
  it has no glyph for is drawn as a question mark. It opens with "EMS handoff" and the patient,
  from their chart as the reader may see it (`loadChart`): their preferred name, their age in
  years ("Age 52"; "Age about 46" when the birth date is not exact; "Age not recorded"), and
  their allergies, severe first, as the phone's allergy badge words them, or "No known
  allergies", or "Allergies not asked yet"; never the legal name or the birth date (PLAN-OPEN
  12.1 #27). A visit with no patient says so. Then "Visit started", with "(phone clock, not
  verified)" when the start was not; the field lines under each note's title, then "Recap" with
  the recap lines under each note's title, or "Nothing to hand over." Every page's foot says
  "Exported by {name} on {time}" and "Page {n} of {N}". The metadata hold a fixed title, "EMS
  handoff", and the export's time.
- **Sent** as `application/pdf`, with `Content-Disposition: attachment;
  filename="ems-handoff.pdf"`, the same name for every visit, and `Cache-Control: no-store`.
- **The audit**: one `ems_handoff.exported` on entity `encounter` and the visit, with its
  patient, `{ noteIds, source }`: the notes the file holds, none of a sensitive type, and
  `portal`, or `phone` from a phone registered to the reader. No `note.viewed` per note, and the
  chart read for the header writes none: the export's event names the patient. The file is made
  inside the transaction, so an event is written only for a file that was made.
- **The phone never exports it.** The generated Dart client leaves out an operation whose success
  answer is not JSON, with a comment that names it, so no phone code decodes the PDF as JSON
  (review finding LPM-5).
- **When the page offers it** (unit L6): the visit read's `hasHandoff` is the export's own test
  (`showsHandoff`), asked of the reader (5.1). The end-to-end tests take the export through
  `/reauth` with a test hook of the local identity provider, on only where the portal's Playwright
  config sets `DEV_IDP_TEST_HOOKS=1`: `POST /test/stale-sign-in { email, minutes }` dates that
  person's next sign-in back (`tools/dev-idp.mjs`; `services/api/test/dev-idp-hooks.test.ts`).
- **The phone's full-screen summary follows the same rule** (decided Nov 18, D94). It is built for
  EMS's reader too, so it leaves out every note of a sensitive type and every sensitive exam's
  findings whoever shows it (9.8; card F7-handoff).

## 6. Permissions

No new key (D37, PRD main 202). Every check below is in the API. The phone hides what the person
cannot do, and that is a convenience, never the check.

### 6.1 Every action and its key

| Action | Key | Also needs |
|---|---|---|
| Start an encounter, add a note, save a draft | `encounters.chart` | A Medical note: a credential with `chartMedical` (4.2) |
| Complete or sign a note | `encounters.chart` | Acts as the author. A Medical note: `chartMedical`. Signing: what `signedUnder` finds |
| Reopen a note | `encounters.chart` | Acts as the author; `chartMedical` |
| Add an addendum | `encounters.chart` | |
| Correct a finished note; record an amendment request | `encounters.chart` | Acts as the author. A Medical note: `chartMedical` |
| Add a referral | `referrals.create` | |
| Mark a referral entered in error | `referrals.create` | Its author, or anyone with `encounters.chart` |
| Read a visit; see the timeline | `patients.view` | Each note by 6.4 |
| Co-sign | `encounters.chart` | A credential that signs; not the author; sees every answer that counts |
| Attest | `encounters.chart` | A credential that attests; not the author; sees every answer that counts |
| See the co-sign queue or the attestation queue | `encounters.chart` | The same credential as the act |
| Assign a note | `team.manage_users` | |
| See the team's incomplete notes | `team.manage_users` | |
| Export the EMS handoff | `patients.view` | Sees the Red flags note; a recent sign-in |

Two reads reach a note, and they ask for different keys on purpose. The sync read
(`/v1/sync/records`, `services/api/src/routes/sync.ts:73-85`) feeds editing, so it needs
`encounters.chart`, as today. The visit read (5.1) is the chart read, for anyone who may see
charts. Both pass every note through 6.4.

As built (unit L2, with its review):

- **Co-sign and attest.** "Not the author" leaves out whoever acts as the note's author now, its
  writer and whoever completed it; attest also leaves out whoever made the note's current
  signature. The caller's role and credential are read again once the team lock is theirs (5.3,
  5.4). Each queue needs its act's credential, and a credential refused is logged with its
  reason.
- **Two reads the table leaves out**: one's notes to finish need `encounters.chart`; Home's
  counts any member, each number only for a list the caller may open (5.6). The team's incomplete
  notes need no recent sign-in.
- **The visit read** also gives the records made at the visit, as the chart shows them to the
  reader: a problem and its notes need the problem list's keys (5.1).
- **Assign** and **the EMS handoff** ask for their key first, then the recent sign-in. The
  handoff asks whether the reader may read the Red flags note as the visit read asks it, and
  refuses one who may not with `cannot_see_red_flags`, logged (5.7).
- **Who may be assigned a note** (unit L6), the list the portal's picker shows, needs
  `team.manage_users` and no recent sign-in: it is a read, and the assignment asks for one (5.5).

### 6.2 What the phone offers, by credential

| Credential | Note types offered | Complete on a Medical note |
|---|---|---|
| attending, resident, NP, PA | every type the encounter's kind allows | Complete and sign |
| student | the same | Complete and send for co-signature |
| CHW, none | Non-Medical note types only, in any encounter | never a Medical note |

A credential that cannot chart Medical is not asked "Medical or Non-Medical": its encounters
start Non-Medical. It can still add a Social needs note to a Medical encounter a teammate
started. The phone reads the credential it saved from `/v1/me` (1.3). The server's answer wins
when they differ (3.5, 4.2).

### 6.3 The standard roles

| Role | Charts | Refers | Reads Medical notes | Sensitive note types | Sensitive exams |
|---|---|---|---|---|---|
| Program Admin | Yes | Yes | Yes | Yes | Yes |
| Logistics | Yes | Yes | Yes | Yes, but not treatment records without a clinical credential | No |
| Healthcare Staff | Yes | Yes | Yes | Yes, the same | No |
| Billing/Data | No | No | Yes | No | No |
| CHW preset | No | Yes | No | No | No |

From `db/migrations/0002_identity_access.sql:86-97` and
`services/api/src/auth/permissions.ts:80-91`. Phase 4 changes no role.

### 6.4 Who may read what in a note

Existing keys only. The forms part marks each kind of content in the definitions, and one
function, `visibleAnswers(definition, answers, reader)`, applies all of it.

| Content | Marked in the definition as | Who reads it, besides whoever acts as the note's author |
|---|---|---|
| A Medical note, any of it | the note type is offered for Medical only | `patients.view` with `encounters.chart` or `billing.view_codes`. This is the rule D37 set for the problem list: the CHW preset is "no clinical notes" (PRD main 204). |
| Behavioral health, harm reduction and sexual and reproductive note types (PRD main 435, 121) | the note type: `sensitivity: 'sensitive'` | `patients.view_sensitive` |
| Substance use treatment (the MOUD part of Harm reduction) | the section: `treatmentRecord: true` | `patients.view_sensitive` and a credential with `chartMedical`. "Substance use treatment records stay excluded until counsel decides" (PRD main 145): Logistics holds the key but, without a clinical credential, does not see these. |
| GU, breast and rectal exam sections (PRD main 415) | the section: `sensitiveExam: true` | `patients.view_sensitive_exams` |
| A diagnosis whose code is on phase 3's sensitive list, picked in any note | the answer of a `problem` field | `patients.view_sensitive`, as on the problem list (`services/api/src/sync/review.ts:291-298`) |

Rules:

1. **Whoever acts as a note's author sees all of it**, whatever their role. A clinician who
   performs a GU exam must be able to read what they wrote, record consent and sign. Of the
   standard roles only Program Admin holds `patients.view_sensitive_exams`, so without this rule
   nobody in the field could chart one (PLAN-OPEN 12.1 #13).
2. Everyone else gets a note through `visibleAnswers`. Content the reader may not see is absent
   from every answer: the visit read (5.1), the timeline and the recent visits (5.2), the sync
   read, the queues and the EMS handoff (5.7). The same goes for everything that hangs off a
   note: the read model, a correction's old and new values, an addendum to a note the reader may
   not see. In the sync read the answers' versions and history marks go with them:
   the snapshot lists a key for every answer (`services/api/src/sync/records.ts:176-190`), and a
   hidden answer leaves no key behind.
3. Sensitive exams "never show on the patient overview" (PRD main 415): the timeline and the
   recap of a visit list no finding from a sensitive exam section, for any reader.
4. **Co-signing and attesting need the whole note.** A reader who does not see every answer
   that counts gets no `contentHash` and cannot co-sign or attest: an attestation of a note one
   can't read in full would be untrue. Of the standard roles only Program Admin sees sensitive
   exams, so a team whose attendings attest notes with a GU, breast or rectal exam gives them a
   custom role that holds `patients.view_sensitive_exams`. Until it does, such a note waits, and
   the queue says why (5.4). This follows the PRD's words ("need an extra permission to view")
   and can stall attestation, so it is the first thing to ask the clinical team (PLAN-OPEN
   12.1 #13).
5. A `set` of an answer the sender may not see is held for a Program Admin (4.4). The same holds
   for a section that needs a capability the sender's credential lacks: the Quick encounter's
   Medication section "needs an ordering credential" (PRD main 409), marked
   `needs: 'orderMedications'` in the definition.
6. The phone applies the same function before it shows a note, so a teammate's draft opened to
   help shows what the server would show.
7. **The new records in the sync read.** `/v1/sync/records` gives a record of an entity it has
   no rule for to anyone with `patients.view` (`services/api/src/routes/sync.ts:73-85`). The
   four new entities get their own rule: a sign-off, an addendum and a correction are read by
   whoever may read their note, and a correction's values only by whoever may read the answers
   it changes; a referral by `patients.view`.
8. **The exam picker.** Its answer names the systems examined. The options for GU, breast and
   rectal are marked `sensitiveExam` in the definition: `visibleAnswers` drops those codes for a
   reader without the key, and `recapLines` drops them for everyone, so nobody learns from the
   overview that the exam was done (PRD main 415).

**`visibleAnswers` as built** (unit F1; forms 7.1):

- **It returns a subset of `effectiveAnswers`**, worked out on the whole note and kept in its
  order, or null for a note the reader may not see at all: a note type offered for Medical only,
  to a reader who does not read Medical notes; a sensitive note type, to a reader without
  `patients.view_sensitive`. Whoever acts as the author gets every answer that counts (rule 1),
  and no reader gets an answer that does not count. The author's own sync read of a draft does
  not go through it (4.4).
- **`sensitiveCodes` is phase 3's list of ranges** `{ from, to }`, the only form the sensitive
  list exists in: `SENSITIVE_CODE_RANGES` in
  `services/api/src/patients/generated/sensitive-codes.ts` on the server, `sensitiveCodeRanges`
  in `apps/mobile/lib/patients/generated/sensitive_codes.dart` on the phone. A code is sensitive
  by phase 3's rule (`isSensitiveCode`). Only the code decides, as on the problem list: a
  diagnosis with a label and no code is not sensitive.
- **A sensitive diagnosis takes its entry or its section with it.** Without
  `patients.view_sensitive` the reader gets nothing of the entry that holds the diagnosis, its
  `entryAt` included, or, outside a repeating section, of the whole section: a status or
  interventions with no diagnosis beside them would hint at one (rule 2). The forms part's
  validator keeps a condition elsewhere from reading such a section (forms 2.2).
- **A sensitive exam leaves nothing** for a reader without `patients.view_sensitive_exams`: not
  its sections, nor a picker code marked `sensitiveExam` (an answer left with no code goes too),
  nor any answer in a grid row whose option is marked, nor a region whose region is marked, with
  its side and surface, nor the Other text of a field whose picked Other option is marked. An
  entry that held answers and has none left once these are out goes whole, `entryAt` and all, so
  the entries after it are numbered as if it had never been there. `recapLines` and the
  handoff's field lines leave out the same for every reader (rules 3 and 8; 5.7).
- **`ordersMedications` changes nothing here**: a `needs` section is shown to every reader, and
  rule 5 decides who may change it.

**The sync rules, as built** (unit L1, with wave D's review):

- **Rule 7, the new records in the sync read.** `/v1/sync/records` needs `encounters.chart` for a
  sign-off, an addendum and a correction, as for a visit and a note, and `patients.view` for a
  referral (`services/api/src/routes/sync.ts`). Then `fetchRecords` reads record by record: a
  sign-off is there when its note is, its `contentHash` as 5.1 says; an addendum is there when its
  note is, or, naming no note, with its visit (a Medical one's needs what reads its notes, 5.1); a
  correction is there when its note is and no change it holds is hidden from the reader in its old
  value or its new, so its values go only to whoever may read every answer it changes, and a
  correction is missing rather than stripped, since its field alone names the hidden answer; a
  referral is read whole. A note names who acts as its author, a sign-off its signer and a
  correction its corrector (D108; 4.4, 4.6, 4.7), so a name goes only with a record the reader is
  shown. Each record returned is logged: `encounter.viewed` for a visit,
  `note.viewed` for a note and for a sign-off, an addendum or a correction, `patient.viewed` for a
  referral (10.1).
- **Rule 2 in the sync read** is 5.1's note: a note the reader may not read, or whose definition
  cannot be read, is missing; a hidden answer leaves no value, version or mark; a note's version
  and time follow what it shows.
- **Rule 2 for a retry, and for every value sent back**: a change answered again from its receipt
  sends the field as the sender may see it now (4.4). What a conflict, a value kept both or in
  history, and a retry carry follows the sync read's rules, all of them, from one copy
  (`services/api/src/sync/read-rules.ts`: `readNeed`, `readsEntity`, `readsRecord`,
  `sensitiveHidden`), which `requireRead`, `fetchRecords`' `asRead`, the review queue's
  `shownChange` and `apply.ts`'s `fieldForAnswer` all call, so they cannot drift (D99; review
  finding VA-1, as the coordinator decided): first the record (`patients.view` for a patient-side
  record and a referral, `encounters.chart` for a visit and what hangs off its notes,
  `mayViewProblems` for a problem and its notes, `patients.view_sensitive` for a sensitive one),
  then the note rule (`fieldForSender`) and the Medical summary rule. A field the sender may not
  see goes as one that holds nothing (`NOTHING_SHOWN`), and no read is logged for it (`logSentBack`);
  a conflict on it is held instead (4.4). So a retry from someone whose role lost `patients.view`
  since the first answer, or an answer on a sensitive problem to a role without
  `patients.view_sensitive`, carries nothing of it.
- **Rule 2 in the review queue.** A held change's value goes only to a reviewer who may read it,
  by the sync read's rules (`shownChange`, `review.ts`; review finding RD-3, as the coordinator
  decided): a visit's records need `encounters.chart`, and a Medical visit's `summary` and its own
  addenda (naming no note) what reads its notes, as in the sync read (5.1; review finding RD-7): a
  visit not on the chart, its create still held, counts as Medical; a note's change, a note the
  reviewer may read, and every answer it sends or would replace one they may see; a held note create, a type
  they may read with none of its answers hidden; a held sign-off goes without its hash to a
  reviewer who does not see every answer of any note; a problem and its notes need the problem
  list's keys, and a sensitive one, or one whose create is still held, `patients.view_sensitive`;
  everything else `patients.view`. An item the reviewer may not read is listed with `field` and
  `value` null and `hidden: true` (`QuarantineItem` in the contract), and opening the queue still
  logs it with its patient. Only a reviewer who may read a held change accepts it, by the same
  rules (`decideQuarantine`; RD-3, as the coordinator decided): anyone else's accept is refused
  with 403 `change_hidden`, logged as `access.denied`, and nothing is applied; they may reject it
  or leave it for someone who can read it. A change of a record whose create is itself held reads
  as hidden until that record is decided, so its accept answers `waiting_on_record` first. The
  portal's queue page shows such an item as held, with nothing of what it holds, and offers
  Reject alone (`apps/portal/src/lib/quarantine.ts`, `apps/portal/e2e/phones.spec.ts`). So a
  Program Admin whose credential charts nothing reads no treatment record, and cannot accept a
  held change to one: a teammate with a clinical credential and the queue's key does.
- **Rule 4** is the sign-off hash rule of 5.1.
- **Rules 2, 3 and 8 in the visit read's recap** (D108): a note's `recap` is `recapLines` over the
  answers `visibleAnswers` keeps for the reader, the read model's own, so nothing the reader may
  not see is in a line, and nothing from a sensitive exam is in one for anyone (5.1).
- **Rule 5 as built.** Held for a Program Admin, with no `server` value: a set of an answer that
  could hold something the sender may not see, read from the definition and their keys alone, never
  from what the note holds (4.4; review finding RD-10); any change
  of a note the sender may not read at all, a set, a sign-off, a correction or an addendum, so
  that no answer tells its state, who finished it, or whether a guess of it matches (review
  finding RD-11); an answer of a `needs` section from a credential that does not order
  medications, whoever acts as the author (4.2). The reader for each is the sender's role and
  their credential now.

**For the portal, as built** (unit L6, with its review):

- **Rule 4, said as well as applied.** The visit read marks the notes the reader may co-sign or
  attest (`canCosign`, `canAttest`) and says why a waiting note waits for someone else
  (`heldBecause`), and each queue note gives the same reason (5.1, 5.4). In the rule's order a
  refusal about the credential comes before `cannot_see_all`, so "This note has a part you can’t
  open" reaches only a reader whose credential may do the act: D97 already tells them as much by
  the missing hash, and the queue by listing a note they did not write as not theirs (the
  coordinator's decision on the review of unit L6).
- **Who may be assigned a note** is decided by what the person assigning may see of it, for the
  picker's list and the assign route's `cannot_see_all` alike, so neither tells them anything of
  the note they may not read (5.5; review finding PRD-1, the coordinator's decision of Nov 20).
  Where their keys could miss what a path of the definition holds, it is decided as rule 5 decides
  a hold (D88): from the note's type and the assignee's keys, by `mayHoldHidden` asked of both,
  whatever the note holds. Elsewhere it is decided by what the note holds: an answer that counts
  the assignee's role could not see keeps the note from them, and the person assigning reads that
  answer on the page. So two people assigning may be offered different people for one note. The
  cost of the type rule, a note of a type that could hold a sensitive exam offered only to someone
  whose role reads them (among the standard roles a Program Admin), is left only where the person
  assigning reads none either, such as a manager without the key; a Program Admin, who reads them,
  is offered any clinician with the credential it needs for a General / primary care note with no
  GU, breast or rectal exam in it (PLAN-OPEN 12.1 #31).
- **The pages hold no read rule.** Each shows what the API answered for the reader, and the
  team's list of notes not complete names no patient to a reader without `patients.view` (5.6).

## 7. Referrals in this phase

"Tapping Referral shows the patient's past referrals and Add referral; a referral records only a
date and free-text details" (PRD main 113, 507). Status, the completion prompt and completion
reporting are V2.

- **Where.** The patient profile's **+ Referral** quick action (PRD main 721) opens the
  Referrals sheet (9.10). The summary screen of an encounter has **Add referral** too (PRD main
  384); a referral made there carries the encounter's ID.
- **Who.** `referrals.create`. The CHW preset holds it and holds no `encounters.chart`
  (`services/api/src/auth/permissions.ts:80-91`), so a referral never needs an encounter.
- **Offline.** A referral is a patient-side record (4.7, 4.8). It is made offline, joins the
  patient's local work, and shows in the list at once with "Waiting to send".
- **The list** is part of the chart: the chart answer carries the group's referrals (5.2), newest
  first by `referredOn`. Each row shows the date, the details, who recorded it, and "at a visit"
  when it has an encounter.
- **A mistake** is marked entered in error with a reason, by the person who recorded it or by
  anyone who charts (4.7). It stays in the list, struck through. Nothing is deleted.
- **The portal** shows the same list on the patient page, read-only in phase 4.

As built on the phone (the domain layer, unit L4, `apps/mobile/lib/encounters/referrals.dart`, with
its review):

- **The list** (`Referrals.openReferrals`, the sheet) is what the phone holds for the merged group,
  and the chart's own snapshots (5.2 as built) it does not hold, of the group only (review finding
  LRA-5): newest first by date, then by when recorded. Each referral shown is logged as
  `patient.viewed` on entity `referral`, in the read's transaction, once (the coordinator's
  decision), as the sync read and the visit read log one. The profile's timeline lists the same
  referrals and logs none of its own (9.1 as built). `madeAt` lists the referrals made at a visit,
  whoever's chart they are on, those of the charts the phone keeps included (9.7).
- **Add referral** refuses, writing nothing: a role without `referrals.create`, which the server
  would hold for a Program Admin; details empty or over 2,000 characters once trimmed; a date that
  isn't real, or is more than a day ahead (the store's rule, by the corrected date); and a visit the
  phone holds of someone outside the patient's merged group (`encounter_other_patient`, 4.7, 8.4),
  a visit with no patient passing. The date is the calendar day the person picked. A referral never
  waits for the clock (3.11).
- **Entered in error** takes `referrals.create`, and the referral's author or anyone who charts
  (4.7), once, with a reason of 3 to 300 characters. A referral the chart lists and the phone does
  not hold is taken onto the phone in the same transaction, so it can be marked offline.
- **"At a visit"** shows while the visit is the chart's group's as far as the phone knows (8.4 as
  built). Who recorded a referral is named by the phone's name hook, or, for one of the reader's
  own, by their display name (D108).
- **The sentences are this layer's**, the design giving none: "Your role can’t make referrals.",
  "Only the person who recorded this referral, or a clinician, can mark it entered in error.",
  "Write the referral’s details, up to 2,000 characters.", "Choose a real date.", "A referral can’t
  be dated in the future.", "That visit is someone else’s. Add the referral from their chart, or
  without the visit.", "This referral is already marked entered in error." and "Give a short reason
  (3 to 300 characters).".
- **Since the phase's review** (findings PS-3 and PX-3, the coordinator's decisions). A referral
  never waits for the clock, so while the phone's clock has no reference Add referral takes no
  date past the phone's own day (its local day, or the UTC day where that is later), the day ahead
  being for a clock the phone has checked; a referral the server refuses `referral_in_future`
  gets **Change the date** in Needs attention, which sends its create again on the date chosen
  (4.7 as built, 9.13). The date is typed in three private boxes, with the calendar alone beside
  them, in the Referrals sheet and in Change the date (9.10, D92).

As built on the portal (unit L6, `Timeline.tsx` on the patient page, 9.11 as built): the chart's
referrals, read-only, newest first by their date and then by when they were recorded, each with
its date and details, "Recorded by {name}", from the snapshot's `attributes.authorName`, their
display name now (5.2 as built; "A teammate" without one), and "At the visit on {date}", a link
to it, when the timeline lists that visit (8.4). One entered in error is struck through, with
"Entered in error: {reason}".

## 8. The recap, the chart after Complete, and the problem list

### 8.1 The automatic recap

"A recap per module, an automatic recap of what was tapped in each module (no AI in V1) above a
free-text assessment" (PRD main 433). "Each collapses to a one-line summary" (PRD main 392).

- The recap is worked out, never stored (2.6). The forms part supplies one pure function,
  `recapLines(definition, answers)`, in Dart and in TypeScript. It returns one short line per
  section that has an answer, built from the labels of the options tapped.
- The phone shows it in three places: the collapsed header of a section (9.5), the summary
  screen (9.6) and the visit read view (9.7). The portal shows it on the visit page (9.11).
- It is built from the note type version the note was written on, so an old note reads as it did.
- It lists nothing from a sensitive exam section (6.4, rule 3).

### 8.2 After Complete

"After Complete, the app opens the patient's chart" (PRD main 101).

- The app replaces the encounter screens with the patient profile. A visit with no patient
  (3.10) returns to Home.
- The profile's timeline shows the visit at the top. Until its sign-offs are confirmed it says
  "Waiting to send". The timeline is the chart's `timeline` (5.2) merged with the encounters the
  phone holds and the server has not confirmed yet.
- **When a finished note leaves the phone.** The domain layer calls the store's `closeRecord`
  for a note once its sign-off is confirmed, and for the encounter once every one of the
  person's notes on it is closed. It does this as a sweep, at start and after every sync, over
  every finished note with nothing waiting, so a note is still closed if the app was killed
  between the receipt and the sweep. The purge then removes what is confirmed
  (`apps/mobile/lib/sync/local_store.dart:1895-1922`). Data still leaves the phone only after a
  hash-confirmed receipt: nothing here touches the purge. A note whose sign-off is held for review
  is not closed (`sentForReview`, 4.8): kept open, the refresh settles an admin's accept, and the
  notice of a reject finds the note to complete again. A Medical visit's finished notes stay while
  a note of it stays a draft on the phone: Complete's hard stop 5 and the note types list read the
  visit's finished Red flags note from the phone (forms 6.2), and offline nothing else says it is
  there (review LCM-2). Online, the visit read says so, and the screen passes it to `addNote` and
  `openComplete` as `redFlagsFinished`.
- **A draft nobody has touched for 7 days** is closed the same way, if nothing of it waits in
  the outbox (3.2). It stays on the server and opens again online.
- **Reading a visit that has left the phone.** The last three visits of a chart the phone holds
  are read offline, from the chart's `recentVisits` (5.2). An older visit is asked from the
  server (5.1) and shown from memory; offline it says "This visit isn't on this phone. Connect
  to open it." Adding an addendum or a correction to a visit that is not on the phone needs a
  connection first: the phone fetches the notes it will change through the sync read.

As built on the phone (the domain layer, unit L4, `apps/mobile/lib/encounters/close_sweep.dart` and
`encounter_services.dart`, with its review):

- **The sweep** (`CloseSweep`) is a refresher, each sweep one store transaction, and does nothing
  while the store is frozen. It closes a finished note once its sign-off is settled (no
  `localEffect`) and nothing about it waits in the outbox, to send, refused or in conflict: a
  change to it, or a sign-off, an addendum or a correction naming it (`parentsOf`). It closes a
  draft, a teammate's opened to help included (one a killed app left open), and a visit with no
  note, once nobody has changed it for 7 days and nothing of it waits (12.1 #4); and a visit once
  every note of it on the phone is closed and nothing about it waits. It leaves open a note sent
  for review, and what a screen shows (`showing`, which the screens add to and take from; a
  visit's notes with it). In a Medical visit it keeps every finished note while a note of that
  visit stays a draft on the phone (above; review finding LCM-2): with no definitions, it cannot
  tell which is the Red flags note. A Non-Medical visit's finished note goes.
- **How it counts the 7 days.** The store keeps no time of a record's last change, so the sweep
  keeps its own, in the store's key-value table (`encounters.close_sweep.seen`): for each open draft
  and visit a fingerprint, a hash of its status and of each field's version and waiting change,
  never a value, and when a sweep first saw it so. A change of the person's own and a teammate's
  brought in by a refresh both change it. The 7 days run from the first sweep that sees a record as
  it is now, so the first sweep after an update gives every draft 7 more days, which only keeps it
  longer; should its own record not read, every record is counted from now. Only a verified clock
  counts (review finding LCM-6): the sweep takes the clock check's corrected time, none while the
  check has no reference (a phone restarted offline, whose own clock could be days off); then
  nothing is released for its age, no time is recorded and what was seen before is kept, while
  finished notes still close.
- **The services** (`EncounterServices`) are made once for each team database the app opens, by
  the sync controller's refresher factory (`appRefreshers`, `apps/mobile/lib/app_providers.dart`),
  beside phase 3's patient services, as the shared app test harness makes them too: one repository,
  with the engine's `openServerRecord`; the online calls; notes to finish; referrals; the records
  made at a visit; the notes' definitions, from the phone's files or fetched with signal; and one
  sweep. Their refreshers read the team's note type list (its titles), then sweep, so the sweep
  runs at the opening and after every sync. The person is the session's unlocked profile in that
  team, with its credential and display name, and the permission keys the controller opened the
  team with; a profile that is not the team's person gets no credential and no name, so nothing is
  offered the server would refuse. A role or credential changed on the server reaches them at the
  next opening or unlock, as phase 3's patient services do (D100). The screens find them by
  `EncounterServices.of(store)` or `encounterServicesProvider`.
- **Reading a visit that has left the phone** is `EncounterApi.openVisit` (9.7 as built).
- **Open, the server's** (review finding LCM-2): offline, a Medical visit whose notes have all left
  the phone cannot know of its finished Red flags note; the visit's snapshot saying it has one would
  let hard stop 5, and the Red flags note added with a Medical note, read it there.

As built on the screens (unit L5, with its review; the coordinator's decision on findings SFL-5 and
SRD-8): online, the summary, the note types list and the note screen's `open_note_type`, Go to Red
flags and Expand ask once for the screen whether the server's read of the visit shows a finished
Red flags note (`RedFlagsOnline`, through `EncounterApi.finishedRedFlags`, within `serverReadLimit`),
and pass the answer as `redFlagsFinished` to `openComplete`, `addNote`, `addRedFlagsNote` and
`expand` (D113). One read serves the screen, whatever it then adds or completes; the server logs it
as it logs any visit read, though the screen draws none of it (10.1 as built). Offline, after the
limit, and for a visit made here that has not reached the server, nothing is asked and the phone's
copy decides, as before, which the server tolerates. As first built no screen passed it, so a
teammate's finished Red flags note that only the server held made the person add and answer one of
their own, online too. Reading a visit that has left the phone is the visit screen's, which since the
review asks the server first, online, for any visit (9.7 as built).

### 8.3 Problems made or changed in an encounter

Phase 3 left two hooks (1.1, 1.2): `problems.source` and the `encounterId` of a status.

- The General note's Assessment has a problem search with a status (field spec, lines 31-33). The
  forms part gives it a field kind that stores the diagnosis picked, its code and its label; the
  status tapped is an ordinary field beside it, and the section repeats, one entry per
  diagnosis.
- Under it sits **Add to the problem list**. It creates a `problem` record through the phase 3
  path (`PatientRepository`, `apps/mobile/lib/patients/problems.dart`), with the encounter's ID.
  A problem create already carries an optional `encounterId`, stored as `created_encounter_id`
  (`services/api/src/sync/entities/values.ts:217`; `problem.ts:183-193`). Phase 4 only sets
  `source = 'encounter'` when it is present.
- Changing a problem's status from inside an encounter sends the status with that encounter's ID
  (`services/api/src/sync/entities/values.ts:230-232`). The phone passes the ID when the Problems
  screens are opened from an encounter, and `null` otherwise, as today.
- The note's four statuses (New, Chronic, Improving, Worse) are not the problem list's three
  (New, Ongoing, Resolved). Default: New adds the problem as New; the other three add it as
  Ongoing; nothing in a note resolves a problem (PLAN-OPEN 12.1 #16).

As built on the phone (units L4 and F7, with their review; `apps/mobile/lib/patients/problems.dart`
and `patient_repository.dart`, `apps/mobile/lib/encounters/encounter_repository.dart`,
`apps/mobile/lib/features/forms/problem_field.dart`):

- **A problem, a problem's note and an allergy at a visit.** `Problems.add` and `stillHasThis` take
  the visit's ID, as `move`, `confirmStatus` and `addNote` already did, so the server stores
  `source = 'encounter'` and the visit; `PatientRepository.addAllergy` takes one too, for an allergy
  recorded at a visit (9.7). Each refuses, writing nothing, a visit this phone holds of someone
  outside the patient's merged group (`checkVisitOf`, `encounter_other_patient`: "That visit is
  someone else’s. Add this from their chart, or without the visit."), as the server's
  `visitOfOtherPatient` refuses it (4.7); a visit with no patient, or one of a record merged into
  the patient, passes, and one the phone does not hold is the server's to check. A problem says
  which visit it was made at (`ProblemView.encounterId`) and, on a chart, "at a visit" (8.4 as
  built).
- **Add to the problem list.** `problemListPlace` says what the form shows under a picked diagnosis:
  nothing without a diagnosis, on a visit with no patient, or to a role that doesn't chart; "On the
  problem list" when the patient's list, as the person may see it, holds an open problem with the
  same code; else the button, with the list's status the note's own status maps to
  (`problemListStatus`, 12.1 #16): none when the note gives no status, and the person then chooses
  ("Add as New or Ongoing?"). `addToProblemList` adds the problem through `Problems.add`, naming the
  visit: the diagnosis's label as its title, cut to 200 characters, and as the code's words, and
  sensitive for a code on the sensitive list. The button is heard as "Add to the problem list:
  {diagnosis}", its visible words first (review finding LFM-2).
- **The same problem coming back** (the coordinator's decision). When the list holds the diagnosis
  Resolved, by the same code or the same title read loosely (`Problems.resolvedMatch`, phase 3's
  Add problem rule, which that screen now calls too), the form asks phase 3's question: "Is this
  the same problem coming back?", "“{title}” is on the list as Resolved.", **No, a different
  problem** and **Yes, it came back**, neither styled as the default. Yes adds it as a new episode
  of that one (`recurrenceOf`), No as a different problem; until it is answered, the add is refused
  (`same_problem_question`). "It never went away" (`resolvedInErrorOf`) stays on the problem screen.
- **A sensitive problem** (the coordinator's decision): a reader without `patients.view_sensitive`
  does not see one on the list, so they are offered the button for it and may add the same
  sensitive problem twice, and are never asked about a sensitive Resolved one: telling them it is
  there would disclose it.

### 8.4 The Needs attention fix for `encounter_missing`

A problem, allergy or problem note that names a visit the team does not have is refused with
`stale_reference` and `encounter_missing` (1.5). The hold rule means this only happens when the
visit itself never reached the server and is no longer on the phone. The card gains two buttons:

| Button | What it sends |
|---|---|
| **Send without the visit** | The same value with `encounterId: null`, through `fixRejected` (`apps/mobile/lib/sync/local_store.dart:1328-1345`) |
| **Choose a visit** (shown when the phone holds another visit of that patient) | The same value with the chosen visit's ID |

Both link the new change to the refused one, so the refused one is settled when the new one is
accepted (the fix chain of phase 2).

The same two buttons settle `encounter_other_patient` (4.7): a referral, a problem, an allergy
or a problem note that names a visit of someone else. On a chart, a referral or a problem says
"at a visit" only when that visit's patient is in the chart's merged group.

A visit that moves to another patient once records were made at it leaves them with the first
patient (4.3, a default: 12.1 #25). Nothing on the phone or the server moves them, and no card
asks about them: the visit screen lists the records made at the visit (9.7), so the clinician can
find each one and enter it in error.

As built on the phone (the domain layer, unit L4, with its review):

- **"At a visit" on a chart** (`shownAtVisit`, `apps/mobile/lib/patients/problems.dart`), for a
  problem and a referral: a visit the phone holds says whose it is now; one it does not hold counts
  only when the chart's cached timeline (5.2) lists it among the group's visits, since it may have
  moved to someone else since the record was made at it (review finding LRA-3). A record made at a
  visit older than the timeline's first 50 loses the words until the phone holds the visit. The
  refusal of a record at another patient's visit (8.3 as built) still leaves a visit the phone does
  not hold to the server.
- **The records made at a visit the phone holds** (`VisitRecords.madeAt`,
  `apps/mobile/lib/encounters/visit_records.dart`): its referrals, problems, allergies and problems'
  notes, in that order as 9.7 lists them, from what the phone holds and from the charts it keeps (a
  chart's problem notes, its timeline's referrals), each kind in the order made as far as the phone
  can tell. Each is shown as its chart shows it to the reader, as the server's `recordsMadeAt` asks
  it (D91): nothing without `patients.view`; a problem, and a note on one, only with the problem
  list's keys, a sensitive one only with `patients.view_sensitive`; a note whose problem the phone
  does not hold is left out, since nothing then says whether it is sensitive. A problem entered in
  error or merged into another entry is listed, as the server lists it. Each record says whether
  its visit has moved since to someone outside its patient's group (`onAnotherChart`), and each is
  logged as 10.1's table for the phone says.
- **A visit read from the server or a chart's cache** gives its records as the server's snapshots
  (`VisitView.records`, 9.7 as built). Each is logged on its own patient, never the visit's, which
  may not be its own (review finding LRA-1). A problem's note names its problem's patient in its
  snapshot (`attributes.patientId`, `problem-note.ts` and the test server, with a parity case), as
  nothing else of it does, and `patientOfMadeAt` takes that first: the phone may hold the problem
  under the chart it was read with. A note cached before the server named it is found through its
  problem, among the visit's records or on the phone, and one it cannot find that way is logged with
  no patient; the cache is fetched again at the next chart open online (5.2).

As built on the phone after unit L5's review (the coordinator's decided work; the domain layer's
`refusal_fixes.dart` and Needs attention, 9.13 as built): both buttons are built for a refused create
of a referral, a problem, an allergy or a problem's note refused `encounter_missing` or
`encounter_other_patient` (`settledByVisit`), each sent as the fix of the refused create through
`fixRejected`, so the refusal settles once the server takes it and what waited behind it goes after
it:

- **Send without the visit** sends the same create with `encounterId: null` (`sendWithoutVisit`).
- **Choose a visit** shows when the phone holds another visit of the record's patient's merged group,
  decided without reading or logging anything (`hasVisitsToChoose`). Its sheet lists those visits,
  newest first, by kind and start time alone, no place and no name, and leaves out the visit the
  refusal names even while the phone's copy still says it is the patient's; each visit listed is
  logged as `encounter.viewed` on its own patient, in one transaction, as the sheet opens
  (`visitsToChoose`), and the sheet goes on a freeze. The visit chosen goes in the create sent again
  (`moveToVisit`), which refuses, writing nothing, a visit of someone outside the record's patient's
  group ("That visit belongs to someone else. Choose another, or send it without the visit.",
  `encounter_other_patient`).
- Both sit with **Open the chart** on the record's card and wait for the clock check. As first built
  neither existed: the card offered only Open the chart, which settles nothing.

## 9. Screens

Every screen here follows the rules of `CLAUDE.md` and the phase 3 screens
(`docs/plan/patterns/phone-screen.md`, `portal-page.md`): Day, Night run and High contrast; text
at 200% with no overflow; a 320 px wide phone; 48 px targets; every control labelled, with a tap
action; live regions that speak once; text fields that hold patient details with suggestions and
autocorrect off; routes that carry UUIDs only; no patient details in a page title; nothing shown
once the store is frozen; every phone screen tested offline. Wording lives in
`apps/mobile/lib/features/encounters/encounter_labels.dart`, with curly apostrophes.

A modal sheet is not under its screen's gate, so every sheet that shows a patient's or a note's
details sits in `SheetGate` (`apps/mobile/lib/features/patients/sheet_gate.dart`), which hears the
sync controller and the team's services and leaves only why on the sheet once the store freezes:
the correction and addendum sheets (9.7), the Referrals sheet (9.10), Needs attention's visits to
choose from (9.13), the `choosePatient` sheet that Switch to Medical and Needs attention's Choose the
patient open (9.2), and phase 3's patient picker, What changed, Which is right? and Create's Is this
Del?. A dialog that names something of a chart or a note (the profile's **Remove “Smitty”?**,
**Mark “penicillin” entered in error?** and **Copy which card’s link?**, the intake's **Open Del’s
chart?**, the ID card's **They declined a card. Make one anyway?**, a note entry's **Remove
Problem 1?**, and Add to the problem list's question about a Resolved problem) sits in
`DialogGate`, beside it, which hears the same and closes the dialog as its Cancel would, leaving
the screen to say why; the note form, which reads through no services, finds the note screen's in
a `DialogGateScope`.

**Every modal route, as built** (the coordinator's decision on review findings VA-3 and VA-4; the
first round's fix of PP-1 had gated a note's date and time pickers, the Referrals sheet's, a
referral's Entered in error and Expand's “not copied” dialog; `freeze_pickers_test.dart` holds all
but Expand's, which no released note type can bring up on the test harness and the test below
holds). Every `showDialog`, `showModalBottomSheet`, `showDatePicker` and `showTimePicker` in
`apps/mobile/lib`, and every `confirm` and `askReason`, is gated: a `SheetGate` over a sheet, a
`DialogGate` over a dialog or a question (`gate:`), and a `DialogGateScope` over every route that
draws a form field, whose pickers (`DateField`, `TimeField`, the problem field's questions) gate
themselves through it (`DialogGate.over`). The correction sheet (9.7) is a modal route of its own,
outside the note screen's scope, so it brings one: a note's date or time picker opened from it
closes on a freeze. Phase 3's **Add a street name**, with what is typed in it, Record consent, the
reason for another ID card, Add problem's onset date (since C-3 the forms' typed date in three
private boxes beside the calendar alone, in a `DialogGateScope.patients`, as the Referrals sheet's
is: D92), Still has this?, Mark as Resolved? and a problem's Entered in error are gated, and so are
the questions with no detail of their own asked over a chart (Remove this note?, Reopen?, Switch to
Medical?, leaving an addition to the assessment, discarding an intake), since a freeze leaves
nothing they could do. `apps/mobile/test/security/dialog_gates_test.dart` reads `lib` and fails on a
call that is neither gated nor on its short list of calls that show nothing of a chart, each with
why (the Start sheet, the lock screen's Sign out, Log out), and on a screen that draws a form field
with no `DialogGateScope`.

**Focus after a Remove** (review findings PX-5 and VX-5). A control that goes takes focus to the one
in its place, never nowhere: removing an answer from a correction closes Which answer? if it is
open, so focus goes to Correct another answer; and Remove this note on a visit's only note, whose
list then becomes the note types, sends focus to the Choose a note type heading, a focus target
that is no Tab stop.

### 9.1 The patient profile (phone)

`apps/mobile/lib/features/patients/patient_screen.dart` gains:

- **+ Encounter** and **+ Referral** in the header's quick actions (PRD main 721). **+ Order**
  arrives in phase 6. **+ Encounter** shows only with `encounters.chart`; **+ Referral** only
  with `referrals.create`.
- A **Timeline** section: one row per visit and per referral, newest first (PRD main 725). A
  visit row shows the date, Medical or Non-Medical, and its note types as chips with each note's
  state in words (Draft, Complete, Waiting for a co-signer, Signed, Waiting for attestation,
  Attested). It opens the visit (9.7). The type filter is one row of chips above the list with
  the PRD's seven names: Clinical, Psych, Social, Referrals, Outreach, Harm reduction, Wound (PRD
  main 725). Each note type belongs to one of them (forms 2.2); a referral row belongs to
  Referrals. Under the first 50 visits, **Show earlier visits** asks the server for more (5.2).

As built (the phone's domain layer, unit L4, `apps/mobile/lib/encounters/timeline.dart`, with its
review): `openTimeline` merges the chart's cached timeline (5.2 as built) and the pages **Show
earlier visits** fetched with the visits the phone holds of the merged group. A note the phone
holds shows its state as the phone knows it, "Waiting to send" until confirmed, or "Sent for
review"; a note the reader may not see, and an empty draft, are left out by the visit read's own
rules, even when the cached chart still lists them (review finding LRA-5). A note only the chart
lists is Medical by its type in the team's list, else by its visit's kind (3.10). A visit that comes
again on the next page is listed once, and **Show earlier visits** is offered only after a full
page of 50. What it says counts the visits the page adds to what the type filter shows, as the
portal counts `fresh`; a page the filter hides all of says "Earlier visits were found. The filter
hides them.", and focus goes to the Timeline heading, which takes focus only when sent there and is
never a Tab stop (review findings VX-3, VX-4). The referral rows are the Referrals list's (7 as built). Newest first: a referral sorts
at midnight UTC of its date, a visit before a referral of the same moment, then by ID; a visit made
here whose time the phone has not learned yet comes first. The timeline logs nothing of its own: it
is part of the chart's logged read, as phase 3's chart lists its problems; opening a visit from it
is a visit read, which logs (9.7).

As built (the screens, unit L5, `apps/mobile/lib/features/patients/patient_screen.dart` and
`apps/mobile/lib/features/encounters/timeline_section.dart`):

- **+ Encounter** (to a role with `encounters.chart`) and **+ Referral** (with `referrals.create`)
  come first among the quick actions, neither on a merged chart. Each is read as what it opens ("New
  encounter", "Add a referral"); + Encounter opens New encounter with the patient chosen
  (`/patients/<id>/encounters/new`), + Referral the Referrals sheet (9.10).
- The **Timeline** section sits after Problems, before Allergies (the coordinator's decision; the
  design did not place it). The
  filter's seven chips wrap onto more lines at large text or on a narrow phone rather than scrolling
  sideways in one row; with none on every row shows, with some on the rows of any of them. A visit's
  row reads its date and time, Medical or Non-Medical, "Waiting to send" and each note as "{type}:
  {state}", and opens the visit (9.7). A referral's row reads as the Referrals sheet reads it and
  opens the sheet. A chart opened from the team's list (no timeline of its own) lists the phone's
  visits and says "Visits recorded elsewhere show with the full chart." **Show earlier visits**
  appears under a full page, keeps the pages it fetched while the profile is open, and offline says
  the domain layer's "Connect to see earlier visits." The section reads the chart's cached timeline
  again after every change or sync, and logs nothing of its own.
- Since the review, the Timeline heading and each sentence under it (the one above, and the empty
  list's) are nodes of their own, so a screen reader hears the heading alone and then the sentence;
  before, the heading took the sentence in (review finding SAX-5). A visit opened from the timeline
  after Save & Close offers **Add or remove notes** (9.7), the way back to the encounter screen.
- Since the phase's review (findings PX-1 and PX-2): **Show earlier visits** says what it brought,
  under the button as a live region, “1 earlier visit shown.”, “3 earlier visits shown.” or “No
  earlier visits.” (counted over what the filter shows, as the domain layer's paragraph above
  says), and moves focus to the first visit row it brought, else to the Timeline heading, for
  someone on the button with a keyboard or a switch, or with a screen reader on (`focusFollows`).
  Each press keys what it says, and its refusal, anew, so the same sentence twice is said twice.

### 9.2 Start

The tab bar gains **Start (+)** between Patients and the tabs to come (PRD main 743;
`apps/mobile/lib/app.dart:181-208`). In phase 4 it opens one choice, **New encounter**. Quick
check-in and Scan ID link arrive in phase 9; Brief call note is PLAN-OPEN 12.1 #14.

New encounter:

1. **Who.** The patient picker of phase 3
   (`apps/mobile/lib/features/patients/patient_picker.dart`), with **New patient** (the intake)
   and **No patient** (3.10). Started from a profile, this step is skipped.
2. **Where.** A text field, "Where are you?" (`locationText`), and a button **Use my location**
   that fills `location` from the phone's GPS. Nothing is captured without the tap
   (PLAN-OPEN 12.1 #15).
3. **Medical or Non-Medical** (9.3).

The encounter is created when step 3 is answered. While the clock check fails, Start says why
and creates nothing (D35).

As built (the phone's domain layer, unit L4, `startEncounter`): the visit takes the patient or none,
the place typed (trimmed; blank is none), the place the phone gave on **Use my location** (`lat`,
`lng` and `accuracyM` as the phone gives them, only on the tap, 12.1 #15) and the kind. A Medical
visit needs its patient (3.10 as built). Start refuses, writing nothing, while the clock check fails
or the store is frozen (`ChartingPaused`), and for a role that doesn't chart or a Medical visit from
a credential that doesn't chart Medical.

As built (unit L5, `apps/mobile/lib/features/encounters/location_field.dart`, with the `geolocator`
plugin): **Use my location** sits under "Where are you?". Nothing is asked of the phone before the
tap, not even whether it may say: the tap checks that location is on, asks for the permission if it
was never given (while the app is in use only: Android's fine and coarse location, iOS's
`NSLocationWhenInUseUsageDescription`), then takes one high-accuracy fix within 30 seconds. The
screen never shows the coordinates, only "Your location is added." with **Remove**, and "Your phone
could tell only roughly where you are." when the fix is worse than 1 km (approximate location). A
fix the server would refuse (out of range, worse than 100 km, or 0, 0) counts as none. When there
is none the button stays, and a sentence says why in plain words: not allowed, not allowed for good
(with **Open phone settings**), location off (with **Open phone settings**), not found in time, or
not available on this phone. The place typed works with it or without it. The person may go on
while the phone looks; the kind step says "Still finding where you are. If you choose now, the visit
starts without it." and a fix that comes after the visit started is dropped.

Since the review of unit L5 (the coordinator's decisions on SAX-7 and SAX-8): the position is asked
only on the tap, kept as the phone gives it (12.1 #15), within 30 seconds ("Your phone couldn’t find
where you are. Try again, or type the place.", the button left to try again), and never shown as
coordinates. `geolocator` stays, and on Android it asks the fused provider through Google Play
services (`play-services-location` 21.2.0, under Google's SDK terms, outside `pubspec.lock` and its
osv scan): on most Android phones the location service is Google's whatever a plugin is told, so the
team's device policy decides whether Google's location accuracy is on (12.1 #32; plan section 6 and
risk 9). The plugin's foreground location service is taken out of the merged Android manifest
(`tools:node="remove"`): only its position stream starts it, and `getCurrentPosition`, the one call
the app makes, never binds or starts it (`geolocator_android` 5.2.1's source, `StreamHandlerImpl`
and `MethodCallHandlerImpl`), so the build holds no location service of any kind. The merged
manifest and one fix on a device wait for the Android build (13, "Not built in this phase").

As built (the screens, unit L5, `start_sheet.dart` and `new_encounter_screen.dart`, with its
review):

- **Start** sits in the tab bar after Patients and opens a sheet with one choice, **New encounter**
  ("Chart a visit, with or without a registered patient."). A role without `encounters.chart` is
  told "Your role doesn’t chart visits." and offered nothing.
- **New encounter** (`/encounters/new`, fixed title "New encounter"; from a profile's + Encounter,
  `/patients/<id>/encounters/new`, with Who skipped) is one screen of steps, "Step 1 of 3" and so on:
  Who, Where, then Medical or Non-Medical (9.3). A credential that can't chart Medical is not asked
  the kind and starts a Non-Medical visit from Where (**Start the visit**). Nothing is written until
  the last step is answered; then the encounter screen (9.4) takes this one's place. While the clock
  check fails, the screen says the store's sentence before anything is pressed, and writes nothing
  (D35). A freeze for a
  hand-over takes what was read off the screen at its next build, whatever causes it (phase 3's V1).
- **Who** is phase 3's search run and rows, built into the screen (`PatientFinder` in
  `encounter_widgets.dart`, and the `choosePatient` sheet built on it, which Switch to Medical and
  Needs attention's Choose a patient open): each search a run of its own, logged before it shows,
  its count said once ("1 patient found on this phone"), **Show more** or "More people match. Add
  letters to narrow it down." for a long run, and nothing once the store is frozen. It is not phase
  3's `pickPatient` sheet, whose heading is Needs attention's and which has no Show more and no
  count of the phone's run; it does take what it found off the sheet once the store freezes, in
  `SheetGate`, since `d713056` (the coordinator's decided reuse is not built: 13, "Not built in this
  phase").
- **New patient** opens phase 3's intake, told to come back (`IntakeStart(returnsPatient: true)`):
  once it saves, or once the person opens the chart of someone found already there, it returns that
  patient's ID, and the visit goes on at Where for them ("Register them, then the visit goes on for
  them."). As first built the intake replaced New encounter with the new chart, and the visit was
  started again from its + Encounter (decided work of the review). **No patient** says "For someone
  who’d rather not be registered. The visit takes Non-Medical notes only."; Medical chosen with no
  patient shows the domain layer's refusal and **Choose the patient**, back to Who.
- **Where** is a private text field, "Where are you?" (optional), with Use my location under it.

### 9.3 Medical or Non-Medical

Two large buttons, each with one line under it: "Medical: clinical notes, orders, signing" and
"Non-Medical: outreach, supplies, social needs" (PRD main 379). A person whose credential cannot
chart Medical (6.2) is not shown this screen: their encounter starts Non-Medical.

The encounter's header has **Switch to Medical** on a Non-Medical encounter, for a credential
that may chart Medical. It changes `kind` and keeps every answer (PRD main 379). On an encounter
with no patient it first asks who the patient is (3.10). There is no switch back: a Medical
encounter with only Non-Medical notes needs none (3.10).

As built (unit L4): Start asks the kind (`asksKind`) of a role that charts with a credential that
charts Medical; anyone else's visit starts Non-Medical. **Switch to Medical** (`switchToMedical`)
sets the kind once, gives a visit with no patient its patient in the same transaction, and refuses
without one (3.10 as built).

As built (the screens, unit L5, `kind_screen.dart`, with its review): each kind's button shows the
kind's name over the rest of the design's line ("Clinical notes, orders, signing") and is read as
the whole line. **Switch to Medical** sits in the encounter screen's header (9.4) on a Non-Medical
visit, for a credential that charts Medical. On a visit with no patient it asks who first, in the
`choosePatient` sheet ("A Medical visit needs a patient."); then it asks "Switch this visit to
Medical?" ("The notes and their answers stay as they are. A visit can’t be switched back."), since
there is no switch back, and says "Switched to Medical". Closing either question changes nothing.
Every question these screens ask (Switch to Medical, Remove this note, Reopen, Entered in error,
Leave what you added) is phase 3's `confirm()` or a dialog of the same build, which since the review
is `AskDialog` (`apps/mobile/lib/features/patients/patient_widgets.dart`): its buttons end its body
and scroll with it, so each is reached at 200% text on a 320 px phone, where the Switch button had
been off the screen (review finding SAX-10). Phase 3's reason dialog (`askReason`) is built on it
too, for every screen that asks a reason.

### 9.4 Note types

"Choose an encounter type ... to load its template" (PRD main 380). A list of the note types
offered for the encounter's kind, from the forms part's registry. Tapping one creates the note
and opens its form. If the encounter already has a draft of that type, the app opens that draft.

The encounter screen lists its notes, each collapsed to its recap line, with **Add another note
type** below (PRD main 97). A note by a teammate shows their name. A draft the person authors
has **Remove this note** in its menu: it blanks every answer, after asking, and the note then
counts for nothing (3.1). Empty drafts are not listed.

As built (the phone's domain layer, unit L4, `encounter_repository.dart`, with its review):

- **The list** (`noteTypesOffered`) is the team's, in its order: every type in a Medical visit and
  the Non-Medical ones in a Non-Medical visit; to a credential that can't chart Medical, the
  Non-Medical ones in any visit; nothing to a role that doesn't chart. The Red flags note is never
  listed: the app adds it (forms 6.2).
- **Tapping a type** (`addNote`) opens a draft of that type already in the visit (`existing`): the
  person's own first, even when empty, so going back from a note just added and tapping its type
  again makes no empty second note, though one of theirs with answers opens before an empty one
  (3.3 as built); then a teammate's that is not empty and that the person may
  see (an empty one counts for nothing, 3.1). A draft on another version of the same type counts;
  one whose form the phone can't lay out, or a Medical one to a credential that can't chart
  Medical, does not, and a new note is made. `another` makes a second note all the same (4.4,
  12.1 #3). A Medical note needs a Medical visit with a patient (3.10 as built). With a Medical
  note of the person's own, new or opened, the app adds their Red flags note (forms 6.2 as built).
  The person's own empty draft whose settling fix waits to send (a note removed while its refused
  sign-off is settled, below) is not opened: a new draft is made, so Complete never tells the
  person about a Complete they did not make (3.3 as built).
- **Remove this note** (`removeNote`) is for whoever acts as the note's author, on a draft ("Only
  the note’s author can remove it."; a note finished as the phone knows it, or sent for review, is
  `RecordLocked`). It blanks every answer that holds anything, those a condition hides included, in
  one transaction. If a sign-off of the note was refused, the same transaction sends that
  refusal's fix through `finishNotes` over the empty note, with the refused sign-off's act and
  statement version and the profile's `Signer`, so the refusal settles at the next sync (3.4). It
  is all or nothing: while anything else about the visit waits in Needs attention, `finishNotes`
  refuses the fix and the whole Remove is undone (`needs_attention`, "Something about this visit
  waits in Needs attention. Fix it there first, then remove the note."); otherwise the refused
  sign-off of a note nobody sees any more would stop every later Complete of the visit. It also
  refuses `read_only` when the note holds an answer the server would hold from its author (a
  section that needs an ordering credential, filled by a teammate): the server's copy would never
  be empty, and the fix would be refused `content_changed` again.
- A teammate's note shows the name its record carries (9.7 as built, D108).

As built (the screens, unit L5, `encounter_screen.dart` and `note_type_list.dart`, with its review):

- **The encounter screen** opens at `/encounters/<id>` under the fixed title "Encounter" (the
  coordinator's decision), when New encounter starts the visit and from the visit screen's **Add or
  remove notes** (9.7), the way back once the person has left it (review finding SFL-4). It reads the
  phone's copy only (the coordinator's decision): a visit the phone does not hold says "This visit
  isn’t on this phone. Connect to open it.", and the visit screen is where a visit is read from the
  cached chart or the server, or brought onto the phone. Its header is one heading: who, the kind
  ("Medical visit") and "Where: {place}", with **Switch to Medical** under it (9.3).
- **Each note** shows its type, its recap, a line per section, three lines then an ellipsis (forms
  10.1 #48; a screen reader hears the whole recap), its state, "On this phone only" until the server
  has it (never beside "Waiting to send", which says the same), and "By {name}" for someone else's ("a
  teammate" while the phone knows no name). It opens its form, or its read view once finished. An
  empty draft is not listed. **Remove this note** is in the menu of a draft the person acts as the
  author of ("More for {type}"), asked first ("Remove this note?", "Every answer in it is cleared,
  and the note counts for nothing."), and the domain layer's refusal shows in its words.
- **Add another note type** sits below the notes and opens the Note types screen. A visit with no
  note listed shows its note types on the screen itself, under "Choose a note type".
- **Note types** (`/encounters/<id>/note-types`, fixed title "Note types") lists `noteTypesOffered`.
  A type the visit has a draft of says "A draft of this is in the visit. Tapping it opens the
  draft." and offers **Add another** (read "Add another {type}", `addNote(another: true)`), as 4.4's
  "opens an existing draft before it offers to make another" reads. The screen works out which types
  have a draft from the visit it shows, so the person's own draft on a version whose form the phone
  can't lay out is listed as opening while `addNote` makes a new note (a review note, left as built:
  asking the domain layer would be exact). A Non-Medical visit says "For clinical notes, switch this
  visit to Medical." to a credential that may; with no list on the phone yet, "Connect once to load
  your team’s note types."; to a role that doesn't chart, "Your role doesn’t chart visits." A note
  opened from the Note types screen takes that screen's place, so back lands on the encounter screen.
  Online, the first tap asks once whether the visit has a finished Red flags note the phone lacks
  (`RedFlagsOnline`, 8.2 as built), so a teammate's makes the person's own needless.
- **Reading.** Both read the visit through `openVisit` (the `VisitReading` mixin), each read logging
  only what it adds. A screen covered by another (the note's form saves at every answer) does not
  read at each change: it reads once it is on top again, so it logs only what it shows and scans the
  store once, not per keystroke. The visit stays in the close sweep's `showing` set while it shows.

### 9.5 The note form

The forms part's renderer: accordion sections, each collapsing to its recap line (PRD main 381,
392). This part fixes the frame around it:

- The header shows the patient's preferred name and the allergy badge of phase 3.
- Every answer is saved as it is entered. There is no Save button for a field.
- The bottom bar has **Save & Close** and **Continue**. Continue goes to the summary (9.6).
- A finished note opens read-only (9.7).
- A conflict on an answer (two people changed it) shows both values side by side on the field,
  with the phase 2 choice (PRD main 100).
- A field that could hold content the person may not see is shown read-only to someone who does not
  act as the author: since D88 the server holds every set of such a field from them, whatever it
  holds now (4.4), and their phone holds the note as `visibleAnswers` gave it, so a set would drop
  what they were never sent (the exam picker, for someone without
  `patients.view_sensitive_exams`; F5's review, BEH-4). L4 builds the rule as a Dart copy of the
  server's, `mayHoldHidden` in `services/api/src/sync/records.ts` (the phone's test server has
  one), never a second idea of it (forms 8.1).
- The form keeps no working copy of the answers, so a second tap of Normal before the screen draws
  the form again sends the same values again. L4 drops a set whose value equals what is stored at
  that path before it queues it (forms 8.1).

As built (the phone's domain layer, unit L4, `encounter_repository.dart`, with its review):

- **What is read-only** (`readOnlyAt`): the whole note when it is not `editable`, which takes a
  draft as the phone knows it, not sent for review, a role that charts and, for a Medical note, a
  credential that charts Medical. Otherwise an answer where the server would hold the person's set
  for a Program Admin, which they could never fix: one that could hold what they may not see, to
  someone who does not act as the author (`mayHoldHidden`, D88, D92), and, whoever acts as the
  author, an answer of a section that needs an ordering credential, to a credential that can't
  order (6.4 rule 5), which the design named only for what the form draws (forms 10.1 #53). The
  form takes no list of such answers yet: the screen that wires it in (L5) gives it one, from
  `readOnlyAt` (forms 8.1).
- **Saving an answer** (`saveAnswer`): refused `read_only` where `readOnlyAt` says so ("You can’t
  change this answer."); checked by the note's own version (`checkAnswer`, refused with its problem
  and the path, "This answer can’t be saved."); a value equal to what is stored, an absent answer's
  `null` included, is no change and is not queued; the rest goes to `setField`. A note finished as
  the phone knows it is `RecordLocked`.
- **What waits and what conflicts**: the note's `pendingPaths` mark what waits to send of what the
  reader may see, a cleared answer included (review finding LFM-3), and its `conflicts` give the
  form each answer two people changed (forms 8.1 as built). A choice on a conflict is made in the
  store; the screen syncs after it, as Needs attention does (the coordinator's decision, L5).

As built (the screens, unit L5, `apps/mobile/lib/features/encounters/note_screen.dart`, with its
review):

- **The frame.** A note opens at `/notes/<id>` under the fixed title "Note" (the section to open, the
  summary's jump, travels as an ID beside the route, never in it): the visit's patient by
  their preferred name and phase 3's allergy badge (by phase 3's `allergyBadge`, from the records
  the phone holds of the patient's merged group, else the team's index), then the note's type, its
  state and, for a teammate's note, who acts as its author. A finished note opens as its read view;
  a draft the person may not change now (sent for review, a Medical draft to a credential that
  can't chart Medical) as the form with nothing to change. While charting is paused for the clock
  the form is read-only and says why. Read through `openNote`, each read logging what it adds.
- **Read-only answers (D92).** Since the review the screen gives `NoteForm` the domain layer's
  `readOnlyAt` as its read-only test (forms 8.1 as built), so an answer the server would hold from
  the person is drawn read-only before any tap, and one-tap Normal leaves it alone, so a section's
  or a system's Normal is never refused part-way (decided work of the review, with a reviewer's
  note on Normal). As first built such an answer was drawn like any other, refused by `saveAnswer`
  ("You can’t change this answer.") at the tap and the form drawn again from the store; that refusal
  stays as the second line.
- **Save & Close** saves the box being typed in, pops the visit's screens to the patient's chart
  (the chart under them when it is this patient's, else it opens; Home for a visit with no
  patient), says "Saved as a draft" there (a SnackBar from the app's messenger, taken before the
  visit's screens go, so the chart shows and a screen reader hears it; review finding SAX-1) and
  asks for a sync; **Continue** opens the summary. Both stand in a bar under the form,
  with what was last refused; at large text on a short screen (two times on most phones) they end
  the note's list instead, and only a refusal stays in the bar. The bar never takes more than a
  third of the screen; a longer refusal scrolls in it.
- **The form's actions** (card F7-actions): `open_note_type` is offered where its type can be
  started in the visit (the note types list offers it; a Medical type needs a Medical visit with a
  patient) and opens `addNote`'s note. The Red flags note goes through `addRedFlagsNote`; when a
  finished one makes the person's needless, the action opens that one, read-only: the phone's, found
  by a scan of the store that reads and logs nothing (`finishedRedFlagsNote`), else the server's,
  brought onto the phone first (`fetchNote`), so only the note screen's own read logs it (review
  finding SRD-7; as first built a whole visit read was logged that nothing showed); with neither, it
  says "This note isn’t on this phone. Connect to open it.". Online, `open_note_type`, the Red flags
  action and Expand first ask once for the screen whether the visit has a finished Red flags note
  the phone lacks (`RedFlagsOnline`, 8.2 as built). `add_referral`, on a visit with a patient and to
  someone with `referrals.create`, opens Add referral on its own (`showAddReferral`: a date, today by
  default, and the details), which closes once the referral is added; the summary opens the whole
  Referrals sheet (9.6, 9.10). `show_handoff` opens the handoff (9.8); since the review it is drawn
  on a form the person can't change now too (a teammate's draft, charting paused for the clock),
  since showing it is a read (review finding SRD-2; forms 10.1 #51 as built).

### 9.6 The summary, and Complete

"Every encounter ends on a summary screen" (PRD main 433). From top to bottom:

1. The recap of each note (8.1), each under its note type's name. Above a recap, a line for
   each answer that someone else changed since the person last had the note open: "{name}
   changed Dressing applied." The screen works out each note's hash as it draws it and hands
   those hashes to Complete, which stops if a note has changed since: "This note changed. Read
   it again." (4.8). As built, the plan (`openComplete`) gives each note's recap with its hash,
   from one read, and the summary draws that recap: two reads with a sync between them would show
   one version and sign another (review LCM-7).
2. **Assessment**: a text box of up to 4,000 characters (the encounter's `summary`), with a
   counter that speaks at 90% and at the limit, as phase 3's note counter does. Once the visit
   has a finished note the assessment is locked (3.1): it is shown with who wrote it, and the
   box under it is **Add to the assessment**, which makes an addendum to the visit when the
   person completes.
3. **Suggested next steps**: chips from the forms part's suggestion rules (PRD main 433), each
   adding a note type. `suggestions` gives every key the options picked suggest (forms 7.1); the
   screen leaves out the note types already in the visit, so a chip always adds a note the visit
   does not have.
4. **Add referral** (7).
5. **Follow-up**: what the notes say about follow-up, as recorded. "Follow-up tasks created in
   one tap" (PRD main 433) needs tasks, which arrive in phase 7; the answers are stored now and
   phase 7 makes the tasks from them (12.3). In a Medical visit the follow-up is the Red flags and
   disposition note's: the Quick encounter asks none of its own (forms 6.2, 6.4).
6. What stops Complete, when anything does, as a list. Each line names the note and the section,
   and jumps to it: "Wound care: record consent for the exam."
7. The signing sentence (3.5), when a note will be signed.
8. **Save & Close** and the Complete button, worded by the table in 3.3.

Complete finishes the person's own notes. If a teammate's draft is in the same encounter, a line
says so: "{name}'s note stays a draft until they complete it." After Complete, the chart opens
(8.2).

As built (the phone's domain layer, unit L4, `complete.dart`; 3.3 as built): the summary is drawn
from Complete's plan, not from a read of its own, so it shows what Complete will sign: each note's
recap from the plan (item 1); the lines that stop Complete (item 6), each naming its note and, for a
missing answer, the section to open (`CompleteBlock.section`, the form's `openSection`); the signing
sentence (item 7) from `CompletePlan.signingSentence`, "By completing, you sign this note as {name},
{credential}.", with the name the saved profile has (`EncounterUser.displayName`) and the credential
in words as the portal words it (`credentialText`, which moved from the forms part's read view to
`apps/mobile/lib/encounters/credentials.dart`), a credential this app doesn't know left out rather
than shown as a code; and the button (item 8). A teammate's draft is named by the name its note
carries (D108). The summary logs what it shows through the visit's read (`openVisit`); the plan logs
nothing of its own.

- **The assessment** (item 2) is saved by `saveSummary` as it is typed: trimmed, cleared when
  blank, and the same text not sent again. It refuses, writing nothing, a Medical visit's
  assessment to a reader of no Medical notes, who is not shown it (`read_only`, 5.1), and any
  change once the visit has a finished note (`RecordLocked`): what is added then goes with Complete,
  as an addendum to the visit.
- **The sentences that are this layer's**, the design giving none: "Your last Complete of this note
  hasn’t been sent yet. Connect so it can send, then complete again."; "This note was sent to a
  Program Admin for review. It can’t be completed again until they decide."; "This note is already
  finished."; "There’s nothing of yours to complete in this visit."; "This note’s form isn’t on this
  phone yet. Connect to load it, then complete."; "Your role doesn’t chart visits."; "Your
  credential doesn’t chart clinical notes."; "What you added to the assessment is too long. Keep it
  to 4,000 characters."; and a missing answer's line, "{note}: {section}, “{field}” needs an
  answer.", where item 6 gives a hand-worded example. The clock's sentence is the store's
  (`ChartingPaused`), and hard stop 2's "Something about this visit waits in Needs attention. Fix it
  there first, then complete again.".

As built (the screens, unit L5, `apps/mobile/lib/features/encounters/summary_screen.dart`, with its
review):

- The summary opens at `/encounters/<id>/summary` (fixed title "Summary"); the visit is read through
  `openVisit` and Complete is planned again after every change. Online, as it opens, it asks once
  whether the visit has a finished Red flags note the phone lacks (`RedFlagsOnline`, 8.2 as built)
  and passes the answer as `redFlagsFinished` to `openComplete`, `addRedFlagsNote` and a suggestion's
  `addNote`, so a teammate's finished note that only the server holds makes the person's own
  needless (review findings SFL-5 and SRD-8; as first built no screen passed it, and the person was
  given a Red flags note to answer, online too). Offline, and for a visit made here that has not
  reached the server, nothing is asked and the phone's copy decides, as the server tolerates.
- Item 1 draws the plan's notes, a note of the person's own with no answer yet saying so; teammates'
  drafts and the person's notes sent for review are named under them. **Someone else's change**
  (review finding SFL-2): the summary keeps each note's answers as it drew them, and when a plan
  made again shows a note whose answers changed where nothing of the person's waits to send (a
  teammate's change a sync brought in), it says "This note changed. Read it again." above that
  recap, and Complete refuses once, in the same words, before it signs what was drawn again. A
  change of the person's own, made in the note while the summary was covered and confirmed by a sync
  before it shows again, is read the same way and costs one more look. **Not built** (13): who
  changed what, the design's "{name} changed Dressing applied." Nothing records when the person last
  had a note open; the domain layer would have to keep it.
- The locked assessment shows without who wrote it: the visit's read does not carry the summary's
  author (13). What is added under it is kept in memory only and goes with Complete; Save & Close
  with something added asks first, "Leave what you added?" ("What you added to the assessment goes
  only with Complete. If you close now, it isn’t kept.", **Cancel** or **Close without it**; review
  finding SFL-7).
- The assessment is in each note's hash (4.5), so a Complete pressed while it is being typed saves
  it, plans again and goes ahead only when every recap shown is unchanged; otherwise it says "This
  note changed. Read it again." and shows the new plan.
- Item 4, **Add referral**, opens the whole Referrals sheet (`showReferrals`, 9.10), the patient's
  referrals and then Add referral, given the visit, so a referral added there is made at it (decided
  work of the review, as this section's "a sheet from the profile or the summary screen" reads); as
  first built it opened the add-only sheet a note's action opens.
- Item 5 reads the section or the field `follow_up` of the notes, the Red flags note's alone in a
  Medical visit: the format marks no follow-up, so the summary reads those IDs (a definition
  marker is not built, 13).
- Item 6: a line naming a note opens it at the section it names; hard stop 2's line, which names
  none, opens Needs attention (review finding SFL-6). A Complete the domain layer refuses shows its
  stops' sentences just above the button, apart from the plan's own list.
- Hard stop 5 with no note to open adds the person's Red flags note once, as the summary opens.
- After Complete the visit's screens give way to the patient's chart (Home for a visit with no
  patient), as Save & Close does, and a sync is asked for. Since the review the chart says what the
  button did, in a SnackBar from the app's messenger: "Signed", "Sent for co-signature" or
  "Completed", by the button's own wording (3.3), and "Saved as a draft" after Save & Close; a newer
  one takes the place of one still showing (review finding SAX-1: nothing was seen or heard).
- Since the phase's review: hard stop 2's line leaves out an addendum, an addition to the
  assessment or a correction refused only for naming a sign-off that Complete now fixes, through
  the store's `noteCompletedAgainFor`, so completing the note again from the summary sends them
  (4.8 as built; findings PS-1 and C-1). That the refusals said above the button are a live region,
  and each recap's note title a heading, is now held by tests that fail without them (PX-6, PX-5);
  and while the visit is read the spinner says “Loading the visit” (PX-7).

### 9.7 The visit

Opened from the timeline or from Notes to finish. A draft the person may edit opens as the form
(9.5). Everything else opens as the read view, drawn from a read model: the phone's own, for a
visit it holds; else the chart's `recentVisits`, for the last three, online or not; else the
server's (5.1), online, for the rest (8.2). The view:

- The envelope: date and time ("time not verified" when it was not), place, Medical or
  Non-Medical, the assessment.
- Each note: its recap, then its sections. A corrected answer shows the new value, and under it
  the old one struck through with who changed it, when and why (PRD main 460). An answer a
  correction took away shows no value, only the old one struck through (the read model's item
  with value null, forms 7.1). For a screen reader the old value is announced as "Replaced: {old
  value}".
- Below each note, in time order: sign-offs ("Signed by {name}, {credential}, {date}"),
  co-signatures, attestations ("Attested by {name}, {date}"), addenda (PRD main 459, 725).
- The records made at the visit: its referrals, problems, allergies and problem notes, whichever
  chart they are on, each opening where it can be entered in error. A visit moved to another
  patient leaves them with the first (4.3, 12.1 #25), and this list is how the clinician finds
  them.
- Actions, each shown only when the server would accept it: **Add addendum**; **Correct** on an
  answer, for the acting author; **Reopen**, for a note waiting for a co-signer that was never
  signed; **Co-sign** and **Attest**, online only, greyed with "Connect to co-sign" offline.
  A note the person cannot co-sign or attest because it holds something they may not see says
  so: "This note has a part you can't open. Ask a Program Admin."

**The correction sheet**: the field's label and current value, the field's own input for the new
value, a reason (3 to 500 characters), and a switch "The patient asked for this change". With
the switch on, a second choice appears: **Make the change** or **Record that it was declined**.

**The addendum sheet**: one text box of up to 4,000 characters.

Offline reads are logged on the phone in the same local transaction (`encounter.viewed`,
`note.viewed`, 1.2), and refused if they cannot be logged.

As built (the phone's domain layer, unit L4, `encounter_repository.dart` and `encounter_api.dart`,
with its review):

- **Where a visit is read from**, in this order, decided as built: `EncounterApi.openVisit` reads
  the phone's own copy (`EncounterRepository.openVisit`), else the chart's cached recent visit
  (`recentVisit`), with signal or without, else the server's read (`readVisit`, shown from memory:
  the phone keeps nothing of it); offline the last says "This visit isn’t on this phone. Connect to
  open it.". The cache is fetched again each time the chart opens online (5.2), so it is as old as
  the chart on screen, and Co-sign and Attest read the visit online first (5 as built), so nothing
  is signed from it. `EncounterApi.openVisit` keeps this order, but no screen reads through it now:
  since the review of unit L5 the visit screen reads the server's visit first, online (below; the
  coordinator's decision on findings SRD-3 and SRD-4, which amends D112's order).
- **One read model** (`VisitView`, `NoteView`) whatever the source: `visitFromRead` turns the
  server's read, or a cached recent visit, into the read model the phone's own read gives, with the
  server's laid-out note (`read`), each note's recap lines (`VisitNote.recap`, D108), the Red flags
  note last (forms 6.2), and no answers: a draft the person may change opens from the phone's copy,
  as the form. A note whose definition the phone can't load keeps its read model.
- **Who and when** (D108). A visit's notes come in the order the server made them (`createdAt`,
  compared as text to the microsecond, never through milliseconds, then by ID as text, as the visit
  read orders them), then those made here and not confirmed yet, in the order made. A sign-off, an
  addendum and a correction go by when it was made (`signedAt`, `writtenAt`, `correctedAt`), then
  those confirmed with no time known by ID, then those waiting here. The server asks
  `hiddenCorrections` of corrections in the order it applied them, the phone in the order they were
  made: that changes only the states the undo chain passes through, and each correction's own are
  asked either way, so the review found no case where a reader is shown something different. Whoever
  acts as a note's author, a sign-off's signer, a correction's corrector and an addendum's author
  are named by the name the record carries (`actingAuthorName`, `signerName`, `correctorName`,
  `authorName`), else by the phone's name hook, else, for a record of the reader's own (one made
  here carries no name until a refresh), by their own display name; the screen words a name still
  unknown "a teammate". The original author of an assigned note is not named, and a clinician
  renamed since signing may show under both names in one visit (D108).
- **What each reader sees** of the phone's own copy is 6.4's, as the sync read gave it: a note the
  reader may not read is left out with all that hangs off it; a reader of no Medical notes gets no
  Medical note, and of a Medical visit neither the assessment nor the visit's own addenda; a
  correction is shown whole or not at all (`hiddenCorrections`, a Dart copy of the server's, 5.1);
  whoever acts as the author of a draft gets every answer stored, those a condition hides included;
  an empty draft is not listed, but opens for its own author (the form of a note just added). A
  note whose definition the phone lacks is listed for whoever acts as its author, with its state and
  nothing of its answers, and left out for everyone else, as the server leaves out a note it cannot
  lay out. A reader without `patients.view` is not refused on the phone: the sync read that filled
  the phone needs only `encounters.chart` (6.1). Nothing is read while the store is frozen, and a
  read never waits for the clock check. Each read is logged as 10.1's table for the phone says.
- **The records made at the visit** come in two shapes (the coordinator's decision): for a visit
  the phone holds, `VisitRecords.madeAt` (8.4 as built); for a server read or a cached recent visit,
  the server's snapshots (`VisitView.records`). The visit screen (L5) draws both, and words "on
  another chart now" for a record whose visit has moved to someone else (8.4).
- **The actions**: reopen, addenda and corrections as 3.6 as built; Co-sign and Attest as 5 as
  built, on a visit read from the server.

As built (the screens, unit L5, `apps/mobile/lib/features/encounters/visit_screen.dart`,
`correction_sheet.dart` and `addendum_sheet.dart`, with its review):

- **Where the visit is read from** (the coordinator's decision on review findings SRD-3 and SRD-4,
  amending D112's order). The visit opens at `/encounters/<id>/visit` (fixed title "Visit"), from the
  timeline, Notes to finish or a queue, under `/encounters/` so that leaving the visit's screens
  (Save & Close, Complete) takes it with them. Online (the sync controller's last outcome found
  signal), it asks the server's read first, as it opens, within a short limit (`serverReadLimit`,
  six seconds, a constant), unless the visit was made here and its create still waits, which nobody
  else can have added to (`othersMayHaveAdded`). What the phone holds of the visit and has not sent
  is drawn over that read (`withWaiting`): a note the person has work of their own in (a draft they
  may change, a note not yet synced, finished or changed here and waiting to send, sent for review,
  an answer waiting or in conflict) is the phone's copy, with the server's hash, its co-sign and
  attest answers and its reason; a note made here that the server lacks is added; each note's
  sign-offs, addenda and corrections waiting here, and the visit's own addenda, go beside the
  server's; an envelope field changed here is the phone's; the visit's state is worked out again
  over the notes shown. The rest is the server's, so a teammate's notes, co-signatures and
  attestations made elsewhere show on a visit the phone holds, and a queue row opens a visit that
  offers Co-sign. As first built a visit the phone held was read from its copy alone: a queue row
  opened it without the teammate's waiting note and with nothing to co-sign, and a co-signature made
  elsewhere never showed (SRD-3, SRD-4). The partial copy an addendum or a correction brings onto
  the phone (the visit and one note) is drawn over the server's read the same way online, and
  offline shows with the line below: this decision took the place of the fix to `openVisit` first
  decided for that copy.
- **Offline**, or when that read fails or comes too late: the phone's copy, else a chart's cached
  recent visit (looked through only when the phone holds no copy), with "This is the copy on this
  phone. What others added since may be missing." (not for a visit made here whose create still
  waits); with neither, the read's failure is said ("This visit isn’t on this phone. Connect to open
  it." without signal). The server is asked once, as the screen opens: it is not read again by itself
  when signal returns (the coordinator's decision).
- **What is logged.** Each record shown is logged once, in the transaction of the read that shows
  it: the server logs its own read (5.1), and the phone's read under it logs only what that read did
  not show (the records made here among them); a chart's recent visit is logged on the phone (10.1).
  A visit read from the phone is read again after every change, logging only what a read adds. Over
  a server read, a change reads the phone's copy again and not the server, which is asked again only
  after the person added to the visit (once a sync has sent it) and for Co-sign and Attest.
- **The envelope** is one heading (who, the kind, "Started …", "time not verified", the place), then
  the assessment and the visit's own addenda. A patient the phone does not hold is named by the
  read's `preferredName` (decided work of the review; as first built "No name recorded").
- **Each note** is one node for a screen reader: its title first, then its state, "By {name}" and
  each recap line as nodes of their own (review finding SAX-2: the state and the recap were heard
  before the title). It shows its state, recap and read view; a draft the person may change is a
  button to its form, and the person's own draft that only the server's read gives offers **Open the
  note**, which brings it onto the phone first (`fetchNote`), as Notes to finish does (SRD-5). "By
  {name}" names whoever acts as an assigned note's author, never its writer (D108; SRD-10). A note
  that waits for someone other than the reader says why under it, from the read's `heldBecause`, in
  the portal's words (9.11): "You wrote this note, so someone else has to co-sign it.", "This note
  was assigned to you, so someone else has to co-sign it." (an assignee is never told they wrote
  it), "You completed this note, so …", "You signed this note, so someone else has to attest it.", or
  "This note has a part you can’t open. Ask a Program Admin." (decided work of the review).
- **The trail** below each note, in the order made, each line with the person, their credential in
  words and the time, "Waiting to send" or "In Needs attention" while it is the phone's own. The
  design gave only "Signed by …" and "Attested by …"; the builders' lines are "Completed by …",
  "Co-signed by …", "Completed again by …. The note was already finished, so nothing changed.",
  "Addendum by …", "Corrected by …: {answers}", "Corrected at the patient’s request by …", "The
  patient asked to change {answers}. Declined by ….", "Correction by …: nothing changed.", "Correction
  by …: not made, as only the note’s author can correct it." and "Changed in the draft by …", each
  with its reason ("Reason: …") or an addendum's text under it. The old values are struck through in
  the read view itself, which marks only `corrected` ones. A sign-off whose effect is `none` reads
  "The note was already finished", though `none` also covers `not_author`: the read model carries no
  reason for it (a review note, left as built).
- **Records made at the visit.** "On another chart now" is the server read's own answer
  (`recordsOnAnotherChart`, by the patients' canonical charts); for a cached copy older than that
  answer, and for the records the phone reads itself, it is the visit's patient's merged group as the
  store knows it (its canonical patient), so a record under a merged ID of the same person is on the
  same chart (decided work of the review). A problem and a problem's note open the problem's screen,
  an allergy the chart's Allergies; a referral the phone reads itself (held, or listed by a kept
  chart) opens the Referrals sheet of its patient's chart (9.10), where it is entered in error, and one
  the server's read gives opens its chart.
- **Add or remove notes**, to a person who charts: the encounter screen of the visit (9.4), where Add
  another note type, Remove this note and Switch to Medical are; a visit the phone does not hold, a
  teammate's, is brought onto it first (`openServerRecord`), which needs signal. As first built
  nothing led back to the encounter screen once the person had left it (review finding SFL-4).
- **Show handoff** under a Red flags note the phone holds whose `show_handoff` action shows, draft or
  finished (9.8).
- **Reopen** is asked first ("Reopen this note?") and opens the form; it is offered only on a note
  the phone holds (13, "Not built in this phase"). **Correct** brings a note that has left the phone
  back first through the domain layer's `holdNote` (the visit and the note, as the correction itself
  would; decided work of the review, where the screen had called `openServerRecord` itself), then
  reads it with what the screen had shown, so the sheet starts from its answers and the versions the
  person reads, and the read logs only what is new (SRD-9); offline that says the action needs a
  connection.
- **The sheets.** The correction sheet draws each answer with the renderer's own field (`FieldHost`,
  a grid's cell bare), its heading, its "Now: …" line and its field each a node of their own (SAX-5),
  adds others from the note's read view, up to ten, and, when `correct` refuses `incomplete`, asks
  for the answers it names under "Needed with this change". With "The patient asked for this change"
  on, its button becomes **Make the change** and **Record that it was declined**. The addendum sheet
  is one private box of up to 4,000 characters, counted as the server counts them. Each sheet sits in
  a gate of its own (`SheetGate`), since a sheet is not under the screen's: it hears the sync
  controller and the services, shows only why once the store freezes and nothing once the database
  closes, so an answer being changed leaves the screen with the rest (phase 3's V1; review finding
  SFL-3, where the answers stayed on screen after a freeze).
- **Co-sign** and **Attest** sit at the end of the visit, the sentence of 3.5 above the button, and
  are decided in one function (`secondActOffers`: the domain layer's `cosignPlan` and `attestPlan`,
  4.8 as built). On the server's read they offer exactly the notes it marks `canCosign` or
  `canAttest`, each with the hash it gives, and name under a note held for a part the person can't
  open why it waits (decided work of the review; before, the phone worked the offer out by its own
  copy of the rule). A copy read from the phone or a chart says nothing of it: the phone's own rule
  only decides whether to offer a plan that reads the visit from the server first, the first tap
  reading it, the screen saying "This is the visit as it is now. Read it, then co-sign." and the next
  tap signing what was read (the coordinator's decision). With the server's read first, that is a
  visit whose read failed as it opened. Either is offered only to a role that charts with a saved
  credential that signs or attests, which only narrows: a credential raised on the server reaches
  the phone at its next opening or unlock (8.2 as built). Offline the button is greyed, "Connect to
  co-sign"; a tap that meets no signal says "Connect to co-sign.".

As built since the phase's review (finding PA-5): Co-sign and Attest send the server's hash of the
note as the server holds it, so a note `withWaiting` draws from the phone's own copy (the person's
own work on it: an editable draft copy, answers waiting to send, an open choice, a Complete not
confirmed), and every note while the phone's own patient or assessment is drawn over the server's,
carries no `contentHash`, `canCosign` or `canAttest`. Where the server's read would have offered
either act, the note says "Send your changes first, then read the visit again." in place of the
act (`NoteView.sendFirst`). Tested for both acts in `test/encounters/visit_overlay_test.dart` and
on the screen in `visit_online_test.dart`; the patient branch, a note drawn under the phone's own
patient, has a case of its own (review finding VS-2).

As built since the phase's review, the screen's other fixes: a refusal said after a press, under
the notes, under a note or above Co-sign and Attest, is a live region keyed by the press, so the
same refusal twice is said twice, each held by a test that fails without it (findings PX-2, PX-6,
VX-7, C-5); while the server's read is waited for, up to six seconds, the spinner says “Loading the
visit” (PX-7). The correction sheet brings its own `DialogGateScope`, so a note's date or time
picker opened from it closes on a freeze (VA-3), and removing an answer from it sends focus to
Correct another answer (PX-5, VX-5; the opening of 9).

### 9.8 The EMS handoff

Red flags answered Yes opens the EMS branch in the form (forms part). When EMS is activated, the
form offers **Show handoff**. It opens a full-screen page built by the forms part's
`handoffLines`: large text, high contrast in every theme, no app bar actions, **Done** at the
bottom. It has no copy and no share (PRD main 413), and its text cannot be selected. Showing it
is logged (`ems_handoff.shown`). It works offline. It is built for EMS's reader, as the file is
(5.7, D94): no note of a sensitive type and no sensitive exam's findings, whoever shows it.

As built (unit L5, `apps/mobile/lib/features/encounters/handoff_screen.dart`, with its review):

- **Where it is offered.** **Show handoff** opens `/encounters/<id>/handoff` (fixed title "EMS
  handoff"), full screen over the visit's screens, wherever EMS was activated in a Red flags note the
  person may read: on the note's form, one they can't change now included (a teammate's draft,
  charting paused for the clock), and on the visit screen under such a note the phone holds, draft
  or finished, by the test the server's export uses (`offersHandoff`, a Dart copy of `handoff.ts`'s,
  asked of the phone's copy of the note). Showing it is a read, so it waits for nothing (review
  finding SRD-2, which also covers the decided offer for a finished note; forms 10.1 #51 as built).
  As first built it was offered only on a form the person could change. A visit the phone does not
  hold is not offered it, though the server's read can say it has one (`hasHandoff`): the page reads
  the phone's copy only (13, "Not built in this phase").
- **What it shows.** Its lines are `handoffLines` over each note as `emsReader` (the server's
  `EMS_READER`) sees it, of what the person showing it sees too (`sentToEms`, the server's rule), so
  a note of a sensitive type is neither shown nor named; each note's lines sit under its title and
  state, as the file has them, each line a node of its own under its note's heading, so a screen
  reader hears them in that order (review finding SAX-2). It is headed by the patient's preferred
  name alone, from the team's index or the chart the phone holds, else "No preferred name recorded",
  as D93's file heads it, never their description (review finding SRD-1: a patient with no preferred
  name was headed by what they look like), then their age in years and allergies, worded as the
  file words them (12.1 #27); a visit with no patient, "No patient recorded". A visit the phone does
  not hold says "This visit isn’t on this phone. Connect to open it."
- **Its log.** The domain layer's `openHandoff` reads the phone's copy, as `openVisit` reads and logs
  it, and writes `ems_handoff.shown` on the visit with its patient in the same transaction (decided
  work of the review; as first built the screen wrote the event itself, in a transaction after the
  read's), so a showing that can't be logged shows nothing, and nothing shows while the store is
  frozen.
- **How it looks.** Day draws it in the High contrast theme and Night run in its own, every word in
  full ink, measured at 7:1 or more; there is no back arrow and no action, only **Done** and the
  system's back, and no text can be selected.

### 9.9 Home: notes to finish, and the queues

`apps/mobile/lib/features/home/home_screen.dart` gains tiles under Needs attention (PRD main 744):

| Tile | Shown to | Says | Opens |
|---|---|---|---|
| **Notes to finish** | anyone with a draft they act as the author of | "3 notes to finish. 1 is older than a day." | A list: patient's preferred name, note type, when the visit started. A row opens the note. A draft that is not on this phone needs a connection. |
| **Waiting for your co-signature** | a credential that signs | The count when online; "Connect to see notes waiting for you" offline | The co-sign queue |
| **Waiting for attestation** | a credential that attests | The same | The attestation queue |

The tiles' numbers come from `GET /v1/me/counts` when online (5.6), which names no patient.

The queues list one row per visit: the patient's preferred name, the note types that wait, the
author and the date. A row opens the visit (9.7) with **Co-sign** or **Attest** at the bottom
and the sentence of 3.5 above it. One tap signs or attests every waiting note of the visit that
the person may act on. If a note changed since the visit was loaded, the screen says "This visit
changed. Read it again." and loads it again.

As built (the phone's domain layer, unit L4, `apps/mobile/lib/encounters/notes_to_finish.dart` and
`encounter_api.dart`, with its review):

- **The list** (`NotesToFinish.open`) is the drafts on the phone the person acts as the author of,
  each not empty and not finished here or sent for review: such a note waits for no one, though the
  server lists it as a draft until it syncs. A draft is overdue a day after its visit started, by
  the phone's corrected clock (3.9). Online, the server's list (5.6) adds the drafts that are not
  on this phone, which open only with signal, and its word on overdue wins, since it knows when it
  received a visit whose start the phone could not verify; for a note the phone holds, the phone's
  copy wins otherwise. Oldest visit first. A row names the patient as the team's index or the chart
  the phone holds names them, and the note type by the team's list.
- **Its log**: `notes_to_finish.viewed`, with `patientIds` and `resultCount`, in the transaction
  that reads the list, for the rows a read adds; at most 50 patients an entry, so a longer list
  writes several, each with the whole count. The phone logs the server's rows again, though the
  server logged its own read: a double log is safer than a missing one.
- **The tile** (`NotesToFinish.count`, which `homeTiles` takes) names no patient and logs nothing.
  Without the server's counts it is the phone's own. With them it is the server's count, plus the
  phone's drafts the server can't have counted, less those it counted that are finished or emptied
  here (the coordinator's decision): the exact merge would need the list, which logs patients. A
  draft counts as one the server counts when it is a draft there with an answer written there.
- **The co-sign and attestation tiles** show to a role that charts with a credential that signs, or
  attests, with the server's numbers, and none offline (the table above).

As built (the screens, unit L5, `notes_to_finish_screen.dart`, `queue_screen.dart`, `home_tiles.dart`
and `apps/mobile/lib/features/home/home_screen.dart`, with its review):

- **The tiles** (`EncounterTiles`) sit under Needs attention. Notes to finish's reads "1 note to
  finish." or "3 notes to finish. 1 is older than a day." and shows while there is one; the queues'
  read their title over "2 visits" ("None waiting" at none), or "Connect to see notes waiting for you"
  offline. Online a queue's tile shows only when the server's counts carry its number, so the
  server's word wins over the credential the phone saved (5.6 gives no number for a list the person
  may not open; review finding SRD-6, where the tile said "Connect to see notes waiting for you"
  online); offline the saved credential decides. The server's counts are asked when Home shows, at
  the end of each sync and when Home is on top again; a change made here counts the person's drafts
  again against the server's last answer. Nothing shows while the store is frozen.
- **Notes to finish** (`/notes-to-finish`, title "Notes to finish"): each row reads the patient's
  preferred name ("No patient" for a visit with none), the note type, "Visit started …" and "Older
  than a day", "On this phone only" or "Opens with a connection" where they apply. The server's list
  is asked when the screen opens and when it is on top again; a change or a sync reads the phone's
  copy again with the server's last answer. Offline the list says "Showing the notes on this phone.
  Connect to see the rest." A draft not on this phone is brought from the server first (its visit,
  then the note, `fetchNote`), and without signal the screen says "This note isn’t on this phone.
  Connect to open it." under the row tapped, in sight of it (review finding SAX-11: it showed at the
  head of the list). The drafts it lists are not held out of the close sweep (the coordinator's
  decision): a draft the sweep closes leaves the list at its next read, and opens again online.
- **The queues** (`/queues/cosign` "Waiting for your co-signature", `/queues/attestation` "Waiting for
  attestation"): each row reads the patient, "Visit started …" and each waiting note as "{type}, by
  {author}", with "Signed before by …" or "Attested before by …" after a correction, and, for a note
  the person can't act on, why, from the queue's own reason (`heldBecause`, 5.4), in the visit
  screen's words (9.7: "You wrote this note, so someone else has to co-sign it.", and so on), or,
  when the server gives none about the note, "Someone else has to co-sign this note." (decided work
  of the review; as first built it said "You wrote this note." of every note of the person's own,
  an assigned one included, and "You can’t co-sign this note. Open the visit to see why." of the
  rest). A row opens the visit (9.7), which online reads the server first, so a visit the phone
  holds shows the teammate's waiting note and offers Co-sign. Asked when the screen opens, when it is
  on top again and on pull to refresh; offline it shows the domain layer's sentence and **Try
  again**.
- **Since the phase's review.** A refusal said after a press, the queues' Try again's and a Notes
  to finish row's, is a live region keyed by the press, so the same one twice is said twice, and a
  queue's sentence offline is a live region too, each held by a test that fails without it
  (findings PX-2, PX-6, VX-7, C-5); a queue's tile says its count once, held by a test (PX-5); and
  while a list is read the spinner says “Loading the list” (PX-7).

### 9.10 Referrals (phone)

A sheet from the profile or the summary screen: the past referrals (7), then **Add referral**: a
date, today by default, and a details box of up to 2,000 characters. A row's menu has **Entered
in error**, which asks for a reason.

As built (unit L4): the sheet's list, **Add referral** and **Entered in error** are `Referrals`
(7 as built), whose `mayAdd` and `mayEnterInError` say what the sheet offers and whose refusals
are worded there; the sheet itself is L5's.

As built (the screens, unit L5, `referrals_sheet.dart`, with its review): `showReferrals` opens the
sheet from the profile's + Referral, a referral's row on the timeline, one at the visit (9.7) and,
since the review, the summary's Add referral, which gives it the visit, so a referral added there is
made at it (decided work of the review; 9.6). Each row reads its date, its details, "Recorded by …",
"At a visit", and "Waiting to send" or "In Needs attention" while it is the phone's own; one entered
in error stays, struck through, with "Entered in error: {reason}". "Recorded by" names the recorder
by the name the server gives the record now (`attributes.authorName`, 5.2 as built, through the
domain layer's `user.nameFor`, held or listed from a chart), else one the phone knows; "a teammate"
only where neither names them (decided work of the review: as first built every teammate read "a
teammate"). **Entered in error** asks for the reason in a dialog of its own, built on `AskDialog`
(9.3 as built) so its buttons scroll with its body and are reached at 200% text on a 320 px phone
(review finding SAX-9), marks the referral from there and shows a refusal there. **Add referral** is
below the list, to a role that may add one, and the sheet stays open on the list after it. What the
sheet did is said inside it, as a live region, "Referral added" under Add referral and "Marked
entered in error" under its heading: a SnackBar drawn under a sheet that stays open was neither seen
nor heard (review finding SAX-6). Add referral from a note's action keeps its own sheet
(`showAddReferral`), which closes once the referral is added.

Since the phase's review (finding PX-3, the coordinator's decision that D92 covers every date the
phone takes): Add referral's date, "Date referred", today by default, is the forms' typed date
(forms 8.2), three private boxes with the calendar alone beside them, in place of a date line and
Material's picker, whose typing box let the keyboard learn. The calendar closes on a freeze
(`DialogGateScope`, D125). A date typed and not yet saved is saved as Add referral is pressed; one
the boxes can't save (half typed, no such day, after today) adds nothing, and the sheet says "Fix
the date first: what’s typed can’t be saved."; cleared, it asks for a date. The date is saved by
taking focus out of its boxes only when focus is in them (`commitTypedDate`), so focus pressed on
Add referral or Change the date stays on it, refused or not (review finding VX-1); and each press
keys its refusal anew, so the same refusal twice is said twice (VX-2). A referral's **Entered in
error**, with the reason typed in it, closes on a freeze too (PP-1; the opening of 9).

### 9.11 Portal: the visit page

`apps/portal/src/app/(app)/encounters/[encounterId]/page.tsx`, linked from the patient page's
new Timeline section (links carry `prefetch={false}`,
`apps/portal/src/lib/patient-links.test.ts`). It shows what 9.7 shows, read-only, from
`GET /v1/encounters/{encounterId}`. Its actions: **Co-sign**, **Attest**, **Assign** (9.12) and
**Export EMS handoff (PDF)** when the visit has one; the export asks for a fresh sign-in first
(5.7). The page title is "Visit". Under the patient page's first 50 visits, **Show earlier
visits** loads more (5.2).

As built on the server (unit L2), what the page has to work with; the page is unit L6's:

- The visit read gives each note's `contentHash` to whoever may co-sign or attest it and sees
  all of it (5.1). **Co-sign** and **Attest** send every waiting note of the visit the person may
  act on, each with that hash, and a 409 loads the visit again (5.3, 5.4).
- "When the visit has one" is the route's to say: a visit has a handoff once EMS was activated
  in it, and the route answers 404 `no_handoff` otherwise and 403 `cannot_see_red_flags` to a
  reader who may not read the Red flags note. The page shows both as states, not errors.
  `reauth_required` sends the person through `/reauth` first.
- The page sends the browser's time zone as `timeZone`, so the file's times are where the reader
  is, takes the answer as a file, and keeps the file's name the route gives, `ems-handoff.pdf`
  (5.7).

As built on the portal (unit L6, with its review; `apps/portal/src/app/(app)/encounters/`, its
words in `apps/portal/src/lib/encounters.ts` and `sign.ts`):

- **One read, and no rule of its own.** The page reads `GET /v1/encounters/{encounterId}` once a
  load and shows what it answers for the reader (6.4): what it offers and why a note waits are
  the read's (`hasHandoff`, `canCosign`, `canAttest`, `heldBecause`, `recordsOnAnotherChart`, 5.1).
  For a person with `team.manage_users` it also asks each note's assignees route (9.12). An ID that
  is not a UUID, and a visit the team does not have, give the not-found page; a role without
  `patients.view` goes Home, with the alert a typed address to a screen it can't use gets.
- **Top to bottom.** "Visit"; "{preferred name} · Medical or Non-Medical · {start}", by the name
  the read gives ("No name recorded"; "No patient recorded" for a visit with none) and with "time
  not verified" when the phone's clock wasn't checked; **Open the chart**, for a visit with a
  patient; the sentence the page came back with (below); **About the visit**: the patient, the
  start, the place ("Not recorded"), the kind, the assessment when the read gives it (a Medical
  visit's is absent to a reader of no Medical notes, and nothing says it is there) and the visit's
  own addenda; **EMS handoff**, when `hasHandoff`; one article per note, named by its title, in the
  read's order (the coordinator's decision: the phone puts the Red flags note last, which the read
  does not mark); **Recorded at this visit**; then **Co-sign** and **Attest**.
- **A note.** Its state as 3.1 words it; "Written by {name}.", with "Assigned to {name}, who acts
  as its author now." when it was assigned; why it waits for someone else, from `heldBecause`:
  "You wrote this note, so someone else has to co-sign it." (or attest it), "This note was
  assigned to you, so …", "You completed this note, so …", "You signed this note, so someone else
  has to attest it." and 9.7's "This note has a part you can’t open. Ask a Program Admin."; its
  recap lines as the read gives them, without the section's title, which each line's own label
  already says (a line's words, "label: value", are the forms part's, a question for the clinical
  team); its sections ("Nothing was recorded in this note." when the reader is shown none); and
  **Sign-offs and changes**, in time order. "No notes to show." when the reader is shown none.
- **The trail's words**, where 9.7 gives none: "Co-signed by …", "Completed by …", "Saved unsigned
  for a co-signer by …", "Sent again by …, {date}. It changed nothing.", "Addendum by …", and a
  correction's by its outcome ("Corrected by …", "Corrected at the patient’s request by …",
  "Amendment request declined by …. The note is unchanged.", "Correction by …. The note already
  held those values.", "Changed by …, while the note was a draft again", "Correction sent by ….
  Not applied: they don’t act as the note’s author."), with its reason; a credential that is none
  is left out. A corrected answer's old value is struck through and hidden from a screen reader,
  which hears "Replaced: {old}", with who changed it, when and why; an answer a correction took
  away says "No answer now" to a screen reader alone.
- **Recorded at this visit**: the referrals, problems, allergies and problems' notes made at it, in
  that order, each struck through with "Entered in error" when it was, "On another chart now" when
  `recordsOnAnotherChart` names it (never by comparing patient IDs, which a merged ID of the same
  person would fool), and **Open the chart**, or **Open that chart**, to the chart it is on.
- **Co-sign and Attest.** Each section shows when the read marks a note for the person: the notes
  it covers by title, under "Co-sign signs these 2 notes with your name and credential:" or
  "Attest adds your dated attestation below these 3 notes, and changes nothing in them:" (PRD main
  216); 3.5's statement as written, once for the press, even when it covers several notes (its
  wording is counsel's question, 12.1 #5); and the button. A press posts the plan, each marked
  note's ID with the hash the read gave, to `POST /encounters/{encounterId}/sign`, which adds the
  statement's version (`cosign-2026-11`, `attest-2026-11`) and calls the API. The browser then
  loads the visit again, whole, with `?signed=cosigned` ("Co-signed. Your co-signature is on each
  note below."), `attested`, `changed` (9.9's "This visit changed. Read it again."), `cannot_sign`
  ("Your credential can’t co-sign notes now.") or `cannot_attest`. A 409, and a 403 `is_author`,
  `is_signer` or `cannot_see_all` (a note that became the person's since the read, or holds a part
  they can't open now), load it as changed, and the note then says why; the API's own message is
  never shown.
- **The plan sent is the one read.** Co-sign and Attest are rendered for each act on every render,
  with a plan or none, and keep the first render's plan, none included, for the life of the page.
  A server action (Stay signed in) renders the page again from a fresh read; when that render's
  plan differs, none to a plan included, the section says at once "This visit changed. Read it
  again.", with a link that loads the visit whole, and a press sends nothing and loads
  `?signed=changed` (review finding PRD-2, the coordinator's decision). Every load after an act is
  a whole one: a client navigation would keep the plan held.
- **After a press.** The button stays off, reading Working…, from the press until the next page
  replaces it (PAC-1). A problem shown in place takes focus, each time it comes (PAX-1). When the
  connection drops, the page can't tell whether the act went through: it says so ("The connection
  dropped, so we can’t tell whether your co-signature went through. Read the visit again to see.")
  and offers **Read the visit again** in place of the act (PAC-4). Assign does the same. Since the
  phase's review (finding PX-4), the notice a whole load brings back after an act or `/reauth`
  (`?signed=`, `?handoff=`, and `?assign=` when it names no note on the page) is a status region
  that takes focus as the page opens (`PageNotice.tsx`, 9.12 as built), since one already there at
  load is not announced.
- **Export EMS handoff (PDF)** is a plain form posted to
  `POST /encounters/{encounterId}/ems-handoff`, with the browser's time zone filled in as it is
  sent and passed on only in a zone's shape. The handler gives the API's file back as an
  attachment, under the API's name, `no-store`, and the page stays as it was, not read again. When
  the API asks for a recent sign-in, the browser goes through `/reauth` and back to
  `?handoff=reauthed` ("You confirmed it’s you. Export the handoff again."), and the person presses
  Export again: nothing downloads by itself (the coordinator's decision). `no_handoff` and
  `cannot_see_red_flags` come back as states, in the API's own sentences, and any other failure as
  `?handoff=failed`. A Red flags note changed after the page was read may bring the visit back
  with no export offered rather than in the `no_handoff` state; nothing is exported either way
  (the coordinator's decision).
- **Route handlers, never server actions.** Every server action re-renders the page it is called
  from: the proxy saves the session cookie on every request, as phase 1 built it (kept, the
  coordinator's decision), and Next, seeing a cookie set by an action, has the browser refresh the
  page. An action would read and log the visit again, or the chart with each page of earlier
  visits, for a render the browser then throws away. So the export, Co-sign and Attest, Assign and Show earlier visits
  post to route handlers (`ems-handoff`, `sign` and `assign` under the visit, and
  `/encounters/earlier`), whose JSON answers are `no-store`. Each takes a POST from the portal's
  own pages only (`sameOrigin`, `apps/portal/src/lib/same-origin.ts`: `Sec-Fetch-Site`
  same-origin, else an `Origin` of this host, or `null`, which the portal's no-referrer policy
  makes its own forms send); another site's is 403, and a GET of the export 405. The handlers and
  every page's `unwrap` share one table of the refusals that send the person to sign in, pass
  MFA, choose a team, confirm it's them or go Home (`apps/portal/src/lib/refusals.ts`).
- **An idle session** is refused by every read and act, the proxy's gate or not: `api()` asks the
  session's idle state too, since the gate skips a request that says it is a prefetch (PAC-2).
- **The patient page's Timeline**, after Problems: **Visits**, newest first, each "Visit on {date}"
  with its kind and its notes as "{title}: {state}" ("No notes to show" when the reader is shown
  none), linking to its page with `prefetch={false}`; then **Referrals** (7 as built). Visits and
  referrals are two lists, with no type filter: the PRD's chips are the phone's (9.1; the
  coordinator's decision). Under a full page of 50, **Show earlier visits** posts the last visit's
  ID to `/encounters/earlier`, which reads the timeline route (`chart.timeline_viewed`), and focus
  goes to the first new visit, or, when none came, to the Visits heading, saying "No earlier
  visits."; a failure is an alert that takes focus each time. The chart read carries no visit in
  full, and logs none (5.2).

### 9.12 Portal: notes not complete, and assigning

- Portal Home gains a count for a Program Admin: "4 notes not complete. 2 are older than a day."
- `apps/portal/src/app/(app)/team/incomplete-notes/page.tsx` lists every draft: the patient, the
  note type, the author, when the visit started, and "Older than a day". A draft whose author has
  left says so and has **Assign**.
- **Assign** is a form on the visit page: a clinician picker that lists only members who pass the
  checks of 5.5, and a reason.

As built (unit L6, with its review; `team/incomplete-notes/page.tsx`, `home/page.tsx`, and the
visit page's `AssignForm.tsx` and `assign/route.ts`; its words in
`apps/portal/src/lib/worklists.ts` and `assign.ts`):

- **Home** asks `GET /v1/me/counts` once, on Home alone, and shows a card for each number it is
  given: for `team.manage_users`, **Notes not complete**, "4 notes not complete. 2 are older than
  a day." from `teamIncomplete` and `teamOverdue` (5.6), or "No notes are incomplete."
- **Notes not complete** (`/team/incomplete-notes`, its title "Notes not complete") lists the API's
  list, oldest visit first, captioned "Draft notes, oldest visit first: 4 notes, 2 older than a
  day.": each note by its title; the patient, by the name the list gives; whoever acts as its
  author, the list's `author` ("No longer on the team" when they left); when the visit started,
  marked "Older than a day"; and **Open the visit**, **Open the chart** and, for a note whose
  author left, **Assign**, a link to its form on the visit page (`#assign-{noteId}`). No link
  prefetches, and each one's name tells its row apart: the note, "by" whoever acts as its author,
  the patient and "visit on" its start, two drafts of one type by one author at one visit
  numbered, "Outreach (1 of 2)" (PAX-5). No author filter: 5.6 keeps it for phase 7 (the
  coordinator's decision).
- **Without `patients.view`** the list names no patient (5.6 as built), and the page shows no
  patient column, no link and no Assign, since the visit page and the chart would refuse the
  person. It says that someone whose role opens patients' charts can assign a note from its visit,
  and that patients aren't named here (PAX-4). A typed visit, chart or export goes Home with its
  alert.
- **Assign** is a block in its note's article on the visit page, "Assign this note", not a named
  region or a form landmark: two notes of one type would give two landmarks of one name. For a
  person with `team.manage_users` the page asks the assignees route (5.5) of every note it shows,
  once a view, and offers Assign under exactly the notes it answers 200 for, whose acting author
  left; each 200 logs `note.assignees_viewed`, and a 409 nothing (the coordinator's decision). The
  picker lists exactly the route's answer, in its order, each as "{name}, {credential}", and the
  reason takes 3 to 500 characters, "Logged with the assignment." A problem found before anything
  is sent shows in a summary that takes focus and links to its field.
- **A press** posts the note, the person and the reason to `POST /encounters/{encounterId}/assign`,
  a route handler (9.11 as built), and the visit loads again, whole: `?assign=done` ("Assigned. The
  note names who acts as its author now, and they can finish or correct it.") or `author_active`
  ("Someone on the team acts as this note’s author now, so it can’t be assigned."). After the
  `/reauth` an assignment asks for, and after a pick the API refused because who may take the note
  changed (`assignee_not_member`, `assignee_cannot_chart`, `credential_too_low`,
  `cannot_see_all`), it loads at the note's own form,
  `?assign=reauthed&note={noteId}#assign-{noteId}` ("You confirmed it’s you. Assign the note
  again.") or `changed` ("Who may take this note changed. Choose again from the list."), which
  says so and takes focus (PAX-3). The button stays off while the next page loads, and a dropped
  connection says it can't tell whether the note was assigned (9.11 as built). Since the phase's
  review (finding PX-4), the notice at the top of the visit page that a full load brings back
  (`?signed=`, `?handoff=`, and `?assign=` when it names no note's form) takes focus as the page
  opens too (`PageNotice.tsx`), since a status region already there at load is not announced.
- **With nobody to offer**, the block says "Nobody on the team may take this note now. It needs an
  active clinician with the same or a higher credential, whose role can see everything in it, and
  any part of this kind of note that you can’t see.", as the rule asks: by what the note holds
  where the reader sees it, and by its type where they could miss it (5.5; review finding PRD-1,
  the coordinator's decision of Nov 20). Such a note stays in Notes not complete (PLAN-OPEN 12.1
  #31): on the standard roles a General / primary care note that holds a GU exam goes only to a
  Program Admin with the credential it needs, the one role that reads sensitive exams.
- **After an assignment** the note says "Assigned to {name}, who acts as its author now.", and,
  where it waits for a second person, tells the assignee "This note was assigned to you, so
  someone else has to co-sign it." (9.11 as built): never that they wrote it.

### 9.13 Needs attention (phone)

`apps/mobile/lib/features/sync/sync_labels.dart` gains one sentence for each problem of 4.1, and
`needs_attention_screen.dart` the buttons that settle each (4.1, 8.4). The sentences:

| Problem | Sentence | Buttons |
|---|---|---|
| `content_changed` | "This note changed after you completed it. Open it, read it and complete it again." | Open the note |
| `incomplete` | "This is missing something the note needs. Open the note and try again." | Open the note |
| `red_flags_first` | "Answer the red-flag question first, then complete again." | Open the note |
| `field_changed` | "Someone corrected this answer first. Open the note and check it." | Correct again (`correctAgain`); Leave it (`leaveIt`), both the domain layer's (3.6) |
| `medical_note_needs_patient` | "A clinical note needs a patient. Choose who this visit is for." | Choose a patient |
| `unknown_note_type` | "This note type isn’t on your team’s list. Choose the note type again." | Choose a note type |
| `definition_error` | "This couldn’t be checked. Tell a Program Admin." | none: a fault in a note type, which a new version fixes |
| `encounter_note_missing`, `note_signoff_missing` | "The note this belongs to isn’t on the team’s list." | as phase 3's missing-record card |
| `encounter_other_patient` | "The visit this names belongs to someone else." | Send without the visit; Choose a visit |

A sign-off that was held for a Program Admin shows on its note as "Sent for review" (4.8).

And seven notices, shown on Home as phase 2's notices are:

| Notice | Sentence |
|---|---|
| `note_saved_unsigned` | "Your credential can’t sign this note type. It was saved unsigned for a co-signer." (the existing sentence, `services/api/src/sync/apply.ts:34`) |
| `late_change_kept` | "The note was already finished. Your change was kept in its history. Add an addendum if it matters." |
| `change_not_applied` | "Only the note’s author can do that. Nothing was changed." |
| `signoff_not_applied` (a held sign-off that will not reach the chart, 4.6) | "Your Complete of this note wasn’t applied. Open it and complete it again." With **Open the note** |
| `correction_not_applied` (a held correction that will not reach the chart, 4.6, review finding VS-6) | "Your correction of this note wasn’t applied. Open it and correct it again." With **Open the note** |
| `finished_differently` (the phone's own, from a sign-off that found its note finished over other content, 3.4) | "This note was already finished with different content. Open it and read what was finished." With **Open the note** |
| `note_corrected` | "A note you signed was corrected. It needs your review again." |

As built (the phone's store, unit L3, with its review): `noticeLabel` in `sync_labels.dart` holds
the sentences of `change_not_applied`, `signoff_not_applied`, `finished_differently` and, since the
phase's review, `correction_not_applied` (`services/api/src/sync/review.ts`,
`correctionNotApplied`), each worded by its kind alone, with no state of the phone's.
`sync_labels_test.dart` holds the first three ("the notices of a note’s life are worded by their
kind alone (lifecycle 3.4, 9.13)"), and `needs_attention_test.dart` the fourth, with its Open the
note. The other notices' sentences, the problems' and the buttons come with the screens (L5). The
design first gave `change_not_applied` a second sentence on a note shown as "Sent for review"; told
apart by the phone's own record, it read "Only the note’s author can do that" on a second phone or
after a sign-out had erased the database, so the server now sends the held sign-off's notice under a
kind of its own (4.6, review finding SRC-2). `finished_differently` had no sentence in this design;
its wording is the coordinator's. A `signoff_not_applied` notice names the sign-off
(`ServerNotices.entityOf` gives `note_signoff`) and its note (`LocalNotice.noteId`, D104, built in
wave F; 4.8), so **Open the note** opens it on any phone, one that never held the sign-off included
(`openServerRecord`). The notice is filed under the patient of the sign-off's record when the phone
holds it, else under the note's patient when the phone holds the note (D107), and under no patient
on a phone that holds neither. What reads a notice's patient did not change: Needs attention's
notice card, whose **Open the chart** it gives (until L5's **Open the note**), and the ID card
screen, for its own card notices alone; no purge and no chart reads it, so a notice keeps no chart
on the phone. Completing the note again reads the notice on any phone, by the note it names (D107,
4.8), so it leaves Needs attention wherever the person did what it asked. A phone that fetches such
a notice only after it was read elsewhere keeps it read, and it still settles the held sign-off it
names there (4.8). `finished_differently` names the note.

As built (the screens, unit L5, `needs_attention_screen.dart` and `sync_labels.dart`, with its
review, and the domain layer's `refusal_fixes.dart`, 4.8 and 8.4 as built): every problem of the
first table has its sentence, and an answer its form refuses (forms 7.1's problems) reads "This
answer doesn’t fit the note’s form. Open the note and change it." Every notice of 4.10 has a
sentence: `note_cosigned`, `note_attested` and `note_assigned`, which this design gives none, read "A
visit you charted was co-signed.", "A visit you signed was attested." and "A note was assigned to
you to finish." (the builders' words, kept by the coordinator's decision). The cards:

- **A note's answer is named as its form names it** (review finding SAX-3, where a conflict showed
  the answer's key and its option codes or raw JSON). Needs attention loads the definitions of the
  notes it lists, once, and heads a conflict or a refusal on an answer by its label and the note's
  type ("Current needs, in Social needs"), each value worded by its options' labels, and a value
  with a shape of its own (a list, a group of parts) as "Open the note to see it". An answer the
  phone's copy of the definition does not name is headed by the note's type alone, its values as
  stored; while the phone holds no definition of the note, the card reads as phase 2's did. A
  conflict keeps phase 2's side-by-side choice, worded so, and adds **Open the note**, where the form
  shows the same choice.
- A refused sign-off (`content_changed`, `incomplete`, `red_flags_first`) and a refused change to a
  note (but `definition_error` and `unknown_note_type`) offer **Open the note**, the note's form or
  read view. **A refused answer settles once it is changed** (review finding SFL-1): a save of an
  answer whose set waits refused is that refusal's fix (`saveAnswer`, 4.8 as built), so the sentence's
  "Open the note and change it" is what settles it; as first built the new value waited behind the
  refusal for good.
- A refused correction offers **Leave it**, and **Open the note** unless it is `definition_error`;
  `field_changed` also offers **Correct again**. Leave it is offered for any refused correction: sent
  again as it was, one refused `incomplete` would be refused again.
- **The refusals that had no way out** (decided work of the review; 4.1, 8.4), each settled through
  the domain layer and the store's `fixRejected`, so the refused change is never dropped:
  `medical_note_needs_patient` offers **Choose a patient** (the `choosePatient` sheet), which gives
  the visit its patient and makes it Medical, then sends the note's create again, in one
  transaction; where the phone's copy of the visit names a patient already (its set still on its
  way), the button is **Send it again** and sends only the create. `encounter_missing` and
  `encounter_other_patient`, on a referral, a problem, an allergy or a problem's note, offer **Send
  without the visit** and, when the phone holds another visit of the record's patient, **Choose a
  visit**: a sheet (in its own gate, so a freeze takes it away) listing those visits by kind and start
  time, newest first, with no place and no name, the visit the refusal names left out; each visit
  listed is logged as `encounter.viewed` in one transaction as the sheet opens, and whether the
  button shows is decided without reading or logging anything. `unknown_note_type` offers **Remove
  this note** (as first built here; the review changed what it sends, below), asked first, beside **Choose a note type** (the visit's note types): the refused create
  is sent again as an empty draft, every answer cleared, on the version the team's list gives for its
  key now, which the server takes and counts for nothing (3.1), and choosing the type again opens the
  note on that version; the set of an answer sent in the same push, refused with the create
  (`record_missing`), settles with it. The person's answers are cleared, as decided: keeping them on
  the listed version would spare typing them again, and is an open question (13). It needs a listed
  version that holds every answer the phone keeps of the note; a type the team lists at no other
  version, or a refusal on the very version listed, is
  refused "This note can’t be removed on this phone. Tell a Program Admin." (`definition_error`) and
  stays in Needs attention until the store can withdraw a create the server never took (13, "Not
  built in this phase"). As first built `unknown_note_type` had only Choose a note type, which left
  the refused create waiting, and the other three only phase 3's **Open the chart**: none could be
  settled.
- Every button that writes waits for the clock ("You can choose once the phone’s clock is right."),
  and a refusal of the domain layer shows in its words.
- The notices `signoff_not_applied` (by the note it names, D104) and `finished_differently` (by its
  record) offer **Open the note** in place of Open the chart, the note fetched first when this phone
  holds none of it; without signal the screen says the note needs a connection.

As built since the phase's review (the coordinator's decisions on its findings):

- **Remove this note** (findings PS-4 and VS-3) sends the refused create again on a version the
  team lists now that takes every answer the phone holds of the note (`checkAnswer`, as the server
  checks each; `_carrierOf`), carrying those answers so they reach the server and its history, then
  blanks each as a set in the same transaction: the note counts for nothing, and nothing that never
  synced is deleted (4.1 as built). With no such version the card says “This note can’t be removed
  on this phone. Tell a Program Admin.” in place of the button (`canRemoveRefusedNote`) and nothing
  is sent; a type listed at no version stays, as D121 keeps it.
- **Change the date** (PS-3) settles a referral refused `referral_in_future`: a sheet in the
  sheets' gate whose date is typed in three private boxes beside the calendar alone, which sends
  the create again on the date chosen; focus and a repeated refusal behave as in Add referral (4.7
  as built, 9.10).
- **What waits on a refused sign-off** (PS-1, C-1). An addendum, an addition to the assessment or
  a correction refused only for naming a refused sign-off says “This waits for its note to be
  completed again.” and “It’s sent, as you made it, when you complete the note again. Open the note
  to complete it.”, and offers **Open the note**, a correction Leave it beside it; once Complete
  sends it again the card is gone (4.8 as built).
- **`correction_not_applied`** (VS-6), the notice that a held correction will not reach the chart,
  reads “Your correction of this note wasn’t applied. Open it and correct it again.” and offers
  **Open the note**, as `signoff_not_applied` does (4.6 as built, 4.10).
- **Once the store freezes** (PP-2, VX-6; D125) the screen shows the reason and how many changes
  are still on the phone (“1 change is still on this phone.”, “3 changes are still on this
  phone.”) in place of every conflict and refusal card; the notices, which hold no value, stay. It
  may say that something waits, never what.

### 9.14 Portal: the queues

`apps/portal/src/app/(app)/team/cosign/page.tsx` and `team/attestation/page.tsx`: the rows of
5.4, each opening the visit page. The navigation shows each link only to a credential that may
act. An attending's portal Home shows the attestation count (PRD main 216, 744).

As built (unit L6, with its review; both pages draw `team/cosign/SignatureQueue.tsx`, its words
in `apps/portal/src/lib/worklists.ts`):

- **The pages.** **Co-sign queue** (`/team/cosign`) and **Attestation queue** (`/team/attestation`),
  titled so, each with a line of help that ends "Opening this page is logged.", list the API's
  queue in a table captioned "Visits waiting for a co-signature, oldest first: 2 visits." (or
  "Visits waiting for attestation, …"), one row per visit, oldest first. A row's header is the
  patient, by the name the queue gives ("No name recorded", "No patient recorded"), a link to the
  visit page with `prefetch={false}` whose name adds ", visit on {start}"; then when the visit
  started; then its waiting notes, each by its title, with "Back after a correction. Signed before
  by {name}." (and "Attested before by {name}.") first when a correction sent it back (3.7), and
  "Written by {name}, completed {time}.". A note the person may not act on (`canAct` false) says
  why in the visit page's words, from the queue note's `heldBecause` (5.4; the coordinator's
  decision), so an assignee is told it was assigned to them; when no reason is given, "Someone
  else has to co-sign it." (or attest it). With nothing waiting: "No visits wait for a
  co-signature." The person acts on the visit page, never from the queue. A role or a credential
  the API refuses goes Home with its alert.
- **The navigation** shows **Co-sign queue** and **Attestation queue** (`queueLinks`,
  `apps/portal/src/lib/credentials.ts`) to a role with `encounters.chart` whose credential signs,
  or attests, as each queue's route asks, and **Notes not complete** with `team.manage_users`, all
  before Duplicates, each on one line of the 240 px sidebar. Which credential signs and which
  attests is a copy of those two columns of the API's credential table (`CAPABILITIES`), held to
  `permissions.ts` by a test that reads it (`credentials.test.ts`); it decides only which links
  show, while what a queue lists, what a press sends and why a note waits are the API's (the
  coordinator's decision). No page but Home asks for counts.
- **Home** shows a **Co-sign queue** and an **Attestation queue** card, each when the counts give
  its number (5.6): "1 visit waits for a co-signature.", "2 visits wait for attestation.", or "No
  visits wait for …".

## 10. Audit events and PHI rules

### 10.1 Events

Every event is written in the transaction of its action (`ctx.audit` in sync,
`services/api/src/routes` for online routes). Details carry IDs, counts, hashes, field paths and
names of rules. They never carry an answer, a summary, an addendum's text, a reason's text, a
referral's details or a name.

| Action | When | Details |
|---|---|---|
| `encounter.created`, `encounter.updated` | existing | existing, plus `kind` on a switch |
| `encounter.kept_in_history` | an envelope change after a finished note (the action `keepInHistory` writes today) | `field`, `changeId`, `problem` |
| `note.created`, `note.updated` | existing | existing |
| `note.kept_in_history` | a change to a finished note | `field`, `changeId`, `problem` |
| `note.completed` | a sign-off with effect `completed` | `act`, `effect`, `signoffId`, `clockVerified`, `changeId` |
| `note.signed` | effect `signed` | the same, plus `credential`, `claimedCredential` when it differs, `needsAttestation` |
| `note.saved_unsigned` | effect `saved_unsigned` | the same |
| `note.signoff_repeated` | effect `none` | `signoffId`, `hashMatches` |
| `note.reopened` | a reopen that applied | `changeId` |
| `note.cosigned` | 5.3 | `signoffId`, `credential`, `needsAttestation` |
| `note.attested` | 5.4 | `attestationId`, `signoffId` |
| `note.corrected` | a correction applied | `field`, `outcome`, `requestedByPatient`, `credential`, `statusAfter`, `attestationAfter` |
| `note.amendment_declined` | a declined amendment request | `field` |
| `note.assigned` | 5.5 | `fromUserId`, `toUserId` |
| `addendum.added` | 4.7 | `encounterId`, `noteId` |
| `referral.created`, `referral.entered_in_error` | 4.7 | `encounterId` |
| `encounter.viewed`, `note.viewed` | a visit read, online or offline | `noteIds` |
| `chart.timeline_viewed` | 5.2, earlier visits | `count` |
| `cosign_queue.viewed`, `attestation_queue.viewed`, `notes_to_finish.viewed`, `incomplete_notes.viewed` | 5.4, 5.6 | `patientIds`, `count` |
| `ems_handoff.shown`, `ems_handoff.exported` | 9.8 (offline: a new entry in the closed list of 4.8), 5.7 | `encounterId` |

Every event names its patient in the audit row's patient column, so the audit search by patient
finds it (D53). Of the refusals of an online request, a refusal of access (403) is logged, as
`access.denied` with the reason's name; a state conflict (409), input the route cannot take (422)
and a record the team does not have (404) are not, as in phases 1 to 3. `reauth_required` is not
logged either: it asks for a fresh sign-in, and refuses no access (the coordinator's decision on
review finding LPM-2).

As built for the sync half (unit L1, with wave D's review). The event of a change carries
`changeId`, and a create's `clockVerified`, beside the keys below, and names its patient, when
there is one, in the row's patient column. None holds a value, a reason's text or an addendum's.

| Action | As built |
|---|---|
| `encounter.updated` | A switch of `kind` is a write of the field `kind`: `field`, `kind` (the history kind, `set`), `version`. No key names the new kind, which can only be `medical`. A Medical note's create writes its visit's switch this way, with the note's `changeId` |
| `encounter.kept_in_history`, `note.kept_in_history` | `field`, `version`, `problem` |
| `note.reopened` | A reopen that applied, written as any set is: `field`, `kind`, `version` |
| `note.completed` | `signoffId`, `act`, `effect`, `clockVerified`, on the note |
| `note.signed`, `note.saved_unsigned` | The same, plus `credential`, `needsAttestation`, and `claimedCredential` when it differs |
| `note.signoff_repeated` | `signoffId`, `reason` (`already_finished`, `not_author`, or since the phone's store `empty`, 3.4), `hashMatches`. The event keeps `hashMatches` for every sender, though the receipt gives it only to the acting author (4.6) |
| `note.corrected`, `note.amendment_declined` | One per correction, whatever its outcome: `note.amendment_declined` for `declined`, `note.corrected` for the rest, `not_author`, `no_change` and `draft_edit` included. `correctionId`, `fields` (every field the correction names, a list, since it holds up to ten; for `corrected`, the fields it wrote, review finding R1), `outcome`, `requestedByPatient`, `credential`, `claimedCredential` when it differs, `statusAfter`, `attestationAfter`, `clockVerified`, on the note. A draft edit writes no `note.updated` for each answer |
| `addendum.added` | `encounterId`, `noteId`, on the addendum |
| `referral.created` | `encounterId`, on the referral |
| `referral.entered_in_error` | `field`, `kind`, `version`, and `encounterId` (review finding REC-5) |
| `quarantine.accept_refused` | A held sign-off's accept refused as the note no longer matches it (4.6): on entity `encounter_note` and the note, with its patient; `itemId`, `changeId`, `problem`. Since the phase's review a held correction's refused accept is logged the same way, and its sender told (`correction_not_applied`, 4.6; finding VS-6). Any other refused accept rolls back and writes nothing, as before |
| `encounter.viewed`, `note.viewed`, `patient.viewed` (the sync read) | One per record returned, with its entity and ID, and `{ source: 'sync' }`: a visit is `encounter.viewed`; a note, a sign-off, an addendum and a correction are `note.viewed`; a referral is `patient.viewed`. Not one per visit with `noteIds` |
| `ems_handoff.shown`, `notes_to_finish.viewed` (offline) | The closed list's keys (`AuditAppend`): the handoff names its visit by `entity` `encounter` and `entityId`, and its patient; Notes to finish names `patientIds` and `resultCount`, not `count`. `ems_handoff.exported` stays refused offline |

A value the server sends back to a phone is a read (the coordinator's decisions on review findings
PA-1, PA-4 and PP-4). What a conflict, a value kept in history and a retry carry of a field goes as
the sync read would show it to the sender: a note's answer they may not see all of, and a Medical
visit's summary for a sender `medicalHidden` withholds it from, go as a field that holds nothing
(`apply.ts` `fieldForAnswer`; the phone's test server's `_Receipt.result`). `sync.conflict` names
the record's patient in the row's patient column, as `*.kept_in_history` and `*.field_contested`
already did. A retry answered from its receipt with a field that holds something writes the read
it is, in the push's transaction: `encounter.viewed`, `note.viewed` or `patient.viewed` as the sync
read logs the record, on its patient, with `{ source: 'sync', changeId, field }`. Needs attention
draws what those answers carried and logs nothing again. Since the second pass (finding VA-1, the
coordinator's decision) what is sent back follows every rule of the sync read, from the one copy
the read itself calls (`read-rules.ts`, 6.4 rule 2), the record's own key first: a field the
sender may not see goes as one that holds nothing, and no read is logged for it (`logSentBack`),
so a retry from someone whose role lost `patients.view` since the first answer carries nothing of
the record and logs no read the read route would refuse.

A sign-off's and a correction's events are on entity `encounter_note` and the note, with their
own ID in the details, so the audit search by note finds them. A change held for review writes
`sync.quarantined` with the reason `permission` and nothing that names the rule. The online events
of L2 take the same keys (`resultCount`; `entity` and `entityId`), so that one search finds both
(below).

As built for the online half (unit L2, with its review). Each event is written in its route's
transaction; a refusal's, in a transaction that writes nothing else. None holds an answer, a
summary, a reason's text or an addendum's.

| Action | As built |
|---|---|
| `encounter.viewed`, `note.viewed`, `patient.viewed` (the visit read, 5.1; a cached chart's recent visits, 5.2) | One per record returned, on its entity and ID, with its patient, and `{ source }`: `phone` or `portal` for the visit read, `cache` for the recent visits the phone's cached chart carries (the portal's chart read carries none and logs none, unit L6). A visit is `encounter.viewed`; a note, a sign-off, an addendum, a correction and an attestation are `note.viewed` (on `encounter_note`, `note_signoff`, `note_addendum`, `note_correction`, `note_attestation`); a record made at the visit is `patient.viewed`, on its own entity and its own patient. Not one per visit with `noteIds` |
| `chart.timeline_viewed` | On entity `patient` and the canonical ID: `resultCount`, and `before` when it was given. Not `count` |
| `cosign_queue.viewed`, `attestation_queue.viewed`, `notes_to_finish.viewed`, `incomplete_notes.viewed` | No patient in the row's column; `patientIds` (each patient shown, once) and `resultCount`, not `count`; the team's list adds `author` when it is filtered |
| `note.cosigned` | On entity `encounter_note` and the note, with the visit's patient: `signoffId`, `credential`, `needsAttestation` |
| `note.attested` | The same entity: `attestationId`, `signoffId` |
| `note.assigned` | The same entity: `fromUserId`, `toUserId`. Never the reason, which `note_assignments` keeps |
| `note.assignees_viewed` | The assign picker's list (5.5, unit L6). The same entity, with the visit's patient: `resultCount`, how many people it names. No name, staff's or patient's |
| `ems_handoff.exported` | On entity `encounter` and the visit, with its patient, as the offline `ems_handoff.shown`: `noteIds` (the notes the file holds, none of a sensitive type) and `source`. No `note.viewed` per note |
| `access.denied` | A missing key: `permission`, `route`, from the team scope, or from co-sign and attest when the caller's role no longer charts once the team lock is theirs. A rule about the caller: `reason` and `route`, on entity `encounter` and the visit with its patient for co-sign and attest (with `noteIds`: `is_author`, `is_signer`, `cannot_sign`, `cannot_attest`, `cannot_see_all`) and for the handoff (`cannot_see_red_flags`); with no entity for the queues' `cannot_sign` and `cannot_attest`, and for a caller of co-sign or attest who is no longer an active member once the lock is theirs (`not_a_member`) |
| `access.denied` `cannot_read` (since the phase's review, D98 as amended) | A request naming a note the caller may not read at all: co-sign and attest naming one of the visit's notes, on entity `encounter` and the visit with its patient, `noteIds` the notes; assign and assignees, on entity `encounter_note` and the note with its patient. Written in the request's transaction, beside any other refusal about the caller; the answer stays `not_waiting` or 404. A note of another team or visit, or none, is not logged |
| `access.denied` from assign once the lock is theirs (review finding PA-3) | Assign reads the caller again under the team lock, as co-sign and attest do (`callerNow`): `not_a_member` with no entity, or `permission` `team.manage_users`; the assignment is asked of, and read by, who they are then |
| Not logged | `reauth_required`, and every 409, 422 and 404 but the above. When a co-sign or an attest answers a 409 and a note it names was refused about the caller too, that refusal is logged (5.3). `GET /v1/me/counts` writes no event: it names no patient (5.6) |

As built for the portal's pages (unit L6, with its review): the portal writes no event of its
own. What a page reads or does goes through the API, which logs it as the table above says, and
the end-to-end tests count the events. A visit page logs its read (5.1) and, for a person with
`team.manage_users`, one `note.assignees_viewed` for each note it offers Assign on (9.12). The
patient page's chart read logs the chart and none of its visits (5.2), Show earlier visits logs
`chart.timeline_viewed`, and opening a visit from the timeline logs that one visit. An export
logs its `ems_handoff.exported` and nothing more: the page is not read again (9.11). Each queue
and Notes not complete log their view; Home's counts write none, and no link reads anything
before it is followed.

As built for the phone's reads (the domain layer, unit L4, with its review). Each read writes its
events in the store transaction that reads it, with the closed list's keys (`AuditAppend`), so a
read that can't be logged shows nothing, and nothing is read while the store is frozen. A screen
that reads again passes the IDs it was shown (`shownBefore`), and only what a read adds is logged.
`source` is `local` for a record made or worked on here and `cache` for a copy the server sent, as
phase 3 logs a chart read offline. The events join the audit log at the next sync, with the rest of
the phone's offline reads.

| Action | As built |
|---|---|
| `encounter.viewed`, `note.viewed` (a visit or a note read from the phone's own copy, `EncounterRepository`) | One per record shown, with the visit's patient: the visit is `encounter.viewed`; a note, a sign-off, an addendum and a correction are `note.viewed`, on `encounter_note`, `note_signoff`, `note_addendum` and `note_correction`. A note opened on its own logs the note and what hangs off it, not the visit. A note whose definition the phone lacks is logged for whoever acts as its author, who is shown it listed. Not one per visit with `noteIds` |
| The same, and `patient.viewed` (a chart's cached recent visit, `EncounterApi.recentVisit`) | As the server logs its read (5.1), each with source `cache`: the visit, its own addenda, each note and its sign-offs, addenda, corrections and attestations, with the visit's patient; each record made at the visit as `patient.viewed`, on its own entity and its own patient (`patientOfMadeAt`, 8.4 as built), never the visit's |
| `patient.viewed` (the records made at a visit the phone holds, `VisitRecords.madeAt`; the Referrals sheet and a visit's referrals, `Referrals.openReferrals` and `madeAt`) | One per record shown, on its own entity and its own patient |
| `notes_to_finish.viewed` | `patientIds`, each patient once and at most 50 an entry, so a longer list writes several, and `resultCount`, the rows the read adds; the server's rows are logged again (9.9 as built) |
| Not logged | The profile's timeline and its referral rows, part of the chart's logged read (9.1 as built); Home's tile, numbers only; Complete's plan, drawn beside the visit's logged read (9.6 as built); a visit read from the server, which logged it. The phone writes no `access.denied`, which the closed list does not hold: a reader without `patients.view` is not refused the phone's own read of a visit (9.7 as built), and the records made at a visit show them nothing |

As built for the phone's screens (unit L5, with its review). Each screen reads through the domain
layer, so it logs as the table above says; a screen that reads again passes what it showed
(`shownBefore`), a screen another covers reads again only once it is on top (9.4 as built), and the
visit screen's Correct reads its note with what the screen had shown (9.7 as built). Since the
review:

| Action | As built |
|---|---|
| `ems_handoff.shown` | Written by the domain layer's `openHandoff`, on entity `encounter` and the visit, with its patient, in the transaction of the visit read that shows the handoff, beside that read's own `encounter.viewed` and `note.viewed`; nothing is written when the phone holds no such visit, or while the store is frozen (9.8 as built). As first built the screen wrote it itself, in a transaction after the read's |
| A visit read from the server with the phone's copy under it (the visit screen, online, 9.7 as built) | The server logs its read (5.1, source `phone`); the phone's read under it logs only what that read did not show: notes, sign-offs, addenda, corrections and records made here that the server does not have yet. A change reads the phone's copy again, logging only what it adds |
| Whether the visit has a finished Red flags note (`finishedRedFlags`, 8.2 as built) | A server visit read, which the server logs as it logs any, though the screen draws none of it; the phone logs nothing |
| Go to Red flags on a teammate's finished note | Nothing until the note screen's own read of the note it opens, which logs it: the note is found by a scan of the store that reads nothing (9.5 as built). As first built a whole visit read was logged that nothing showed (review finding SRD-7) |
| `encounter.viewed` (Needs attention's Choose a visit, 8.4 as built) | One per visit the sheet lists, on its own patient, in one transaction as the sheet opens |
| Not logged | Whether Show handoff, Add or remove notes or Choose a visit is offered, decided from what a logged read already gave or from no value at all (`othersMayHaveAdded`, `hasVisitsToChoose`); the queue tiles, numbers only |

### 10.2 PHI rules, applied to this phase

| Rule (`CLAUDE.md`) | How phase 4 keeps it |
|---|---|
| No patient details in URLs | Phone routes and portal paths carry UUIDs only: `/encounters/<uuid>`, `/notes/<uuid>`. Queue filters and the `author` filter are IDs. |
| ... in page titles | Fixed titles: "Visit", "Notes to finish", "Notes not complete", "Waiting for attestation". |
| ... in notifications | None is sent in phase 4 (3.9). Notices hold a kind and record IDs, no text. |
| ... in logs or crash reports | Audit details as in 10.1. Rejections name a rule, never a value (`services/api/src/sync/apply.ts:43-46`). |
| ... in the phone's key-value store | Drafts, sign-offs and the timeline live in the encrypted database. Nothing about a visit is written to preferences. |
| A read that can't be logged is refused | The visit screen logs before it shows (9.7); the queue routes log in their transaction. |
| The offline index holds no legal names | Unchanged. Queue and list rows show the preferred name through the reader's projection. |
| Demo data only | Seeded visits use the invented patients of `db/seed/demo-patients.ts`; free text starts with "Demo:". |

As built for the online routes (unit L2, with its review):

- **URLs.** The one query string that is not an ID, the handoff's `timeZone`, takes a zone's name
  and nothing else, by a pattern in the contract (5.7). The handoff file's name is
  `ems-handoff.pdf` for every visit, and its metadata hold a fixed title and the export's time.
- **Logs.** The audit details of 10.1's online table. An assignment's reason is stored and never
  logged; the handoff's event names notes by ID.
- **A read that can't be logged is refused.** The visit read, a chart's recent visits, earlier
  visits, the queues and both lists of 5.6 write their events in their own transaction. Home's
  counts name no patient and write none.
- **Names.** A queue row shows the canonical chart's preferred name, and only to a reader with
  `patients.view`. The EMS handoff PDF, a file that leaves the team, names its patient by
  preferred name, with their age and allergies, never by the legal name or the birth date
  (PLAN-OPEN 12.1 #27).
- **Demo data.** `db/seed/demo-encounters.ts` charts three made-up visits in the demo team, with
  fixed IDs, so a second run changes nothing: a Medical visit for demo patient 15 by the demo
  resident, whose Red flags note the demo attending attests a day later, beside a completed Social
  needs note; a Non-Medical outreach visit for demo patient 24 by a demo member with the Logistics
  role and no credential; and a wound visit for demo patient 21 by the attending, corrected a day
  later. Free text starts with "Demo:". The rows are the ones sync and the online attest write:
  the db package cannot import the API, so the seed restates the few rules it needs, and
  `db/test/demo-encounters.test.ts` holds every row to the API's own functions. A team that does
  not hold the released note types gets no visits. Kept as built: the seed writes no audit events
  or notices, since seeding is no one's act, as phase 3's seed writes none for its patients; the
  preview gets no visits, having no seeded staff to sign them; and no demo student is added, so the
  queues and Notes to finish start empty.

As built for the portal's pages (unit L6, with its review):

- **Addresses.** Every page and route handler is named by IDs alone: `/encounters/{encounterId}`
  and its `sign`, `assign` and `ems-handoff` handlers, `/encounters/earlier`,
  `/patients/{patientId}`, `/team/cosign`, `/team/attestation` and `/team/incomplete-notes`. What
  the visit page comes back with is a state from a closed list (`?signed=`, `?handoff=`, `?assign=`,
  with `&note={noteId}#assign-{noteId}` when it comes back at a note's form), and a word it does
  not know shows nothing.
  The IDs Show earlier visits needs, a press's plan, an assignment's person and reason, and the
  export's time zone travel in POST bodies; the zone, in a zone's shape, is the one query string
  the export sends the API (5.7). The end-to-end tests hold every address a page loads to these
  (`expectOnlyIds`).
- **Titles.** Each page's is fixed: "Visit", "Co-sign queue", "Attestation queue", "Notes not
  complete", and the patient page's "Patient".
- **Browser storage.** None. The plan a visit page holds, the earlier visits a timeline has loaded
  and a form's values live in the page's memory and go with it; local and session storage stay
  empty after each page (`expectNothingStored`, in the specs and the accessibility sweep). The
  handoff comes as an attachment named `ems-handoff.pdf`, `no-store`, as the route handlers' JSON
  answers do.
- **Reads nobody made.** No link to a visit or a chart prefetches (`prefetch={false}`, held by
  `apps/portal/src/lib/patient-links.test.ts`), since loading one logs a read, and a timeline row
  carries the note titles and states it shows and nothing more of a note.
- **Names.** A page names a patient by the name the API gives, the canonical chart's preferred
  name, given only to a reader with `patients.view`, and makes none up: "No name recorded", "No
  patient recorded".

Staff names in the sync read (D108): a note's snapshot names who acts as its author, a sign-off's
its signer and a correction's its corrector (4.4, 4.6, 4.7), beside the IDs they already carried,
as an addendum's named its author; since unit L6 a referral's names who recorded it, by their name
now (`attributes.authorName`, 5.2 as built). They are staff, not patients, and the PHI guard and
the rules on logs hold as before: they go only with a record the reader is shown (6.4), no audit
event or rejection holds one (events name people by ID, 10.1), and on the phone they live with the
record's attributes in the encrypted database, never in preferences. A note's recap lines (5.1)
are answers, so they go only in the bodies of the visit read and the chart, never in a URL, a
title or a log.

As built for the phone's screens (unit L5, with its review):

- **Routes.** IDs only: `/encounters/new`, `/patients/<id>/encounters/new`, `/encounters/<id>` and its
  `note-types`, `summary`, `visit` and `handoff`, `/notes/<id>` (the section to open, the summary's
  jump, travels beside the route as a section's ID, never in it), `/notes-to-finish`,
  `/queues/cosign` and `/queues/attestation`.
- **Titles.** Fixed (the coordinator's decision for the first three): "Encounter", "Visit", "Note
  types", "New encounter", "Note", "Summary", "EMS handoff", "Notes to finish", "Waiting for your
  co-signature" and "Waiting for attestation". A note type's name is a heading in the body, and a
  patient's name is only in the body of a screen that shows them.
- **What is said in passing.** The SnackBars after Complete and Save & Close ("Signed", "Sent for
  co-signature", "Completed", "Saved as a draft"), the Referrals sheet's live regions ("Referral
  added", "Marked entered in error") and every refusal name no patient and no answer. No
  notification is sent.
- **The task switcher, the clipboard and share sheets.** Phase 1's guards hold every new screen: on
  Android `FLAG_SECURE` keeps each one out of screenshots, screen recordings and the recent-apps view,
  and on iOS the app is covered whenever it is not in front (`apps/mobile/lib/security/idle_lock.dart`),
  so no visit, note or handoff shows in the app switcher. No phase 4 screen puts anything on the
  clipboard or opens a share sheet: the EMS handoff has no copy, no share and no text that can be
  selected (9.8), a read view's text cannot be selected, and the phone exports nothing (12.1 #12).
  Every box that takes a patient's details or a note's text is private, with no suggestions,
  autocorrect or learned words (phase 3's `PhiField`, the form's `NoteTextField`), the place typed at
  Where and Add to the assessment among them; selecting and copying inside such a box is the
  platform's own, as in phase 3. Since the phase's review (finding PP-3, the coordinator's
  decision), its selection menu offers only cut, copy, paste and select all, on both platforms:
  the platforms' Share, Search Web and Look Up, Android's text-processing apps and iOS's Live Text
  are left out, pinned by `test/features/patients/phi_field_menu_test.dart`. Since the second pass
  (the coordinator's decisions on review findings C-2 and C-4) every private box shares one
  `PrivateBox` (`apps/mobile/lib/design/widgets/private_box.dart`): `PhiField`, every box built on
  it, and the birth date box, which was a plain `TextField` with Share, Search Web and Look Up in
  its menu. Its Copy and Cut, from the selection menu and from a hardware keyboard's shortcuts (the
  copy and cut text intent, which `EditableText` lets an ancestor override), go through `secureCopy`, as an ID
  link does, never the general pasteboard: on iOS a local-only item, never Universal Clipboard,
  cleared after 60 seconds; on Android a clip marked sensitive (honoured from Android 13) whose
  label names no one, cleared after 60 seconds if it is still the one there, though from Android 10
  an app in the background can't read the clipboard, so a copy whose time runs out there is cleared
  once the app is back in front, and one whose process Android ends first is never cleared
  (`MainActivity.kt`; the tests stand in for both platforms' native side, which no device here has
  run). Cut takes
  the text out only once `secureCopy` says it was copied. When it says no, nothing is copied and the
  box says “Nothing was copied: this phone couldn’t copy it privately.”; there is no fallback to the
  plain clipboard. On success the box says “Copied. It clears in 60 seconds.” under it, a live
  region, a new one at every copy. The sentence is exact on iOS; on Android it holds only when the
  app's process lives to the end of the minute and, from Android 10, the app is in front then
  (above). The ID link's “Link copied. It clears in 60 seconds.” (`patient_screen.dart`) is the
  same. Paste is the platform's own. The sign-in and PIN boxes take
  neither a patient's details nor a note's text and keep the platform's menu. **What does not go
  through it** (the coordinator's decision on the open question of review finding C-4): on Android
  a soft keyboard's own Copy or Cut (`performContextMenuAction`, which Gboard's text editing panel
  sends) is handled inside the Flutter engine's Android embedding and writes a plain clip, neither
  marked sensitive nor cleared; on iOS an edit action sent to the text view from outside Flutter
  (an iPad keyboard's shortcut bar, for one) may do the same, which no device here has checked.
  Closing it needs a hook that wraps the embedding's text input connection, which Flutter offers
  only by replacing how the app hosts its view; it is not built in phase 4 (plan risk 10).
- **The place.** A position joins the visit only on the tap (12.1 #15), kept in the encrypted
  database with the visit and sent in its create; no screen shows it as coordinates, no log holds it
  (10.1's details hold no value) and nothing about it is written to preferences. Outside the app's
  screens it is named only by the platforms' prompts: iOS's purpose string, "Sineobex adds where you
  are to a visit only when you tap Use my location. You can type the place instead.", and Android's
  fine and coarse location, while the app is in use; there is no background location and, since the
  review, no location service in the build (9.2).
- **Memory only.** What is typed in Add to the assessment until Complete, a visit read from the
  server (kept nowhere unless an action brings its records onto the phone, which files them in the
  encrypted database as a sync read does), and a screen's answer about the Red flags note.
- **Names.** The handoff heads the patient by their preferred name alone, "No preferred name
  recorded" without one, never their description, legal name or birth date (9.8 as built); a visit
  the phone does not hold is headed by the read's `preferredName`, given only to a reader with
  `patients.view`; Choose a visit lists visits by kind and time alone (8.4 as built); a staff name
  ("By …", "Recorded by …") is the one its record carries (D108).

As built for the phone's store (unit L3, 4.8): what it keeps of a sign-off held for review is IDs
only, in the encrypted database's `kv` table (`held_signoff.<noteId>`, `held_note.<signoffId>`);
what Complete expects of a note (`localEffect`) is in the note's record; and its notices,
`finished_differently` and the server's `signoff_not_applied` among them, hold a kind, IDs and at
most a field's name, as phase 2's do. The note a held sign-off's notice names (D104) is an ID too,
on the server (`user_notices.note_id`) and on the phone (`kv`, `notice_note.<local notice ID>`):
never a name, nor anything derived from one (D40). Nothing about a visit is written to preferences.

## 11. Tests

### 11.1 The Done when, step by step

"A resident charts a medical, wound and social visit as one encounter offline, saves and closes
it, completes it later, and an attending attests it" (`IMPLEMENTATION_PLAN.md`, phase 4).

The steps live in one shared file, `packages/contract/test-vectors/encounters-done-when.json`
(the people, the patient, the answers), as phase 3's `done-when.json` does. Three tests run them:

| Test | Runs against | Covers |
|---|---|---|
| `apps/mobile/test/encounters/done_when_test.dart` | the phone's test server | steps 1 to 6, through the domain layer |
| `apps/mobile/test/encounters/live_encounters_test.dart` | the real API and Postgres (`tools/live-sync.sh`, in CI) | steps 1 to 7 |
| `services/api/test/encounters-done-when.test.ts` | the API alone | steps 3, 5, 6 and 7 as raw changes and requests |

| # | Step | What is asserted |
|---|---|---|
| 1 | Offline. A resident starts a Medical encounter for a made-up patient and adds General / primary care, Wound care and Social needs. The app adds the Red flags and disposition note by itself. | One encounter and four draft notes in the store. Nothing sent. |
| 2 | They fill in answers and press Save & Close. The app is killed and started again, still offline. | The drafts are on the phone with every answer. Notes to finish says 4. |
| 3 | The phone reconnects. | The server holds one draft encounter with four draft notes. Each change has a hash-confirmed receipt. The drafts are still on the phone (3.2). |
| 4 | Offline again, later. They open the visit from Notes to finish, answer the red-flag question, write the assessment and press Complete and sign. | Four sign-offs wait in the outbox: `sign` for General, Wound care and Red flags, `complete` for Social needs, which is a Non-Medical note. The notes are read-only. The patient's chart opens with the visit marked "Waiting to send". |
| 5 | The phone reconnects. | Four `note_signoffs` rows: three with effect `signed`, one `completed`. The three Medical notes are `signed` with `attestation = 'waiting'`; the Social needs note is `completed`. The encounter is `signed`. One audit event per sign-off, each in its change's transaction. |
| 6 | The phone's sync finishes. | The notes and the encounter have left the phone. Notes to finish is gone. |
| 7 | An attending, online, opens the attestation queue and attests the visit in one action. | The queue lists one visit with three notes, then none. Three `note_attestations` rows. `attestation = 'attested'`. Audit events `attestation_queue.viewed` and `note.attested`. The resident has one `note_attested` notice for the visit. |

The attending in the story holds the Healthcare Staff role. No note in it has a sensitive exam,
so no extra key is needed to attest (6.4, rule 4); a second, shorter test attests a note with a
GU exam as a Program Admin and is refused as Healthcare Staff.

The screens get the same story as widget tests
(`apps/mobile/test/features/encounters/done_when_flow_test.dart`), offline, and the attending's
half as a portal end-to-end test with axe in three themes
(`apps/portal/e2e/attestation.spec.ts`).

As built on the portal (unit L6): the attending's half is "the Done when, its portal half: an
attending opens the attestation queue and attests a resident’s visit in one action"
(`attestation.spec.ts`), from the navigation through the queue, the visit page and one press of
Attest to the rows, events and notice step 7 asserts, with axe in three themes and reflow at
320 px. A phone's sync sends what steps 1 to 6 leave on the server, with the shared story's
answers (`encounters-done-when.json`, unit L7). The shorter test is "an attending attests
what they read whole; a note with a GU exam waits, says why, and a Program Admin attests it".

As built (unit L7): the shared story names the seeded resident, attending and Program Admin, a
made-up patient, the four notes in the order the phone makes them (General, then the Red flags
note the app adds with it, Wound care, Social needs), the answers each step writes and what each
step expects. `services/api/test/encounters-done-when.test.ts` runs steps 3, 5, 6 and 7 as raw
changes and requests, and checks through each row's transaction ID that a sign-off, its change
and its audit event share one transaction; it also holds the shorter test.
`apps/mobile/test/encounters/done_when_test.dart` runs steps 1 to 6 on the phone's test server,
with a real kill and restart at step 2. `live_encounters_test.dart`, run by `tools/live-sync.sh`
in CI, runs steps 1 to 7 against the real API, the patient registered by the resident's phone.
`apps/mobile/test/features/encounters/done_when_flow_test.dart` walks steps 1 to 6 through the
screens in the three themes and at 200% text; its restart at step 2 locks the session and builds
the app again over the same database, since the app harness cannot kill the app. The phone's
test server writes no server audit events, so step 5's events are asserted by the API and live
tests.

### 11.2 The test that holds each rule

Every rule below is checked to bite: put the old behaviour back, see the test fail, restore it
(`docs/plan/README.md`).

| Rule | Section | Test |
|---|---|---|
| The six states and the encounter's status | 3.1, 2.2 | `note-lifecycle.json` through `services/api/test/encounter-rules.test.ts` and `apps/mobile/test/encounters/rules_test.dart`; the trigger in `db/test/encounter-lifecycle.test.ts`; through the fake, parity case 13, named after that db test |
| A finished note's answers change only through a correction | 2.2 | `db/test/encounter-lifecycle.test.ts` (the guard refuses an update, and lets a correction through); `sync-corrections.test.ts` (a correction opens its note to the guard for its own write only) |
| The draft stays on its author's phone until finished | 3.2 | The domain layer's close sweep, in `apps/mobile/test/encounters/close_sweep_test.dart` (below): the store closes a record only when it is told to (`closeRecord`, phase 2) |
| Complete's hard stops | 3.3 | Those `finishNotes` checks itself (1, 2, 3 and 5, and the hash) in `apps/mobile/test/sync/store_encounters_test.dart` ("Complete stops where the server would refuse, and writes nothing", "Complete waits while anything about the visit or its notes waits in Needs attention", "a refused sign-off of a note being completed does not hold Complete up; another of the visit does", "Complete waits for the clock check, and writes nothing while it fails", "a signature covers what was on the screen: a change synced in since stops Complete", "an empty draft with no refusal to settle is not completed"); hard stop 4 and what the summary screen lists in `apps/mobile/test/encounters/complete_test.dart` |
| Every row of the sign-off table | 3.4 | `note-lifecycle.json`; `services/api/test/sync-signoffs.test.ts` ("what a sign-off does", "refusals", "what a sign-off names, and what it is", "an empty draft’s sign-off changes nothing, and so settles the refusal of an earlier one"); parity case 7, which sends every `signoffEffect` case through a real sign-off, and the parity case of that name |
| Complete on the phone: the hash shown is the hash sent, the Red flags note first, the answers that do not count dropped, one transaction, never two sign-offs of a note, the caller's act and credential | 4.5, 4.6, 4.8 | `apps/mobile/test/sync/store_encounters_test.dart`, group "Complete (lifecycle 4.8)": "the hash shown is the hash sent, over the visit’s patient and summary, and the server agrees", "the Red flags note goes first, so the visit’s Medical notes are signed with it", "a Red flags note finished by an earlier Complete, not synced yet, lets the visit’s Medical notes be signed", "a Red flags note finished on the server lets the visit’s other Medical notes be signed", "answers that do not count leave the phone’s copy at Complete, as they leave the server’s", "one Complete is one transaction: a note refused undoes the notes before it", "a resident’s signature waits for attestation; a student’s note waits for a co-signer", "only whoever acts as the author completes a note", "a sign-off the server would refuse whatever it is sent with is never made" |
| A refused sign-off is fixed by Complete, and every one can be settled; a sign-off is made and fixed only by Complete; what Complete dropped still reaches the server's history | 3.4, 4.8 | `apps/mobile/test/sync/store_encounters_test.dart`: "a sign-off the server refuses is fixed by completing again: the same record with the new hash", "a refused sign-off of a note finished since is fixed all the same: the server stores it with no effect", "a refused sign-off of a note then removed is settled by completing it: an empty draft changes nothing", "a sign-off is made and fixed only by Complete", "a refused note fixed while its sign-off waits behind it is still finished here", "an answer Complete dropped still reaches the server’s history when the note’s refused create is fixed", "a visit whose create was refused is fixed before its notes are completed", "the fix of a refused answer whose row is gone builds on the version the person saw" |
| The lock follows the effect; the envelope lock reads `hasFinishedNote`; the reopen, with `everSigned`; who acts as the author; settling is never locked | 3.1, 3.6, 3.8, 4.8 | `apps/mobile/test/sync/store_encounters_test.dart`, group "the lock follows the effect (lifecycle 4.8)" |
| A visit as the server keeps it on the phone; its kind set back from Medical and its patient removed, refused here | 4.3, 4.8 | `apps/mobile/test/sync/store_encounters_test.dart`, group "the visit as the server keeps it (lifecycle 4.3)"; `apps/mobile/test/sync/local_store_test.dart` ("a fixed encounter create keeps fields cleared since, and the caller’s corrections win") |
| A visit's `hasFinishedNote` and a note's `everSigned` in the sync read | 4.3, 4.4 | `services/api/test/sync-reads.test.ts` and `apps/mobile/test/sync/fake_reads_test.dart` ("a visit’s snapshot says whether a note the reader is shown is finished, as the envelope lock reads it", "a note’s snapshot shows its state: attestation, who acts as its author, when it was finished and the signature it names"); the visit's attribute keys in `sync-encounters.test.ts` and `fake_parity_test.dart` |
| A note's `createdAt`, when the server made it (an admin's accept, for a held create), to the microsecond, in the visit read's order, and moved by no later change; who acts as a note's author named by their name now, a sign-off's signer and a correction's corrector by theirs then; no name with a record the reader is not shown (D108; review findings N2-R1, N2-R2) | 4.4, 4.6, 4.7, 6.4 | `services/api/test/sync-reads.test.ts` and `apps/mobile/test/sync/fake_reads_test.dart` ("a note’s snapshot says when the server made it, the order the visit read gives a visit’s notes in", "notes made within one millisecond keep the visit read’s order: a note’s createdAt is given to the microsecond", "a note whose create was held says it was made when an admin accepted it, not when its push was held", "a note names who acts as its author by their name now; a sign-off its signer and a correction its corrector by theirs then; none goes to a reader the record is not shown", and the attributes of "a note’s snapshot shows its state: attestation, who acts as its author, when it was finished and the signature it names"); a sign-off's and a correction's whole attributes in `fake_parity_test.dart` |
| Each note's recap in the visit read and the cached chart's recent visits, over what the reader may see; nothing from a sensitive exam, for anyone (D108) | 5.1, 5.2, 6.4, 8.1 | `services/api/test/encounters-read.test.ts` ("each note carries its recap over what the reader may see: a section, a treatment record or a diagnosis hidden from them is in no line"); `encounters-timeline.test.ts` ("the phone’s cached chart carries the last three visits in full, each as the visit read answers it"); on the phone, `apps/mobile/test/encounters/encounter_api_test.dart` ("each note’s recap lines, as the server worked them out for the reader, online and from the chart (D108)") |
| A sign-off, an addendum and a correction are filed under their patient, and move with the visit's | 4.8 | `apps/mobile/test/sync/store_encounters_test.dart`, group "the patient of a new record (lifecycle 4.8)" |
| Receipts settle the effect; Sent for review; the held sign-off's notice settles only that sign-off; `finished_differently`; the refresh takes a note's attributes | 4.6, 4.8, 4.10, 9.13 | `apps/mobile/test/sync/store_encounters_test.dart`, group "receipts settle the effect (lifecycle 4.6, 4.8)"; the sentences in `apps/mobile/test/features/sync_labels_test.dart` ("the notices of a note’s life are worded by their kind alone (lifecycle 3.4, 9.13)") |
| The credential a signature is recorded under | 3.5 | `signed-under.json` through `services/api/test/encounter-rules.test.ts`, and through the fake's copy in `fake_parity_test.dart`; `sync-signoffs.test.ts` ("the credential a sign-off is recorded under, and the Medical gate": signed Monday, promoted Tuesday, synced Wednesday; a held create believed from its receipt; the clock-corrected time; a removed signer's sign-off accepted by an admin) |
| A late change is kept, not refused | 3.6, 4.3, 4.4 | `services/api/test/sync-encounters.test.ts` ("the encounter’s fields", "a finished note, and its reopen"); parity cases 2 and 5 |
| Reopen | 3.6, 4.4 | `sync-encounters.test.ts` ("the reopen: a set of status to draft"); parity case 6 |
| Corrections, and what happens to the signature after one; an answer never held by the sender is taken when it is blank or hidden as the note stands, one held that moved is `field_changed` (D109, review F2); a correction whose answers stay hidden is `no_change`, with no effect on the signature and nobody told (review F4); beside one that shows, a hidden answer is written from a version the sender held and not from none, and a corrected correction names only what it wrote, in its row, its audit event and the visit read (review R1) | 3.6, 4.7 | `services/api/test/sync-corrections.test.ts` ("corrections", and "each step, in the order of 4.7", with "6. an answer Complete dropped, blank now, is corrected from blank by someone who held no version of it; one who held one is still told field_changed (D109)", "6. an answer a correction hid, kept at its version, is shown again by someone who held no version of it; one who held one that moved is still told field_changed (D109, review F2)", "7. a correction whose changed answers stay hidden changes nothing the note shows: no change, the signature as it was, nobody told (review F4)" and "7. beside an answer that shows, a hidden answer the sender held at its version is written; one they never held is not, and the correction names only what it wrote (review R1)"); parity case 10, and the parity cases of those names; a correction of an answer that stays hidden, stored as no change and still hidden from a reader who may not see where it is, in `sync-reads.test.ts` and `fake_parity_test.dart` ("an answer that does not count is hidden by where it is") |
| Addenda | 3.6, 4.7 | `sync-corrections.test.ts` ("addenda"); parity case 9 |
| What an addendum and a correction name: a note of the visit, a sign-off of the note | 4.1, 4.7 | `sync-corrections.test.ts`; parity "what an addendum and a correction name" |
| Referrals, and a visit of another patient | 4.7, 8.3 | `services/api/test/sync-referrals.test.ts`; `sync-encounters.test.ts` ("an allergy and a problem’s note made at a visit", "a problem made at a visit"); parity case 11 |
| An addendum or a correction waits behind a refused sign-off | 4.7 | `apps/mobile/test/sync/store_encounters_test.dart` ("a sign-off the server refuses is fixed by completing again: the same record with the new hash": an addendum naming the refused sign-off waits, and goes after its fix; a correction names its sign-off the same way); on the server, a correction or an addendum that names a held sign-off is held with it (`sync-corrections.test.ts`) |
| Co-sign and attest: a second person, online, sees every section, hash matches. As built: never whoever acts as the author, wrote or completed the note, nor, for attest, its signer; the caller read again under the team lock; a note they may not read does not wait; the first refusal of several answered, one about the caller logged; no wait for the Red flags note; since unit L6's review, the `is_author` refusal's message worded for everyone it covers, so no assignee is told they wrote the note | 3.5, 3.7, 5.3, 5.4 | `services/api/test/encounters-cosign.test.ts`, `encounters-attest.test.ts` ("who may co-sign", "who may attest", "what is refused, and how", "what is logged of a refusal", "what a co-sign writes", "what an attestation writes"); the message in "whoever a note was assigned to acts as its author: refused is_author, and told when it is co-signed" and in attest's "whoever a note was assigned to acts as its author: refused is_author" |
| The visit read: what each reader is given, the records made at the visit, the same notes and hashes as the sync read; a correction made while its entry held a sensitive diagnosis; who is given a hash; one event per record | 5.1, 6.4 | `services/api/test/encounters-read.test.ts` ("phase 4: read a visit online", "the records made at the visit (lifecycle 9.7, D91)", "phase 4: a correction made while its entry held a sensitive diagnosis", "phase 4: who is given a hash in the visit read"); on the fake, "a correction made while its entry held a sensitive diagnosis stays missing once the code is corrected away, in any order" (`fake_parity_test.dart`) and "no sign-off’s hash over a visit’s summary the reader may not read, their own included" (`fake_reads_test.dart`) |
| The timeline, recent visits and earlier visits; a visit's status as the reader is shown it | 5.2 | `services/api/test/encounters-timeline.test.ts` ("on the chart", "GET /v1/patients/{patientId}/timeline: earlier visits", "phase 4: a visit’s status, as the reader is shown it"); on the fake, "a visit’s status in the sync read is worked out from the notes the reader may read" (`fake_parity_test.dart`) |
| The queues: who may open them, what they list, `canAct`, who signed or attested before, the audit; since unit L6's review, why a note waits, the visit read's `heldBecause` | 5.4 | `services/api/test/encounters-queues.test.ts` ("the co-sign queue", "the attestation queue", "phase 4: a queue row of a merged patient"; "a note listed with canAct false says why, as the visit read says it under the note (heldBecause)") |
| What the visit read tells the portal's page (unit L6): the patient's preferred name, the chart's they were merged into; `hasHandoff` exactly when the export gives its file; each note's title and `medical`; `canCosign` and `canAttest` equal to the queues' `canAct` for every reader, and taken by the act; `heldBecause` worded truly (an assignee never told they wrote it); nothing to a role that does not chart; each field added with a default; since the review, which records made at the visit are on another chart now, by the patients' canonical charts, a merged ID of the same person being the same chart | 5, 5.1, 5.3, 5.4 | `services/api/test/encounters-read-actions.test.ts` ("the contract", "the patient and the notes", "whether the visit has an EMS handoff", "what the reader may do as a second person"); `encounters-read.test.ts` ("says which are on another chart now, by the patients’ charts: a merged ID of the same person is the same chart") |
| Each list's note title and `medical` (unit L6) | 5.2, 5.4, 5.6 | `encounters-timeline.test.ts` ("the group’s visits newest first…"), `encounters-queues.test.ts` (each queue's first case), `encounters-incomplete.test.ts` ("lists every draft of the team…") |
| The portal's chart read logs no visit or note read; only the phone's cached chart carries and logs the recent visits (unit L6) | 5.2, 10.1 | `encounters-timeline.test.ts` ("the portal’s chart read carries the timeline and no visit in full, and logs no visit or note read", "the recent visits the phone caches are logged as the visit read logs them, from the cache") |
| Assigning a note; since unit L6's review, `cannot_see_all` decided by what the caller may see (by what the note holds where they see it, by its type where they could miss it too), and a note the caller may not read 404, as its picker answers | 3.8, 5.5 | `services/api/test/encounters-assign.test.ts` ("who may assign", "what is refused, and how", "what is logged of a refusal", "what an assignment writes, and what it changes"; "an answer the assignee could not see: 422 cannot_see_all, by what the note holds where the caller sees it, whatever it holds where they could miss it too", "a note the caller may not read is 404, as its assignees route answers, whatever its state, and nothing is written or logged") |
| Who may be assigned a note: exactly the active members the assign route takes; `team.manage_users` without a recent sign-in; 409, 404 and 422 unlogged; `note.assignees_viewed` (unit L6); since its review, decided by what the caller may see: by D88's rule where the caller could miss the content, by what the note holds where they see it (review finding PRD-1; the coordinator's decision of Nov 20) | 5.5, 6.4, 10.1 | `services/api/test/encounters-assignees.test.ts` (with the group "decided by what the caller may see (review finding PRD-1; the coordinator’s decision of Nov 20)": a Program Admin is offered a Healthcare Staff attending for a General note with no GU exam and not for one with a GU exam; a manager without the exams key, and a Program Admin with no credential, get the same list and the same refusal of every member left out with and without a sensitive exam or a treatment record; the list and the route agree in each); its row in `permissions.test.ts` |
| Overdue after 24 hours, worked out when read; the lists of notes not complete; the team's list names each patient, by the chart they were merged into and only with `patients.view` (unit L6) | 3.9, 5.6 | `note-lifecycle.json`; `services/api/test/encounters-incomplete.test.ts` ("notes to finish: the caller’s own drafts", "the team’s incomplete notes", "names a merged patient by the chart they were merged into, as the queues do") |
| Home's counts: each its list's length, absent for a list the caller may not open, no patient named or logged; `teamOverdue` the team list's own overdue (unit L6) | 5.6 | `services/api/test/encounters-counts.test.ts` |
| A referral's snapshot names who recorded it, by their name now (unit L6) | 5.2, 7 | `services/api/test/sync-referrals.test.ts` ("its snapshot names who recorded it, by their name now, wherever it is read"); on the fake, the parity case of the same name (`fake_parity_test.dart`) |
| The local identity provider's test hook dates only the next sign-in back, and only with `DEV_IDP_TEST_HOOKS=1` (unit L6) | 5.7 | `services/api/test/dev-idp-hooks.test.ts` |
| The visit page (unit L6): one read; what each reader is shown and offered; the envelope, each note's state, its author and why it waits, its recap and its trail in the design's words; a corrected answer read as replaced, and an answer a correction took away as no answer now; the records made at the visit, on another chart or entered in error, as the API says; a visit with no patient; long typed text wrapped at 320 px; every state it comes back with, and none for a word it does not know | 9.7, 9.11 | `apps/portal/e2e/encounters.spec.ts` ("a resident’s signed note, attested the next day, opened from the timeline: read-only in every theme", "every state the visit page comes back with is a status, accessible in every theme", "a corrected measurement shows the new value, and the old one struck through and read as replaced", "long typed text wraps at 320 px…", "the records made at a visit…", "a visit with no patient says so, and offers no chart", "a role that reads no Medical notes sees a visit without them, and without its assessment"); `apps/portal/e2e/attestation.spec.ts` ("each reader sees a visit’s notes and sections as their role allows, and no act their credential doesn’t", "whoever wrote a note is told someone else has to co-sign it, and is offered nothing", "a note back after a correction…"); `apps/portal/src/lib/encounters.test.ts` |
| Co-sign and Attest on the visit page (unit L6, with its review): exactly the notes the read marks, each with the hash it gave, in one press; the plan of the first render kept, none included, and a later one that differs said at once and never sent (PRD-2); the button off until the next page (PAC-1); a problem focused each time it comes (PAX-1); a dropped connection that can't tell, before the request leaves or after the server answered (PAC-4); each refusal loaded as its state, the API's message never shown; an idle session refused, prefetch or not (PAC-2) | 3.5, 5.3, 5.4, 9.11 | `attestation.spec.ts` ("the co-sign queue lists a visit by the API’s titles, and Co-sign sends exactly the notes the read marks, with its hashes", "the attestation queue lists a resident’s signed note, and Attest adds the attending’s attestation", the group "the plan sent is the one the person read", "a second press while the visit loads again after Co-sign sends nothing: the button stays disabled", "a press the route answers with a problem: the alert takes focus, and a second failure is said again", "the connection drops after the press reached the server…", "an act refused for the person…", "a session idle past 15 minutes reads no visit and co-signs nothing, even on a request that says it is a prefetch", "an attending attests what they read whole; a note with a GU exam waits, says why, and a Program Admin attests it"); `apps/portal/src/lib/sign.test.ts` |
| The queues and the navigation by credential (unit L6, with its review): each link and Home card to a credential that may act, on one line of the sidebar; each note by its title, back after a correction, and why someone else has to act on it, in the visit page's words; nothing waiting; the copy of the credential table held to `permissions.ts` | 5.4, 9.14 | `attestation.spec.ts` ("each queue link and Home card shows to a credential that may act, one line each in the 240 px sidebar", "a note back after a correction…", "with nothing waiting, each queue and its Home card say so", and the queue rows of the tests above); `apps/portal/src/lib/credentials.test.ts`, `worklists.test.ts` |
| Notes not complete and Assign (unit L6, with its review): the list by the API's titles and names, and Home's count as the list counts; two drafts of one type told apart (PAX-5); no patient, link or Assign without `patients.view`, and who can assign said (PAX-4); Assign only where the assignees route answers, its picker exactly that list, through `/reauth` and back to the note's form (PAX-3), and its refusals; the assignee never told they wrote the note; the empty list | 3.8, 5.5, 5.6, 9.12 | `encounters.spec.ts` (the group "notes not complete, and Assign"); `apps/portal/src/lib/assign.test.ts`; the empty list in `apps/portal/src/app/(app)/encounters/[encounterId]/AssignForm.test.ts` |
| The export from the visit page (unit L6): offered by `hasHandoff`; through `/reauth`, then pressed again; the browser's time zone; the file's name; the page not read again; `no_handoff` and `cannot_see_red_flags` as states; no export from another site or by a GET | 5.7, 9.11 | `encounters.spec.ts` (the group "the EMS handoff"); `apps/portal/src/lib/handoff.test.ts` |
| The patient page's timeline (unit L6): the API's titles and states; links that load nothing until followed; the referrals by their recorder; Show earlier visits, with focus on the first new visit, on the Visits heading when none came, and on a failure; the chart read logging no visit, and a visit's link that one | 5.2, 7, 9.11 | `encounters.spec.ts` ("the timeline lists a chart’s visits and referrals, and Show earlier visits brings the next ones with focus on the first", "Show earlier visits on a chart of exactly 50 visits finds none…", "opening a chart logs no visit or note read, and following a visit’s link reads that visit once"); `encounters.test.ts` ("a visit on the timeline", "a referral on the timeline"); `apps/portal/src/lib/patient-links.test.ts` ("links to visit pages") |
| A route handler takes only the portal's own POSTs; one table of the refusals every page and handler follow (unit L6) | 9.11 | `apps/portal/src/lib/refusals.test.ts` ("the refusals every page shares", "a POST to a route handler"); another site's export in `encounters.spec.ts` |
| The portal's phase 4 screens: axe in three themes, reflow at 320 px, nothing in browser storage, no CSP violation, IDs only in addresses (unit L6, with its review) | 9, 10.2 | `apps/portal/e2e/a11y.spec.ts` ("a Program Admin’s phase 4 screens, and a visit page, are accessible in all three themes and reflow at 320 px"); the tests above, with `expectAccessible`, `expectReflow`, `expectNothingStored` and `expectOnlyIds`, at 1440 px and, those marked `@responsive`, at 390 px |
| The EMS handoff PDF: who may export it, when a visit has one, what reaches EMS whoever exports it, the header, the time zone, each note's state, the stamp, the file's name, the audit | 5.7 | `services/api/test/encounters-handoff.test.ts` ("phase 4: export the EMS handoff as a PDF", through the route; "phase 4: the EMS handoff PDF", the file alone); the Dart client's leaving out of an operation that answers a file in `packages/contract/test/dart.test.ts` |
| The seeded visits are what sync and the online attest write | 10.2 | `db/test/demo-encounters.test.ts` ("demo visits in the seed", "where the seed charts no visit") |
| No patient: Non-Medical only. Switching kind | 3.10, 4.3 | `sync-encounters.test.ts` ("the note’s create", "the encounter’s fields"); parity case 3 |
| The clock pause covers sign-offs, addenda and corrections, and the reopen, not referrals | 3.11 | `apps/mobile/test/sync/store_encounters_test.dart` ("Complete waits for the clock check, and writes nothing while it fails", "while the clock check fails, sign-offs, addenda and corrections wait; a referral does not"); the registry's `pausesWithClock` in `apps/mobile/test/patients/entities_test.dart` |
| The content hash | 4.5 | `note-content-hash.json` through `services/api/test/note-content-hash.test.ts` and `apps/mobile/test/encounters/content_hash_test.dart`; a missing patient or summary hashed as `null`, in the TypeScript test alone (a vector cannot hold undefined); `sync-signoffs.test.ts` ("the content hash"); parity case 8, which sends every case through a real sign-off |
| A note's create, its answers, `notCounted`, the 1,000-answer bound and `definition_error` | 4.1, 4.4 | `sync-encounters.test.ts` ("the note’s create", "a note’s answers"); parity cases 4 and 14 |
| The test-only note types are definitions the export would take, held by every test team | 4.4 | `sync-encounters.test.ts` ("the test-only note types"); `sync-reads.test.ts`; `apps/mobile/test/sync/test_note_types_test.dart`; the live job's install in `db/test/install-presets.test.ts` |
| A definition row is checked against its hash, its key and its version; two bounded maps | forms 3.3 (D79) | `services/api/test/forms-routes.test.ts` |
| The Medical gate, and the gate of a `needs` section, hold a change for review | 4.2 | `sync-encounters.test.ts` ("the Medical gate"); `sync-reads.test.ts` ("the Medical gate", and the `needs` section that holds the author's create, set and correction); parity case 12 |
| Every encounter-side change takes the team lock | 4.2 | `sync-encounters.test.ts` ("the team lock": every kind of change, and an encounter naming no patient); `services/api/test/sync-concurrency.test.ts` (two sign-offs and a kind change at once; a sign-off and a correction each wait for another writer) |
| What is accepted with no effect, in place of a refusal | 4.1 | `sync-corrections.test.ts` ("what is accepted with no effect, in place of a refusal: each row of the second table of 4.1"); `sync-reads.test.ts` (from someone who does not act as the author, whatever their credential); parity case 17 |
| Each route's permission, and its refusal logged; what is not logged | 5, 6.1, 10.1 | `services/api/test/permissions.test.ts` ("phase 4 encounter routes": each keyed route, the assign picker's list among them, the queues' credential refusals, a recent sign-in for assign and the handoff, Home's counts for any member); "what is logged of a refusal" in `encounters-cosign.test.ts`, `encounters-attest.test.ts` and `encounters-assign.test.ts`; a stale sign-in unlogged in `encounters-assign.test.ts` and `encounters-handoff.test.ts` |
| Sensitive content is absent, not blanked | 6.4 | `services/api/test/encounters-read.test.ts`; the timeline in `encounters-timeline.test.ts`, the queues in `encounters-queues.test.ts`, the handoff in `encounters-handoff.test.ts`; the sync read in `services/api/test/sync-reads.test.ts` ("the sync read of a note", "what hangs off a note, and referrals"), held on the fake by `apps/mobile/test/sync/fake_reads_test.dart` |
| A change the sender may not see, or of a note they may not read, is held; a retry is answered as they may see the field; the review queue shows only what the reviewer may read, and only such a reviewer accepts it | 4.4, 6.4 | `sync-reads.test.ts` ("a set of an answer the sender may not see", "a retry is answered from its receipt", "the review queue"); the same groups in `apps/mobile/test/sync/fake_parity_test.dart`, but the queue, which the fake has no route for; the queue page in `apps/portal/src/lib/quarantine.test.ts` and `apps/portal/e2e/phones.spec.ts` |
| An admin's accept of a held change meets the rule a push of it meets: over a field that holds another value since it is refused `cannot_apply` and the reviewer can only reject it; a field cleared since is filled; a summary on a visit whose note was finished since is kept in the visit's history (VS-1, D88) | 4.3, 4.4 | `services/api/test/sync-answers-sent-back.test.ts`, "an admin’s accept of the held set meets the rule a push of it meets (D88)" and "an admin’s accept is refused over an answer that holds another value since (D88)" |
| A held sign-off that will not reach the chart tells its sender, once per sign-off | 4.6 | `sync-signoffs.test.ts` ("a held sign-off that will not reach the chart tells its sender the note needs completing again: rejected, or refused on accept as the note changed", "each held sign-off is told once, whether or not an earlier notice was read"); the parity cases of those names; against the real API, `apps/mobile/test/sync/live_api_test.dart` ("each held Complete is told on its own: rejected twice before the first notice’s read arrives"); the phone's half in `apps/mobile/test/sync/store_encounters_test.dart` (group "receipts settle the effect (lifecycle 4.6, 4.8)") |
| A held sign-off's notice names its note, and since the second pass (VS-6) a held correction's does too; no other notice does; the phone keeps it with the notice, and settles nothing by it | 2.1, 4.6, 4.8, 4.10, 9.13 | `db/test/notice-note.test.ts` ("0022 the note a notice names": a note of the notice's own team only, by the key whatever the request may see; "0022 on a database that holds notices already"); `sync-signoffs.test.ts` ("a held sign-off’s notice names its note, rejected or refused on accept; no other notice names one", through the notices' list) and the parity case of that name; "a held correction refused at accept, or rejected, tells its sender, naming the note, with no text of it" and the parity case of that name; `store_encounters_test.dart` ("a phone that knows nothing of the sign-off keeps its notice with the note’s ID, as the sender’s own phone does", "the note a notice names settles nothing: the same note held again on another phone stays Sent for review"); against the real API, the live job's case about held Completes |
| While a sign-off is held, the refresh brings back an answer Complete dropped, and nothing shown changes (D106) | 4.4, 4.8 | `store_encounters_test.dart` ("while a sign-off is held, the refresh brings back an answer Complete dropped, and nothing shown changes"), which also holds that the accept's refresh takes the answer away (D107; until D107 it pinned the answer left on the phone), and that after a reject the draft is the server's |
| A finished note on the phone holds only the answers its sync read carries; a change of the person's own keeps its answer until its receipt (D107) | 4.5, 4.8, 4.10 | `store_encounters_test.dart` ("the author’s other phone drops an answer Complete dropped once the server finishes the note", "a change of the person’s own to an answer the finished note left out keeps its row until its receipt", "an answer whose refused change still waits keeps its row once the note is finished, until it settles", "a reopen after the refresh dropped an answer shows no ghost of it when its field shows again"), and the D106 test above; its accepted cost, an answer a correction hid (4.5): "an answer a correction hid leaves the phone at the refresh; shown again by an offline reopen, it costs a second Complete", "an answer a correction hid, typed over offline after a reopen, conflicts with the answer the server kept" |
| Completing again reads every notice that a Complete of the note was not applied, on any phone, and settles nothing else; the notice is filed under the note's patient on a phone that holds the note but not the sign-off (D107) | 4.8, 9.13 | `store_encounters_test.dart` ("completing again reads the notice on a phone that never held the sign-off; another held stays Sent for review", "a phone that holds the note but not the sign-off files its notice under the note’s patient", "a held sign-off’s notice read already, as another phone completed the note again, still settles it here") |
| The values of the new records, the same on both sides | 4.6, 4.7, 4.8 | `packages/contract/test-vectors/sync-values.json` through `services/api/test/contract-vectors.test.ts`, `apps/mobile/test/patients/entities_test.dart` (the registry) and `apps/mobile/test/sync/patient_rules_test.dart` (the fake) |
| A phone logs the EMS handoff shown and Notes to finish offline | 4.8, 10.1 | `sync-encounters.test.ts` ("offline reads of a visit"); parity case 15; `entities_test.dart` |
| Every kind of record has a name on the phone and in the portal | 9.13 | `apps/mobile/test/features/sync_labels_test.dart`; the portal's `SYNC_ENTITY` is typed by the contract |
| Every action writes its audit event in the same transaction, with no answer in it | 10.1 | `expectAudit` and `expectAuditClean` in each API test above (`services/api/test/patient-fixtures.ts`), and in the encounters tests `eventsAfter` and `expectNoneOf` (`services/api/test/encounters-fixtures.ts`) |
| A visit read offline is logged or refused | 9.7 | `apps/mobile/test/encounters/visit_read_test.dart` (the rows below) |
| A visit read from the phone: each record logged in the read's transaction, only what a re-read adds, nothing while frozen, never paused for the clock; what each reader sees; notes in the order the server made them, people named as their records name them (D108); the state as the phone knows it | 5.1, 6.4, 9.7, 10.1 | `visit_read_test.dart` (groups "what a read logs (lifecycle 9.7, 10.1)", "who and when, as the sync read gives them (D108)", "what the reader sees (lifecycle 6.4)", "the state as this phone knows it (lifecycle 3.1, 4.8)"); the Dart copies of the read rules in `visibility_test.dart`, held to the test server's copies and the API's named cases, and of the credential table in `credentials_test.dart`, held to `permissions.ts` and the portal's `labels.ts` |
| Start, Switch to Medical, the note types offered, a draft of the type opened, but not a removed note whose fix waits to send, nor, once the fix has settled, before a draft of theirs with answers; Remove this note all or nothing | 3.3, 3.10, 9.2 to 9.4 | `start_test.dart` (groups "Start (lifecycle 9.2, 9.3)", "Switch to Medical (lifecycle 3.10, 9.3)", "Note types (lifecycle 6.2, 9.4)", "Remove this note (lifecycle 3.1, 3.4, 9.4)"); `expand_quick_test.dart` ("once a removed note’s fix has settled, Add note and Expand open the draft with answers made after it, not the removed empty one (lifecycle 3.3, 12.1 #30)") |
| An answer checked, saved, and not sent when it changes nothing; read-only where the server would hold it, an ordering credential's section to its author too; a cleared answer waiting to send; a conflict's values, the one Use my value sends, and none the reader may not see | 9.5; forms 8.1 | `note_answers_test.dart` (groups "what the person may not change is read-only to them (lifecycle 6.4 rule 5, 9.5)" and "two people changed one answer (forms 8.1, lifecycle 9.5)"; "a teammate helping on a draft sees their own cleared answer waiting to send (review LFM-3)", "Keep theirs, then a new conflict: “Your value” is the value the choice carried, which Use my value sends (review LFM-1)"); the field host's side in `apps/mobile/test/features/forms/field_host_test.dart` ("“Your value” is the value the choice would send, when the domain layer gives one (review LFM-1)", "a diagnosis’s one choice shows the values the choices would send (review LFM-1)") |
| Complete's plan and call: what it finishes, the act and the button by credential, the signing sentence, settle-only notes, each stop, each refusal worded, the recap from the read that hashed it; the assessment | 3.3, 3.5, 9.6 | `complete_test.dart` (groups "what Complete finishes, and how (lifecycle 3.3, 3.5)", "what stops Complete (lifecycle 3.3, 9.6)", "Complete, and each refusal worded for the summary (lifecycle 4.8, 9.6)", "the assessment (lifecycle 3.1, 9.6)"; "the summary draws each note’s recap from the read that hashed it (review LCM-7)") |
| Reopen, addenda and corrections, offered and refused as the server would take them; a correction's version, after Keep theirs and on a note expanded before its sync; an answer Complete dropped, corrected back, and a refusal of one made before D109 settled by Correct again (`correctAgain`); an answer a correction hid, shown again by a later correction from no version (review F2, the reviewer's probes B and C); a change to an answer that stays hidden left out, alone refused as no change (review F4, probe D); two corrections made offline in a row, the first hiding the detail the second changes beside the pulse, and a never-held hidden detail beside the pulse that the read leaves alone (review R1); Correct again with the version now seen after a correction made elsewhere first; Correct again refused on a note reopened since or one someone else now acts as the author of, each settled by Leave it (review R3); Leave it leaving out an answer the phone holds no row of (review R2); a teammate's note the reader may not read; a note that has left the phone | 3.6, 4.7 | `note_actions_test.dart` (groups "Reopen (lifecycle 3.6, 4.4)", "Addenda (lifecycle 3.6, 4.7)", "a teammate’s note the person may not read (lifecycle 6.4)", "Corrections (lifecycle 3.6, 4.7)", "a note that has left the phone (lifecycle 4.8, 8.2)"); `expand_quick_test.dart` ("a correction of the full note before its sync reads each answer at the version its create gave it (review LCM-5)") |
| The close sweep: what leaves the phone and what stays, a Medical visit's finished notes while a draft of it stays, the 7 days by a verified clock; the services made for each team, the sweep after every sync | 3.2, 8.2 | `close_sweep_test.dart` (groups "a finished note leaves the phone (lifecycle 8.2)" and "a draft stays until it is finished, or untouched for 7 days (lifecycle 3.2)"); `encounter_services_test.dart`; the shared app harness in `app_wiring_test.dart` |
| The Red flags note: added with a person's Medical note in the same change, and when their Medical draft opens again; never a second; none for a teammate's draft; added by the summary at hard stop 5; shown last | 3.3; forms 6.2 | `red_flags_test.dart` (groups "the app adds the Red flags note (forms 6.2)", "hard stop 5 (lifecycle 3.3)", "where it shows (forms 6.2)") |
| Expand: the parts offered, what is written and what is left out, an ordering credential's part not carried, a draft of the type opened as it is and a finished one read-only, the phone's or one the visit read shows (12.1 #30), but not a teammate's the person may not read, the Red flags note it brings, and none when the visit read shows a finished one, what it refuses; the control and its words | forms 6.4 | `expand_quick_test.dart` (groups "the parts a quick form offers to expand (forms 6.4)" and "Expand (forms 6.4)"); `apps/mobile/test/features/forms/note_form_expand_test.dart` |
| Add to the problem list: under a diagnosis, the status mapped, the same problem coming back, a sensitive Resolved problem asked of a reader who may see it only | 8.3 | `problem_list_test.dart`; `apps/mobile/test/features/forms/problem_field_list_test.dart` |
| A problem, a problem's note and an allergy name their visit, and another patient's visit is refused here; "at a visit" only while the visit is the group's | 8.3, 8.4 | `apps/mobile/test/patients/problems_test.dart`; `referrals_test.dart` ("a visit the phone doesn’t hold is “a visit” of the chart only when the chart lists it as the group’s (review LRA-3)") |
| A problem's note names its problem's patient in its snapshot, and the phone logs a read of it on that patient (review finding LRA-1) | 8.4, 10.1 | `services/api/test/problems-sync.test.ts` ("a note on a problem names the problem’s patient in its snapshot (lifecycle 8.4, review LRA-1)"); `encounters-read.test.ts` ("lists them, whichever chart they are on, as the chart would show them to the reader"); the parity case "a note on a problem names the problem’s patient in its snapshot"; `encounter_api_test.dart` ("a problem’s note that names its patient, as the server snapshots one now, is logged on that patient before its problem is asked (review LRA-1)") |
| Referrals: the list and its log, Add referral and Entered in error, at a visit | 7, 9.10 | `referrals_test.dart` (groups "the list (lifecycle 7, 9.10)", "on whose chart, at which visit (lifecycle 8.4)", "Add referral (lifecycle 4.7, 9.10)", "at a visit (lifecycle 7, 8.4, 9.7)", "Entered in error (lifecycle 4.7, 7)") |
| The records made at a visit the phone holds: by kind, as each chart shows them, each logged once on its own patient; on another chart once the visit moved | 8.4, 9.7 | `visit_records_test.dart` |
| The online calls: a visit read from the server, a cached recent visit logged on each record's own patient, the recap lines (D108), Co-sign and Attest planned by the server's rules and only on a visit read online, each refusal worded, the queues and Home's tiles | 5, 9.7, 9.9 | `encounter_api_test.dart` (groups "a visit read online (lifecycle 5.1, 8.2, 9.7)", "co-sign and attest (lifecycle 3.7, 5.3, 5.4, 9.7, 9.9)", "the queues and Home’s counts (lifecycle 5.4, 5.6, 9.9)"; "a recent visit logs each addendum and correction of its notes, and each record made at it on that record’s own patient, the visit moved or not (review LRA-1, LRA-2)"), against scripted answers (`scripted_api.dart`); against the real API, `live_domain_test.dart`, which `tools/live-sync.sh` runs: Expand and Complete with the Red flags note the app added, a correction of an answer Complete dropped (D109), and of one a correction hid, shown again, with a change to it while hidden refused as no change (review F2, F4), co-sign, attest, notes to finish, Home's counts and earlier visits |
| Notes to finish: the phone's drafts merged with the server's list, logged; Home's tile | 3.9, 9.9 | `notes_to_finish_test.dart` |
| The timeline: the chart's list merged with the phone's visits, a note hidden from the reader left out though the chart lists it, the filter, earlier visits | 5.2, 9.1 | `timeline_test.dart` |
| The cached chart: its timeline, last visits and referrals kept and replaced whole; one cached before D108 still opens offline | 5.2 | `apps/mobile/test/patients/chart_cache_test.dart` ("a chart keeps its timeline, its last visits and the group’s referrals, offline, for its 24 hours", "a refresh replaces them whole, so they follow a role or credential change; offline, they stay"); `cached_chart_test.dart`; against the real API, `apps/mobile/test/patients/live_patients_test.dart` ("a problem added at a visit reaches the chart as made there; the chart keeps the visit offline") |
| The domain layer imports no widget library and no screen | 4.8 | `layering_test.dart` |
| `referrals` is a chart table | 2.5 | the schema test in `services/api/test/patients-charts.test.ts:334-351` |
| Start, New encounter, the kind, the encounter screen and Note types (unit L5, with its review): Start's one choice, none for a role that doesn't chart; Who, Where and the kind, the visit written only at the last step, and nothing while the clock check fails, its sentence shown first; Who skipped from a profile; No patient; a credential not asked the kind; each search a run of its own; New patient back at Where with the new patient; a freeze at the next build; the notes by their recaps, a teammate's by name; Remove this note asked first; Switch to Medical asking who first; reading only once on top; a draft's line and Add another | 9.2 to 9.4 | `start_sheet_test.dart` (both tests); `new_encounter_screen_test.dart` ("started from a profile, Who is skipped and the visit is for that patient", "a credential that can’t chart Medical is not asked the kind: its visit starts Non-Medical", "while the clock check fails, Start says why and writes nothing (D35)", "New patient opens the intake, which comes back to Where with the new patient", "each search is a run of its own, logged before it shows, its count said once", "a freeze for a hand-over: what was read goes at the screen’s next build, whatever causes it", and the rest of its file); `encounter_screen_test.dart` ("Remove this note asks first, then blanks every answer, and the note counts for nothing", "Switch to Medical on a visit with no patient asks who first, then sets both", "covered by the note’s form, the screen reads nothing at each answer, and catches up after", "the visit stays on the phone while it shows, and the close sweep may take it after (8.2)", and the rest); `note_type_list_test.dart` |
| Use my location (unit L5, with its review): nothing asked before the tap; the permission asked only when never decided; one fix, kept as the phone gave it; a fix the server would refuse counts as none; each refusal said, the place typed working without it; Remove; focus following; a late fix dropped; offline, then synced | 9.2, 12.1 #15 | `location_field_test.dart` ("no tap, no place: the phone is never asked", "already allowed: the permission is checked, not asked again", "each refusal said plainly, the place typed working without it", "a kind chosen while the phone still looks starts the visit without the place", "focus follows from Use my location to Remove and back, for a screen reader", "offline, then synced: the server holds the place as the phone gave it", the group "placeOf: a position the server takes, as the phone gave it"), through a fake of the plugin (`fake_location.dart`) |
| The note screen (unit L5, with its review): the frame and the allergy badge; Save & Close while typing, to the chart under the visit; D92's answers drawn read-only before a tap, in the five runs, and Normal leaving them; a conflict's choice synced; the clock pause; a frozen store; large text; the form's actions (card F7-actions): an action whose type can't be started not drawn, Go to Red flags opening a teammate's finished note and logging only it, Add referral | 9.5; forms 6.2, 8.1 | `note_screen_test.dart` ("an answer the server would hold from a non-author is drawn read-only before a tap (D92)", "at large text a refusal stays in sight under the form while the buttons end the list", "charting paused for the clock: the form can’t be changed, and says why", "a frozen store shows nothing of the note", and the rest of its file); `note_screen_actions_test.dart` ("a teammate’s finished Red flags note makes the person’s needless: it opens read-only", "an action whose note type can’t be started in the visit is not drawn", and the rest); `apps/mobile/test/features/forms/note_form_normal_test.dart` ("an answer the screen says is read-only is drawn so and Normal leaves it (D92)") |
| The summary and Complete (unit L5, with its review): the recaps, a teammate's draft, what stops Complete; a stop's line opening its note, hard stop 2's opening Needs attention; the button by 3.3; a note changed since it was drawn, by a press while typing or by a teammate's change a sync brought in; the locked assessment, and Save & Close asking before it drops an addition; hard stop 5 adding the person's own Red flags note, and none beside a teammate's finished one that only the server holds; the whole Referrals sheet, at the visit; what Complete and Save & Close did, said on the chart | 3.3, 8.2, 9.6; D113 | `summary_screen_test.dart` ("a teammate’s change a sync brings in is said above its recap, and Complete asks for one more look", "a teammate’s finished Red flags note only the server holds: none of the person’s own is added, from the note types list or the summary (8.2, D113)", "what Complete did is said on the chart, by its button", "Save & Close with something added to a locked assessment asks before dropping it", "hard stop 2’s line opens Needs attention", "Add referral opens the whole Referrals sheet; a referral added there is made at the visit", and the rest of its file) |
| The visit screen (unit L5, with its review): online, the server's read first within its limit, the phone's own work drawn over it, each record logged once; a queue row for a visit the phone holds showing the teammate's note with Co-sign; a co-signature made elsewhere on a note the phone holds; offline, or a server too slow, the phone's copy saying what others added may be missing; Co-sign and Attest from the read's marks with its hashes, a copy read elsewhere read there first, greyed offline; why a note waits; the read's preferred name and its "on another chart now"; an assigned note's By line; the person's own server draft opened once fetched; a read again logging only what it adds; Reopen asked first; Add or remove notes after Save & Close; each note read in order, each action by its own tap | 5.1, 9.7, 10.1; D112 as amended | `visit_online_test.dart` ("a queue row for a visit the phone holds, without the teammate’s note: the server’s read shows it, with Co-sign, and the person’s own draft drawn over it", "online, the server’s read comes first: a co-signature made elsewhere shows on a note the phone holds, and offline the phone’s copy says what may be missing", "a server that doesn’t answer in time: the phone’s copy shows, saying what may be missing", "a patient the phone doesn’t hold is named by the read’s preferred name; “On another chart now” is the read’s own answer", "the person’s own draft read from the server opens once it is brought to the phone", "a note assigned to someone else names who acts as its author, never its writer (D108)", "when the server’s read failed as it opened, Co-sign reads it there first, then signs what was read", "a note with a part the person can’t open says so, and offers nothing to sign", "offline, Co-sign is greyed: Connect to co-sign", and the rest of its file); `visit_screen_test.dart` ("a read again logs only what it adds", "Reopen: a student’s note waiting for a co-signer goes back to a draft, asked first, and opens", "after Save & Close, the visit reached from the timeline offers Add or remove notes: the encounter screen, with Add another note type and Switch to Medical", and its main test's reading order) |
| The correction and addendum sheets (unit L5, with its review): an answer, its value now and its own input, a reason, saved offline; the patient's request; another answer added and removed; the answers `incomplete` names; 4,000 characters counted as the server counts them; a freeze taking each sheet off the screen; each action by its own tap; Correct's read logging only what the screen hadn't shown | 3.6, 9.7 | `correction_sheet_test.dart` ("a freeze while the sheet is open takes the answer off the screen (phase 3’s V1)", "Correct acts by its own tap action, and its read logs only what the screen hadn’t shown", and the rest); `addendum_sheet_test.dart` ("a freeze while the sheet is open closes what it shows", "Add addendum acts by its own tap action", "the box stops at 4,000 characters, counted as the server counts them", and the rest) |
| The EMS handoff on the phone (unit L5, with its review): full screen, logged with its read, in high contrast; built for EMS whoever shows it; headed by the preferred name alone; offered while charting waits for the clock, on a teammate's draft the person may read, and under a finished note on the visit screen; nothing while frozen | 5.7, 9.8, 10.1; D93, D94 | `handoff_screen_test.dart` (each of its seven tests) |
| Home's tiles, Notes to finish and the queues (unit L5, with its review): each tile to a credential that may act, online only with the server's number; a queue asked again once on top; why a note waits, in the visit screen's words; Notes to finish's rows, a draft not on the phone fetched first, a refusal under its row; nothing while frozen | 5.4, 5.6, 9.9 | `queue_screen_test.dart` ("online, a tile the server gives no number for is not shown: its word wins", "each tile shows only to a credential that may act", and the rest); `notes_to_finish_screen_test.dart` |
| The profile's timeline and the Referrals sheet (unit L5, with its review): the chart's visits and the phone's, newest first; the filter; a chart from the team's list; Show earlier visits; + Encounter and + Referral by role; the heading and its sentence read apart; the referrals, Add referral and Entered in error, by who may do each, their results said inside the sheet; "Recorded by" by the server's name | 7, 9.1, 9.10 | `profile_timeline_test.dart`; `referrals_sheet_test.dart`; `apps/mobile/test/encounters/referrals_test.dart` ("“Recorded by” names a teammate who recorded one by the name the server gives, held or listed") |
| Needs attention for a note's life (unit L5, with its review): each problem's and notice's sentence; Open the note; Correct again and Leave it; a note's answer named by its form's labels; a refused answer settled by the next save; Choose a patient, Choose a visit (in the five runs), Send without the visit and Remove this note, each settling its refusal; what Choose a visit leaves out and refuses; nothing read or sent while frozen | 4.1, 8.4, 9.13 | `needs_attention_test.dart` ("two people changed a note’s answers: named by the form’s labels, chosen on the note, no codes", "an answer the server refused settles once it is changed: the next save is its fix", "a clinical note refused for a visit with no patient: Choose a patient names it, and the note goes", "a referral at a visit that moved to someone else: Choose a visit makes it at another of theirs", "a referral at a visit the team never had: Send without the visit makes it at no visit", "a note on a version the team moved on from: Remove this note settles it, and its type opens anew", and the rest of its file); `apps/mobile/test/encounters/refusal_fixes_test.dart` (each of its four); `apps/mobile/test/features/sync_labels_test.dart` ("each problem a worker can fix has the design’s sentence (lifecycle 4.1, 9.13)", "every notice of a note’s life has a sentence of its own (lifecycle 4.10, 9.13)") |
| Every question these screens ask reaches its buttons (unit L5's review): Remove this note, Switch to Medical, Reopen and Entered in error in the five runs and at 200% text on a 320 px phone; phase 3's reason dialog at 200% text, at 390 and 320 px | 9.3 as built | `dialogs_test.dart` (each of its tests) |
| The domain layer's changes for the screens (unit L5's review): Co-sign and Attest from the server read's marks, the phone's rule only on a copy read elsewhere; the `is_author` wording; the finished Red flags note asked once, and none without signal, for a visit the server lacks or after the limit | 4.8, 5, 8.2 | `apps/mobile/test/encounters/encounter_api_test.dart` ("read from the server: the notes it marks for the reader, whatever the phone’s own rule says", "a copy not read from the server: nobody is offered to co-sign a note they wrote or completed, nor a credential that can’t sign", "the refusals name everyone a note’s author covers, so no assignee is told they wrote it", and the group "a teammate’s finished Red flags note the phone lacks (lifecycle 8.2, D113)") |
| Every screen: three themes, 200% text, 320 px, labels, offline, nothing once frozen | 9 | one widget test file per screen under `apps/mobile/test/features/encounters/`; the portal pages in `apps/portal/e2e/` with axe |

As built (unit L2, with its review), two checks bite no test and stay as a second line: the
visit read's own check that a visit is the team's, since row-level security hides another team's
visit before it (5.1); and the handoff's `visibleAnswers` for the exporter before EMS's, since
EMS is sent no more than any reader of a note may see (5.7; `encounters-handoff.test.ts` says
why).

As built (unit L3's store, with its review), one check bites no test and stays as a second line:
a `signoff_not_applied` notice clears a note's `localEffect` only when the effect names the notice's
sign-off. The notice settles by the held record of its own sign-off first, so no call through the
store's API can show the difference (review finding SRC-7).

As built (the phone's domain layer, units L4 and F7, with their review): the rows from "A visit
read from the phone" to "The domain layer imports no widget library" name its tests, each under
`apps/mobile/test/encounters/` unless named otherwise. Each works offline first, then syncs to the
phone's test server where the store is involved; the online calls, which the test server lacks, run
against scripted answers and, in the live job, against the real API. Each rule was taken out by a
script and its test seen to fail, by its builder and again by the review, whose findings each added
a test that fails without its fix. One check bites no test and stays as a second line: the ID that
breaks a tie between notes the server made at the same `createdAt`, since the store gives records
in ID order already; it guards a store read in another order. And one is tested only in part: a
correction of the reader's own named by their display name in the read model, since a correction
made here has no outcome until a refresh, which brings the server's `correctorName` with it; the
same fallback is tested on the reader's own notes, sign-offs and addenda.

As built (unit L6, with its review): the portal's rows, from "The visit page" to "The portal's
phase 4 screens", name its tests, each under `apps/portal/` unless named otherwise; the end-to-end
ones run against the real API and the seeded team. Each rule was taken out by a script and its test
seen to fail, by its builder and again by the review, whose findings each added a test that fails
without its fix; the page reviewer's mutations of rules no test held each fail one now. Three
states are held another way. The empty Assign list is drawn by a server render
(`AssignForm.test.ts`), not end to end, so neither axe nor the 320 px check runs on it: the seeded
team's Program Admin is an attending who reads everything, so may take any note, and only a
platform owner, from outside the team, could change that. `?handoff=failed` is loaded by its
address alone, since no honest act makes the API fail an export. And a dropped connection is the
one place a test stops the portal's own traffic (`page.route`), before the request leaves and
after the server answered.

As built (unit L5, with its review): the phone's rows, from "Start, New encounter" to "The domain
layer's changes for the screens", name its tests, each under `apps/mobile/test/features/encounters/`
unless named otherwise. Each screen's main test runs in the five runs (Day, Night run and High
contrast, 200% text, a 320 px phone) with the guideline matchers and the private-field check
(`expectScreenOk`), offline first and then synced against the phone's test server; the online
calls, which the test server lacks, are scripted in front of it (`EncounterRoutes` in the kit,
`scripted_api.dart`). Since the review the tests also read a screen in the order a screen reader
does (`readingOrder`, over `simulatedAccessibilityTraversal`) and press its controls by their own
tap actions (`semanticTap`), so a control drawn without one fails (review findings SAX-2, SAX-4,
SAX-5). Each rule was taken out by a script and its test seen to fail, by its builders and again in
each round of the review's fixes, whose seventeen sets were all run again on the last fix. Three
checks bite no test and stay as a second line: Save & Close's flush of the box being typed in,
which saves anyway as it leaves the screen; `sentToEms` keeping only what the person showing the
handoff sees, which no note the phone holds can reach today, as the server's copy of the rule; and
the handoff's own theme, since full ink is 7:1 or more in every theme. Add referral's need for a
patient is held by its type, not a test. Held another way: the merged Android manifest without the
plugin's location service, and one fix on a device, wait for the Android build, which could not
run here (13, "Not built in this phase").

As built (the whole-phase review and its second pass, Nov 21): each confirmed finding's fix came
with a test that fails without it, checked by a script that takes the fix's source out in a scratch
worktree and runs the tests it added, and by mutating the rules the reviewers named; the second pass
read each fix again and found the ones no test held yet (VS-2, VS-4, VS-5, VA-2, VX-7, C-5), and the
second round of fixes added their tests. The new tests are mostly in
`services/api/test/sync-answers-sent-back.test.ts` (what a value sent back shows and logs, the held
summary and the held conflict), `sync-signoffs.test.ts` (an addendum or a correction naming a
sign-off a reviewer rejected, taken as naming none, and not once that sign-off is completed again
under its ID; a held correction's notice) and `encounters-acts-audit.test.ts` (each act's event in
its transaction, `cannot_read`, assign under the lock); on the phone in
`test/sync/store_encounters_test.dart` and `live_api_test.dart` (Complete sends what waited on its
sign-off), `fake_parity_test.dart` (the fake's copies), `test/encounters/visit_overlay_test.dart`
(no act on the phone's own copy), `test/security/dialog_gates_test.dart` and
`test/features/encounters/freeze_pickers_test.dart` (every modal route gated),
`test/features/patients/phi_field_menu_test.dart` (the private box's menu and copy), and
`needs_attention_test.dart`, `referrals_sheet_test.dart`, `profile_timeline_test.dart` and each
screen's own test (the cards, the dates, what is said and where focus goes); and the portal's
`encounters.spec.ts` (the page notice). Two are held another way: Expand's “not copied” dialog by
the gate test alone, since no released note type brings it up on the test harness; and a soft
keyboard's own Copy, which no test here drives and which is not covered (10.2, plan risk 10).

## 12. Defaults, risks and departures from the PRD

### 12.1 Defaults chosen

Each is a `PLAN-OPEN:` comment in the code and a row in the plan's section 6.

| # | Question | Default built | Who decides |
|---|---|---|---|
| 1 | Does a note signed offline count as signed at device time or at server receipt? (PRD main 452) | Device time, clock-corrected, with the receipt time stored beside it (plan section 6) | Counsel and the billing partner |
| 2 | The PA rule (PRD main 212) | A PA signs like an NP: attestation needed | Brooke and Mercy, the FQHC partner |
| 3 | May a note be added to a visit whose other notes are finished? | Yes. It is its own note with its own author and time (4.4) | Brooke and Mercy |
| 4 | How long does an untouched draft stay on its author's phone? | 7 days after its last change, then it is released if fully synced (3.2). As built, the change as the phone sees it, its own or a teammate's brought in by a sync, counted only by a clock the phone has checked, and released once nothing of it waits, to send or in Needs attention (8.2) | The team |
| 5 | The wording a signer, a co-signer and an attester are shown | The three sentences of 3.5, each with a version | Counsel |
| 6 | May a resident, NP or PA co-sign a student's note, or only an attending? | Any credential that signs; the note then waits for attestation if that credential needs it (3.7) | Brooke and Mercy |
| 7 | May the clinician assigned to a departed author's note complete its draft, or only correct it? | Both (3.8) | Brooke and Mercy |
| 8 | Can a co-signer send a note back to its author? | No. The author reopens it while it was never signed (3.6) | Brooke and Mercy |
| 9 | How is a wrong free-text assessment fixed after Complete? | By an addendum, not a field correction (3.6) | Brooke and Mercy |
| 10 | What does a patient's amendment request need beyond the logged decision? (HIPAA §164.526: a written answer in 60 days, a statement of disagreement) | Only the logged request and decision are built (3.6) | Counsel |
| 11 | Can a Medical note be written for someone who is not registered? | No. A Medical note needs a patient; a visit can be given one at any time (3.10). As built, a Medical visit names its patient from Start, as Switch to Medical asks for one first | Brooke and Mercy |
| 12 | Where does the EMS handoff PDF come from? | The portal. The phone shows it full-screen only, and its generated client leaves the route out (5.7) | The team |
| 13 | Who sees a sensitive exam section, and who may co-sign or attest a note that has one? | Whoever acts as the note's author, and holders of `patients.view_sensitive_exams`. A co-signer or attester needs the key too, so a team gives its attendings a role that has it; until then such a note waits (6.4) | Counsel, Brooke and Mercy |
| 14 | The Brief call note preset (PRD main 390) | Not built: the field spec has no fields for it | Brooke and Mercy |
| 15 | Is the GPS position stored, and how exact? | Captured only on a tap, stored as the phone gives it (9.2) | Counsel, the team |
| 16 | How do a note's problem statuses (New, Chronic, Improving, Worse) map to the problem list's (New, Ongoing, Resolved)? | New to New; the others to Ongoing; nothing resolves (8.3). With no status, the person chooses New or Ongoing, as on Add problem | Brooke and Mercy |
| 17 | How many recent visits ride with a chart, to be read offline? | Three (5.2) | The team |
| 18 | Who may export the EMS handoff as a PDF? PRD main 413 lets a clinician; PRD main 602 keeps exports to Admin and Billing/Data | Whoever may read the Red flags note, with a fresh sign-in, a stamp of who and when, and an audit event; anyone else is refused `cannot_see_red_flags`, and the refusal logged (5.7) | Counsel, the team |
| 19 | Is a Social needs or Outreach note inside a Medical visit signed and attested? | No. A Non-Medical note is completed, never signed (3.1) | Brooke and Mercy, the billing partner |
| 20 | Who reads the substance use treatment part of a Harm reduction note? | The note's author, and people with `patients.view_sensitive` and a clinical credential (6.4) | Counsel (42 CFR Part 2) |
| 21 | Do roles without `encounters.chart` or `billing.view_codes` read Medical notes? | No, as D37 decided for the problem list (6.4) | The project lead |
| 22 | Which credential is a signature or a correction recorded under when its time cannot be trusted (the clock not verified, more than five minutes after the receipt, before the server received the note, or a time that cannot be read)? | The one held when the server receives it, with the phone's claim stored beside it; the claim can still make it wait for attestation (3.5) | Counsel and the billing partner |
| 23 | What is a person shown when they complete a note without signing it, and which version is stored? | A `complete` carries a statement version as a `sign` does (`complete-2026-11` in the tests); its sentence is not written yet, and 3.5's table has none. The server stores the version the phone sends, any text of 1 to 40 characters from `a-z`, `0-9`, `_`, `.` and `-`, and checks it against no list (4.6). An online co-sign or attestation stores the version the portal sends the same way (5.3, 5.4) | Counsel |
| 24 | Does a correction record the wording its corrector was shown? | No. A correction carries no statement version: its row's corrector, credential, time and reason stand as their signature on the change (3.6, 4.7) | Counsel |
| 25 | Where do the records made at a visit go when the visit moves to another patient? | They stay with the first patient, still naming the visit; the visit screen lists them so the clinician can find each and enter it in error (4.3, 8.4, 9.7) | Brooke and Mercy |
| 26 | Does the review queue name the rule that held a change? | No. A change held by a rule shows the reason `permission` alone: which rule held it (the Medical gate, a section's `needs`, the sensitive set check, a note the sender may not read) is not stored, and `sync.quarantined` names none (6.4, 10.1). Still open: L6 built no review queue, so phase 2's stays as it was | The team |
| 27 | What of the patient does the EMS handoff PDF's header carry? (forms 10.1 #6 says the summary's comes from the chart) | Their preferred name, their age in years and their allergies, from their chart as the exporter may see it, the allergies worded as the phone's allergy badge words them; never the legal name or the birth date. The file's name and metadata name no patient (5.7) | The clinical team (Brooke and Mercy), counsel |
| 28 | Which time zone are the EMS handoff PDF's times printed in? | The reader's, which the portal sends as an IANA zone's name, checked against the zones the server knows, and printed beside each time; without one, UTC, labelled UTC. No team has a time zone yet; one can come with routes (phase 7) (5.7) | The team |
| 29 | Should a note of a sensitive type, or a sensitive exam's findings, reach EMS in the handoff PDF? | No, whoever exports it: EMS is read as a reader of Medical notes without `patients.view_sensitive` or `patients.view_sensitive_exams`, and the file holds only what both the exporter and EMS may see, as D82 keeps treatment records and sensitive diagnoses out. Such a note is not named among the notes the export's event lists. The phone's full-screen summary is held to the same reader (9.8, card F7-handoff) (5.7) | The clinical team (Brooke and Mercy), counsel |
| 30 | What does Expand on a quick note do when the visit already has a note of the full type? (forms 6.4 says it "creates the full note type") | The draft the note types list would open is opened instead (the person's own first, then a teammate's they may see), as it is: nothing is copied into a draft that holds answers, so no second wound or set of vitals is written and no answer is written over. Else a finished note of the type the person may see (their own or a teammate's), on the phone or in the visit read online or from the cached chart, opens read-only, nothing copied, and an addendum or a correction adds to it. Only then is the person's own empty draft of the type filled as a new note would be, and the form says under Expand which a tap will do. A visit read that shows a finished Red flags note brings no second one, as with Add note (forms 6.4; unit F7; the coordinator's decision of Nov 18) | Brooke and Mercy |
| 31 | Who may be assigned a note whose author left, when it holds, or its type could hold, a sensitive exam, a treatment record or a sensitive diagnosis? | Only someone whose role would see each of them. Where the person assigning sees such content, by what the note holds; where they could miss it, by the note's type and the assignee's keys, whatever the note holds, so the list tells them nothing they may not read (5.5; review finding PRD-1, the coordinator's decision of Nov 20). A note no active member qualifies for stays in Notes not complete. A note that holds such content needs someone who may see it, whoever assigns it; its type alone keeps it from someone only where the person assigning may not see that content (a manager whose role reads no sensitive exam, a Program Admin with no credential before a treatment record). So on a team whose attendings hold no `patients.view_sensitive_exams`, a General / primary care note stalls only when it holds a GU, breast or rectal exam, or when someone who reads none assigns it | Brooke and Mercy |
| 32 | May Use my location ask Google's location service? | Yes. `geolocator` (MIT) asks Android's fused provider, through Google Play services' `play-services-location` 21.2.0 (Google's SDK terms), wherever Play services is on the phone: one fix, only on the tap, kept as the phone gives it (#15). On most Android phones the location service is Google's whatever a plugin is told, so forcing the platform's own provider would change little, and the team's device policy decides whether Google's location accuracy is on. The Play services libraries are outside `pubspec.lock` and its osv scan (plan risk 9) (9.2) | The security questionnaire and counsel |
| 33 | How far ahead may a referral be dated while the phone's clock is unchecked? (review finding PS-3) | No later than the phone's own day, its local day or the UTC day where that is later; with a checked clock, up to a day ahead by the corrected date, as the server takes it. One the server refuses as in the future (`referral_in_future`) gets Change the date in Needs attention (3.11, 9.13 as built) | The team |
| 34 | What happens to an addendum or a correction whose sign-off a Program Admin rejected in review? (review findings PS-2 and VS-6) | It is taken as naming none: an addendum is added to its note, and a correction that then reaches a note never finished is an edit of the draft, with its reason. A held correction whose accept is refused, or that is rejected, tells its sender to correct the note again (`correction_not_applied`, naming the note, with no text of it) (4.6, 4.7 as built) | Brooke and Mercy |
| 35 | What does Remove this note keep of a note the server refused for a version of its type the team no longer lists? (review findings PS-4 and VS-3) | Its answers, in the server's history: the note is sent again on another listed version of its type that takes every answer it holds, carrying them, then each is cleared, so it counts for nothing. With no such version, or a type the team no longer lists at all, it stays in Needs attention: "This note can’t be removed on this phone. Tell a Program Admin." (4.1, 9.13 as built; D121) | Brooke and Mercy |
| 36 | May a Program Admin's accept put a held change over a value its sender never saw? (the coordinator's decision on the second pass's open question; review finding VS-1) | No: it is applied as it was made, at the version it named, by the rule a push of it meets, so over a field that holds another value since it is refused (`cannot_apply`) and the reviewer can only reject it; a field cleared since takes it, and a record that takes no more values keeps it in its history. A Medical visit's summary set by a sender who may not read it, and a conflict its sender may not see into, are always held; a reviewer who may read both writes the value themselves (4.3, 4.4 as built; D88) | The team |
| 37 | What may a private box's selection menu do with chart text, and how long does a copy last? (review findings PP-3, C-2 and C-4) | Only cut, copy, paste and select all, in every box that takes a patient's details or a note's text, the birth date box's included. Copy and Cut, from that menu and a hardware keyboard's shortcuts, go through `secureCopy`: on iOS a local-only item cleared after 60 seconds; on Android a clip marked sensitive (honoured from Android 13), cleared after 60 seconds if the app is in front then, otherwise (from Android 10) once it is back in front, and never if Android ended the app first; the 60 seconds are phase 3's Android clipboard rule; a refusal copies nothing. A soft keyboard's own Copy is not covered (10.2; D126; plan risk 10) | The project lead |

Rows 23 to 26 came from wave D's review of the sync half. Row 25's `PLAN-OPEN:` comment is on
the encounter's `afterWrite` (`services/api/src/sync/entities/encounter.ts`), row 26's on `hold`
(`services/api/src/sync/apply.ts`). Rows 23 and 24's are on
`NoteSignoffCreate`'s `statementVersion` (`services/api/src/sync/entities/values.ts`) and on the
correction's rules (`note-correction.ts`).

Rows 27 to 29 came from unit L2's review, the coordinator's decisions on the handoff. Their
`PLAN-OPEN:` comments are in `services/api/src/encounters/handoff.ts`: row 27's at the head of
the file, row 28's above `zoned`, row 29's on `EMS_READER` and, for the phone's full-screen
summary, on `emsReader` (`apps/mobile/lib/features/encounters/handoff_screen.dart`). Rows 7, 12, 17 and 18, built with the
online routes, have theirs at the head of `assign.ts` and of `handoff.ts`, on `RECENT_VISITS`
(`timeline.ts`) and on `exportHandoff`.

Row 30 came from unit F7, Expand on the phone. Its `PLAN-OPEN:` comment is on `expand`
(`apps/mobile/lib/encounters/expand_quick.dart`).

Row 31 came from unit L6's review (finding PRD-1), narrowed by the coordinator's decision of Nov
20. Its `PLAN-OPEN:` comment is on `hidesFrom`
(`services/api/src/encounters/assign.ts`). Unit L6 also put row 5's comment on the portal's
`SIGN_ACTS` (`apps/portal/src/lib/sign.ts`), the sentences the visit page shows a co-signer and an
attester (9.11 as built), and added no other.

Row 32 came from unit L5's review (the coordinator's decision on finding SAX-8). Its `PLAN-OPEN:`
comments are beside the dependency in `apps/mobile/pubspec.yaml` and at the one call the app makes,
`getCurrentPosition` in `apps/mobile/lib/features/encounters/location_field.dart`; both name the
plan's section 6, where the row is. Unit L5 also put row 15's comment on `PhoneLocation` (that
file) and row 29's on `emsReader` (`handoff_screen.dart`, above), and noted beside forms 10.1 #51's
comment, in `apps/mobile/lib/features/forms/action_field.dart`, that Show handoff is that row's
exception (forms 10.1 #51 as built). Its other choices are the coordinator's decisions, recorded in
section 9's as-built paragraphs.

Rows 3, 4, 5, 9, 10, 11, 15, 16 and 30 were built with the phone's domain layer (units L4 and F7),
and each now has its row in the plan's section 6, as every built default does. Their `PLAN-OPEN:`
comments, in `apps/mobile/lib/encounters/`, are on `addNote` (row 3) and `startEncounter` (rows 11
and 15) in `encounter_repository.dart`, on `untouchedDraftLifetime` (row 4) in `close_sweep.dart`,
on the statement versions (row 5) in `complete.dart` and `encounter_api.dart`, and on `correct`
(rows 9 and 10) in `note_actions.dart`; row 16's is on `problemListStatus`
(`apps/mobile/lib/patients/problems.dart`). Besides row 30's, the domain layer added no
`PLAN-OPEN:` comment of a question this table lacks: its other choices are the coordinator's
decisions, recorded in the sections' as-built paragraphs.

Rows 33 to 37 came from the whole-phase review and its second pass, each the coordinator's decision
on the findings it names, and each has its row in the plan's section 6. Their `PLAN-OPEN:` comments
are on `_unreferencedProblem` (row 33, `apps/mobile/lib/sync/local_store.dart`),
`withoutRejectedSignoff` (row 34, `services/api/src/sync/records.ts`), `removeRefusedNote` (row 35,
`apps/mobile/lib/encounters/refusal_fixes.dart`), `decideQuarantine` (row 36,
`services/api/src/sync/review.ts`) and `privateMenuItems` (row 37,
`apps/mobile/lib/design/widgets/private_box.dart`). The review's one other row in the plan, who may
change a Program Admin's credential, has no default the code builds; it is 12.2 #6.

### 12.2 Questions that need a person and have no default

1. **Whether NP attestation is a payer rule or the partner's policy** (PRD main 216). The code
   reads one flag per credential (`billingNeedsAttestation`), so the answer is a data change.
2. **42 CFR Part 2** (PRD main 435). Until counsel answers, the three sensitive note types stay
   behind `patients.view_sensitive`.
3. **A registered nurse credential.** The PRD's table has none (PRD main 208-214) and the code
   has seven credentials (1.3). An RN today is `none`, and charts Non-Medical only.
4. **Retention of drafts that are never completed.** They stay drafts for ever, flagged as
   overdue. Whether an admin may close one unfinished is not decided.
5. **A visit charted on the wrong patient, found after a note is finished.** The app has no way
   to move it. Each answer can be corrected and an addendum can say what happened. Whether a
   Program Admin needs a way to void or move a visit is not decided.
6. **Who may change a Program Admin's credential after appointment** (raised with the project lead
   in the phase's review). No route is meant for it: the team's credential route takes a Program
   Admin's membership only from a platform owner who is an active member of the team with
   `team.manage_users`, and an owner outside the team must first appoint themselves the team's
   Program Admin in the owner console, which gives them the team's patient data, or remove the
   Program Admin and appoint them again under the credential they now hold. The project lead
   decides; recommended: an owner-console route to change it, with a recent sign-in, a reason and
   its audit event, and another Program Admin of the team may lower it but never raise it (plan
   section 6).

### 12.3 Where this design departs from the PRD, or reads it a particular way

1. **Save & Close keeps the draft on its author's phone.** PRD main 572 purges once a record is
   "signed or closed". This design reads "closed" as finished, not as Save & Close, so that
   "completes it later" works without a signal (3.2).
2. **`saved_unsigned` is an accepted change with a notice, not a rejection.** PRD main 558 lists
   it among rejections. The effect is the one the PRD describes (saved unsigned, routed to a
   co-signer); it is not left as an open rejection because the worker has nothing to fix, and an
   open rejection blocks their next route confirmation (PRD main 562) (3.4).
3. **Every finished note is locked, not only a signed one.** PRD main 452 says "a signed note is
   locked". A completed Non-Medical note has no signature, and would otherwise stay editable for
   ever (3.6).
4. **A change that arrives after a note is finished is kept in its history, not refused.**
   PRD main 583 says such changes "are addenda". The app does not turn a field edit into an
   addendum by itself: it keeps the value, tells the person, and they write the addendum (3.6).
5. **Co-signing and attesting need a connection.** PRD main 216 puts the attestation queue "on
   an attending's phone Home screen, or on desktop" and says nothing about offline (3.7).
6. **The route lead's part of the 24-hour alert waits for phase 7**, and push notifications for
   phase 6 (3.9).
7. **Medical is a property of the note, not only of the encounter.** PRD main 379 describes
   Medical and Non-Medical as kinds of encounter. One visit holds several care types (PRD main
   97), and a clinician and an outreach worker chart it together, so the gate, the signature and
   the attestation follow each note's type. The encounter's kind decides what is offered (3.1).
8. **The kind never goes back to Non-Medical.** The PRD describes only the switch to Medical
   (PRD main 379). A Medical encounter with only Non-Medical notes needs no switch (3.10).
9. **Recent notes offline are the last three visits of a chart the phone holds**, carried with
   the chart for 24 hours (5.2). The PRD's route cache (PRD main 533) arrives with routes, in
   phase 7.
10. **Follow-up tasks and Home's counts wait for phase 7.** "Follow-up tasks created in one tap"
    (PRD main 384, 433), today's encounter count and recent patient activity (PRD main 744) need
    tasks and routes. The follow-up answers are stored now.
11. **After the first finished note, an assessment is added, not edited.** A later author's
    assessment is an addendum to the visit (3.1, 9.6).

### 12.4 Risks

1. **Signing offline is the riskiest rule in the product.** A signature must cover what was
   read. The content hash is the whole defence, so its two implementations are pinned by one
   vector file, the fake uses the same file, and the live job signs against the real API.
2. **The fake server grows by about a third.** Seventeen rules are mirrored by hand (4.9). Each
   has a parity case; a rule added later without one is plan risk 7 again.
3. **The status trigger and the finished-note guard put rules in the database.** They are the
   second line, as row-level security is. The first line is still the API, and the guard's error
   class is chosen so that a bug in it becomes a stored rejection, never a stuck queue (2.2).
4. **Attestation can stall on a sensitive exam.** Only a holder of
   `patients.view_sensitive_exams` can co-sign or attest a note with a GU, breast or rectal exam,
   and of the standard roles that is Program Admin alone (6.4, rule 4). The queue says why a note
   waits; the team has to make the role.
5. **The membership history decides credentials.** `signedUnder` trusts
   `membership_changes`. If a credential is changed by hand in the database, signatures made
   offline before the change are recorded under the wrong one.
6. **Card count.** See 13: about a third of this part's cards are level X. As planned, a small
   model couldn't shorten that third; since Nov 16 no card of this phase is run on one
   (`docs/design/phase-4-encounters.md`, "How this phase is built").
7. **A keyboard's own Copy skips the private copy** (as built, since the phase's review). A private
   box's menu and a hardware keyboard's shortcuts copy through `secureCopy`, but an Android soft
   keyboard's own Copy or Cut writes a plain clip, and an iOS edit action from outside Flutter may
   too (10.2). Until a hook into the embedding exists, the mitigation is team phones under device
   management, with a managed keyboard whose clipboard history is off, or a work profile, which
   keeps the clipboard from personal apps (plan risk 10).

## 13. Units

The cards are in one index for the whole phase, `docs/plan/phase-4-encounters/README.md`, with
their levels, files and order. This part's units, and what each owns:

| Unit | Owns | Depends on |
|---|---|---|
| **L0** Schema and core rules | `db/migrations/0018` to `0021`, their `db/test` files, the three vector files of 3.12 and their readers, `services/api/src/encounters/{rules,content-hash,signed-under}.ts`, `apps/mobile/lib/encounters/{rules,content_hash}.dart` | forms F1 and F2 for `effectiveAnswers` (the content hash) |
| **L1** Server sync | `services/api/src/sync/**` (changes), `services/api/src/sync/entities/{note-signoff,note-addendum,note-correction,referral}.ts`, `services/api/src/encounters/signer.ts`, `services/api/test/sync-{encounters,signoffs,corrections,referrals}.test.ts`, and phase 2's sync tests, which move to a test-only note type (4.4) | L0; forms F1 (`checkAnswer`, `finishCheck`, `effectiveAnswers`, `visibleAnswers`) and F3 (stored definitions) |
| **L2** Server routes | `services/api/src/routes/encounters.ts`, `services/api/src/encounters/{read,timeline,queues,cosign,attest,assign,incomplete,counts,handoff}.ts`, the timeline and recent visits in `services/api/src/patients/{charts,schemas}.ts`, `services/api/test/encounters-*.test.ts` | L1; forms F1 (`readModel`, `handoffLines`) |
| **L3** The phone's sync layer | `apps/mobile/lib/sync/{entities,local_store}.dart`, `apps/mobile/test/sync/{fake_server,fake_parity_test,fake_reads_test,store_encounters_test}.dart` | L0, L1 (the fake mirrors it); forms F2 and F4 (the fake reads definitions from the conformance file and the bundled presets) |
| **L4** The phone's domain layer | `apps/mobile/lib/encounters/` (all but the two core files of L0 and the two of forms F7), `apps/mobile/test/encounters/`, and named edits to `apps/mobile/lib/patients/{chart_cache,problems}.dart` | L3, the generated client from L2 |
| **L5** The phone's screens | `apps/mobile/lib/features/encounters/`, its tests, and named edits to `patient_screen.dart`, `home_screen.dart`, `app.dart`, `sync_labels.dart`, `needs_attention_screen.dart` | L4; forms F5 (the renderer and the read view, which F5 owns) |
| **L6** The portal | `apps/portal/src/app/(app)/encounters/`, `team/{cosign,attestation,incomplete-notes}/`, `apps/portal/src/app/actions/encounters.ts`, `apps/portal/e2e/{encounters,attestation}.spec.ts`, the Timeline on the patient page, the navigation links in `layout.tsx` | L2 |
| **L7** The Done when | `packages/contract/test-vectors/encounters-done-when.json`, `apps/mobile/test/encounters/{done_when_test,live_encounters_test}.dart`, `services/api/test/encounters-done-when.test.ts`, the line in `tools/live-sync.sh` | all |

As built, L6 has no `apps/portal/src/app/actions/encounters.ts`: the visit page's reads and acts
go through route handlers under `apps/portal/src/app/(app)/encounters/` (9.11 as built). It began
with an API job in L2's and L1's files, and L3's test server, so that no page holds a rule of its
own (5 as built; the card index's L6 section names the files).

**Not built in this phase** (the coordinator's list of Nov 20, from unit L5's review), each recorded
where it would go:

- The summary's line for each answer someone else changed, "{name} changed {label}." (9.6 item 1),
  and who wrote a locked assessment (item 2): both need the domain layer to record more, which
  answers the person last saw and the summary's author in the read model. The summary says only
  "This note changed. Read it again." above a recap a sync redrew (9.6 as built).
- A definition marker for follow-up fields: the summary reads a section or a field by its ID,
  `follow_up` (9.6 as built), and a released note type version never changes, so a marker waits for
  new versions.
- The phone's test server answering the online lists (Home's counts, Notes to finish, the queues,
  earlier visits, the visit read): the screen tests script them in front of it (11.2).
- Reopening a note the phone does not hold: Reopen is offered only on a note the phone holds (9.7 as
  built), where an addendum and a correction bring their note onto it first.
- The recap's "label?:": a field whose label ends in a question mark reads "{label}?: {value}" in
  every recap (an "evaluation?: NO" line); with the recap's wording, a question for the clinical team
  (forms 7.1, `recapLines`).
- `geolocator`'s 'always' permission code on iOS: Apple may warn of a binary that names a location
  API without that purpose string, and the iOS build can strip it (the plugin's
  `BYPASS_PERMISSION_LOCATION_ALWAYS`) or add the string; nothing in the repository builds iOS yet
  (plan risk 5).

Also not built as this part stands, each an open question for the coordinator from the review's
fixes:

- Who on New encounter reusing phase 3's `pickPatient` (decided work): the picker has no Show more
  and no count of the phone's run, so `PatientFinder` stays (9.2 as built) until the picker gains
  them. (A freeze takes what it found off the sheet since `d713056`, as on Who.)
- Show handoff for a visit the phone does not hold: the server's read can say it has one
  (`hasHandoff`), but the page reads the phone's copy only (9.8 as built).
- A refused note create whose type the team lists at no other version, or at none that takes
  every answer it holds (since the phase's review, finding VS-3), or that was refused on the very
  version listed: Remove this note can't settle it, so it stays in Needs attention, and hard stop
  2 holds its visit's Complete, until the store can withdraw a create the server never took (9.13 as
  built). And whether the fix of such a create should keep the person's answers on the listed
  version, rather than clear them, as the design table's "Choose the note type again" would. (Since
  the phase's review the fix sends them, so they reach the server's history, and then clears them,
  on a listed version that takes every one; findings PS-4 and VS-3, 9.13 as built.)
- The merged Android manifest without the plugin's location service, and one Use my location fix on
  a device: they wait for CI's Android build, which this machine cannot run, and a phone; that build
  also lists the Play services artifacts that `pubspec.lock`'s osv scan does not see (9.2; plan risk
  9).
- A soft keyboard's own Copy or Cut in a private box (since the phase's review, the coordinator's
  decision on the open question of finding C-4): on Android it writes a plain clip from inside
  Flutter's embedding, and on iOS an edit action from outside Flutter may too. Closing it needs a
  hook that wraps the embedding's text input connection (10.2; plan risk 10).

This part is 94 of the phase's 218 cards: 4 at level S, 24 at T, 34 at R and 32 at X. The sync
core, the phone's store and the phone's test server are where the X cards are, and a small model
could not have shortened that third; since Nov 16 the frontier model builds every card of the
phase.

## What this part needs from the forms part

The lifecycle treats a note's answers as data it does not understand. It needs these from
`packages/forms` (TypeScript) and its hand-written Dart twin in `apps/mobile/lib/forms/`, each a
pure function with no database or network in it (forms 7.1 has the signatures):

| Needed | Used by |
|---|---|
| For each note type and version: the kinds it is offered for (so whether it is a Medical note), its `sensitivity`, its timeline `group`, and its sections with `sensitiveExam`, `treatmentRecord` and `needs` | 3.1, 4.2, 4.4, 5.2, 6.4, 9.1, 9.4 |
| `checkAnswer(definition, path, value)`: null, or the problem with an answer (an unknown path, a wrong type, an unknown option, out of range, a blocked pair) | 4.4, 4.7 |
| `effectiveAnswers(definition, answers)`: the answers that count | 4.5, 4.6 |
| `finishCheck(definition, answers)`: what stops Complete (a required answer that is visible and empty, which covers consent for a sensitive exam), each with the section it is in | 3.3, 3.4, 4.6, 4.7, 9.6 |
| `visibleAnswers(definition, answers, reader)`: the answers a reader may see, or null for a note they may not see | 5.1, 6.4 |
| `recapLines(definition, answers)`: one line per section, nothing from a sensitive exam | 8.1 |
| `readModel(definition, answers, corrections)`: a note laid out for reading | 5.1, 5.2, 9.7 |
| `handoffLines(definitions, answersByNote, sensitiveCodes)`: the EMS handoff summary | 5.7, 9.8 |
| `suggestions(definition, answers)`: note types suggested by the options picked | 9.6 |
| A problem field that stores a code and a label, with the status tapped as an ordinary field beside it | 8.3 |
| The form widget for a draft note, and the read widget that draws a read model with corrected answers struck through | 9.5, 9.7 |
| Stable answer paths: a path means the same field in every version of a note type, and a note keeps the version it was written on | 2.6, 4.5, 8.1 |

Every function that runs on both sides is pinned by the forms part's conformance vectors
(forms 7.2).
