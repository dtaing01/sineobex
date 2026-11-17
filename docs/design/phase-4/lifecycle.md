> **Reviewed (Nov 14).** Four reviewers checked this design and the forms part against the PRD, the code, the rules that never bend and the task-card rules; their 95 findings are applied. Section 12 lists what a person still has to decide. In build since Nov 16: which units are on the branch is in the Status table of `docs/design/phase-4-encounters.md`.

# Phase 4 design, part 2: the encounter lifecycle, sync and screens

Status: in build. The schema and core rules (unit L0) are on the branch; section 1 still describes the code before this phase. The work-list is `docs/plan/phase-4-encounters/README.md`.

This part covers how an encounter is stored, saved, completed, signed, attested, corrected and
synced, and the screens around it. The other part (`docs/design/phase-4/forms.md`) covers the form
definitions, their generation from the field specification, the renderer and field validation.

Who builds from this: a small local model, one task card at a time (`docs/plan/README.md`), with a
frontier model or a person writing the tests for the safety-critical cards first. So the judgment
sits in a few places the small model does not write: the migrations, the sync core, the phone
store and the fake server (all level X), and a few small pure functions that are written twice
(TypeScript and Dart) and pinned by shared test vectors. Everything else follows a pattern.

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
| `changes` | `jsonb not null`, an array of 1 to 10 | Each `{ field, oldValue, newValue, historyId }`. `field` starts with `data.`. `historyId` is the `corrected` row in `field_history`, or null when nothing was written. |
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

**An empty draft does not count.** A draft note whose answers are all blank (4.5) is treated as
if it were not there: by the encounter's status, by Complete, by the lists of notes to finish and
by the timeline. A note type picked by mistake is undone by **Remove this note**, which blanks
its answers (9.4). The Red flags note that the app adds by itself (forms 6.2) stays out of the
way until someone answers it. One function, `noteIsEmpty`, says so on both sides (3.12), and the
database has the same rule (2.2).

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
   note being completed now does not count: completing again is its fix (3.4).
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
| draft, Non-Medical note | `sign` | treated as `complete` | `completed` | Complete |
| already finished | any | none | `none` | Unchanged |
| completed, Medical note | `cosign` (online, 5.3) | hash matches; a second person; can sign; can see every answer that counts | `signed` | Signed; attestation by the co-signer's credential |

Four of these need a word.

- **`saved_unsigned`** is the PRD's signing rule: "The author's credential can't sign this note
  type: saved as unsigned and routed to a co-signer instead" (PRD main 558). The phone only sends
  `sign` when its saved profile says the person can sign, so this happens when a credential was
  lowered while the phone was offline. The receipt is **accepted** and says what was done, and the
  person gets a notice with the existing sentence (`services/api/src/sync/apply.ts:34`). It is not
  a rejection, because the worker has nothing to fix, and an open rejection is a hard stop on
  their next route confirmation (PRD main 562). See 12.3 #2.
- **`none`** covers the same person completing a note from two phones. The second sign-off is
  stored and changes nothing. If its hash differs from the one that finished the note, the
  receipt says so and the person is told to open the note and read what was signed.
- **A sign-off from someone who does not act as the author** is stored with effect `none`. The
  screens never send one, and the worker could not fix a refusal (4.1).
- **A refusal** (`content_changed`, `incomplete`, `red_flags_first`) leaves the note a draft on the server and puts
  the sign-off in Needs attention. The fix is the same act again: open the note, look, Complete.
  The phone then sends the same sign-off record again with the new hash, through the store's fix
  path (`apps/mobile/lib/sync/local_store.dart:1328-1345`), so the refused one is settled and
  nothing that waited behind it is left waiting.

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
- If every answer already holds its new value, the correction is stored as `no_change`.
- If an answer changed since the person looked (another correction got there first), it is
  refused with `field_changed`. The fix is to look again and correct again, or leave it (4.1).
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

**A patient's request to amend** "uses the same correction path, with the request and the
decision logged" (PRD main 463). The correction carries `requestedByPatient`. Accepting the
request is a correction. Refusing it is a correction with `outcome: 'declined'`: the value asked
for and the reason are stored and the note is unchanged. Phase 3 does the same for legal name and
birth date (`services/api/src/patients/corrections.ts:23-27`). What HIPAA §164.526 asks beyond the
log (a written answer within 60 days, the patient's statement of disagreement) is for counsel
(PLAN-OPEN 12.1 #10).

**A note already in a billing export**: "the correction flags it for Billing/Data to review"
(PRD main 462). Phase 10 builds the flag from the correction's time (2.6).

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
- Nobody co-signs or attests a note they act as the author of. Nobody attests a note whose
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

### 3.11 The clock pause

Encounters and notes already stop while the clock check fails (D35,
`apps/mobile/lib/sync/local_store.dart:414-422`). Sign-offs, addenda and corrections stop too:
their device time is what the record shows. A referral does not stop: its date is typed by the
person, and it registers something said in the street, like an alias or an allergy (D35).

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
  hashMatches: boolean; finishOk: boolean; redFlagsDone: boolean;
}): { refuse: 'content_changed' | 'incomplete' | 'red_flags_first' }
  | { effect: 'none'; reason: 'already_finished' | 'not_author' }
  | { effect: 'completed' | 'signed' | 'saved_unsigned'; statusAfter: NoteStatus; attestationAfter: Attestation }
```

The checks run in this order, and the first that applies decides:

1. `noteStatus` is not `draft`: effect `none`, reason `already_finished`.
2. `actsAsAuthor` is false: effect `none`, reason `not_author`.
3. `hashMatches` is false: refuse `content_changed`.
4. `finishOk` is false: refuse `incomplete`.
5. `medicalNote` and not `redFlagsDone`: refuse `red_flags_first`. `redFlagsDone` is true when
   the visit has a finished Red flags note, or this note is one.
6. `medicalNote` is false, or `act` is `complete`: `completed`, status `completed`,
   `not_needed`. So `sign` on a Non-Medical note is treated as `complete`.
7. `canSign` is true: `signed`, status `signed`, `waiting` if `needsAttestation`, else
   `not_needed`.
8. Otherwise: `saved_unsigned`, status `completed`, `not_needed`.

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

`noteHasHiddenSection` is true when the note holds an answer that counts in a section the
assignee could not see without being its author. Whoever acts as a note's author sees all of it (6.4), so the check is about
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
| `encounter` | `summary` and `locationText` become settable. `kind` can be set to `medical`. `status` stops being settable. A change that arrives after the first finished note is kept in history. | draft rule while the envelope is open (4.3) | `encounters.chart` | every change |
| `encounter_note` | The note type and version must exist. Answers are checked against the note type. `status` takes one value from a phone: `draft` (reopen). A change to a finished note is kept in history. | draft rule while a draft (4.4) | `encounters.chart` | every change |
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
| `content_changed` | a sign-off whose hash differs from the note the server holds | Open the note, read it, Complete again. `finishNotes` sends the same sign-off record again (4.8). |
| `incomplete` | a sign-off on a note that fails the finish check; a correction that would leave the note failing it | Fill in what is missing and complete, or correct, again. The same record is sent again. |
| `red_flags_first` | a sign-off of a Medical note on a visit with no finished Red flags note | Complete again: the Red flags note goes first (4.6). |
| `field_changed` | a correction whose answer changed since the person looked | Look again. **Correct again** sends the same correction record with the value and version now seen; **Leave it** sends it with the answer's current value, which the server stores as no change. |
| `medical_note_needs_patient` | a Medical note on a visit with no patient | Name the patient (always possible, 3.1). The store then sends the note's create again, and what waited behind it (D49). |
| `unknown_note_type` | a note on a key or version the team does not have | Choose the note type again. The phone only offers listed versions (forms 3.4), so this is a build fault. |
| a problem of `checkAnswer` (`wrong_type`, `unknown_option`, `out_of_range`, and the rest, forms 7.1) | an answer that breaks its definition | Correct the value: phase 2's fix for a refused set. |

What is accepted with no effect, in place of a refusal:

| Change | Answer |
|---|---|
| A `set` of a note's `status` to `completed` (an old build) | Kept in history, problem `use_signoff` |
| A `set` of `kind` to `non_medical` on a Medical visit; a `set` of `patientId` to nothing | Kept in history, problems `kind_cannot_go_back`, `patient_cannot_be_removed` |
| A sign-off, a reopen or a correction from someone who does not act as the note's author | Stored with no effect, problem `not_author`; the sender gets a notice |
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
  | a reopen from someone who does not act as the author | kept, `not_author`, when the acting author's own reopen would have applied; otherwise a late change, `note_finished` | the sender alone, `change_not_applied` |
  | a sign-off from someone who does not act as the author | effect `none`, reason `not_author` | the sender alone, `change_not_applied` |
  | a correction from someone who does not act as the author | outcome `not_author` | the sender alone, `change_not_applied` |

  `not_author` answers before the Medical gate for all three (review finding RD-8): a non-author
  whose credential was lowered is stored with no effect, and nothing waits for an admin who could
  only make it no effect. A note the sender may not read at all is held before either (6.4).
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
  is applied, the server moves that patient's `last_seen_at` to the encounter's `started_at` if
  that is later than the value held and not later than the server's clock. It never moves
  backwards.

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
- **Last seen** moves on an accepted create that names a patient (after its insert) and on an
  applied `patientId` set, on the patient row the visit names, merged or not: reads take the
  group's latest (D27), and the team index's version moves with it. A visit whose start is after
  the server's clock moves nothing, as the text says. Open (review finding REC-4): move it to the
  server's time instead, which would change the test that pins the skip.
- **Open** (review finding REC-6): moving a visit to another patient leaves the referrals,
  problems and allergies made at it naming the first. Either such a move is kept in history when
  records made at the visit name another group, or the drift is accepted and written here and in
  8.4.

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
  a repeating section of diagnoses), `test_sensitive` (`sensitivity: 'sensitive'`) and
  `test_assess` (answers that do not count, beside a sensitive diagnosis). The API's fixtures
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
- **A sensitive section, as built** (`hiddenFromSender`): a set is held when the value the field
  holds, or the value sent, is hidden from the sender (`answerHidden`,
  `services/api/src/sync/records.ts`): in a note type or a section they may not read, a sensitive
  exam's option, or what visibleAnswers would cut away with a sensitive diagnosis's entry or
  section. The reader is the sender's role and their credential now (`none` without a
  membership), never as the author. Whoever acts as the author, an admin's accept and a phase 2
  note pass. It answers before anything that would send the field back, a conflict or a late
  change. An answer that does not count is hidden by where it is: when any answer of its entry, or
  outside a repeating section of its section, is a sensitive diagnosis, counting or not, or when it
  is itself a pick of a sensitive exam's option. So a removal of an entry that holds a sensitive
  code, and a write into one, are held too (review findings RD-5, NOT-9). Not covered yet: an
  answer that does not count in a sensitive exam's grid row, region or Other text, and an entry
  hidden only by what an exam holds. "The acting author may always set their own note's answers"
  stands for seeing (6.4 rule 1); a `needs` section still asks for the credential (4.2).
- **Open** (review finding RD-10): whether a set is held or applied depends on hidden codes in the
  value the field holds, so the outcome tells the sender something hidden is there. Two ways out:
  hold every set from someone who does not act as the author of a field that can hold such codes,
  or merge the set with the codes they never saw. **Open** (RD-5): a reader who may see the
  section still meets the draft rule's conflict, which can send back an answer that does not
  count; the existing tests pin that conflict.
- **A retry** is answered from its stored receipt with the field as its sender may see it now
  (`fieldForSender`, called from `apply.ts` `resultFromReceipt`; review findings NOT-4, RD-4). A
  conflict or a value kept in history whose answer is hidden from them since keeps its status and
  carries a field that holds nothing, `{ value: null, version: 0, changedBy: null,
  changedAt: null }`: nothing was held, so it is not answered `permission`. Whoever acts as the
  author, and a phase 2 note, are answered as before; a definition that cannot be read hides the
  field.
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
  `signoffId`; the contract still describes a snapshot's attributes as set at creation (`schemas.ts`
  `RecordSnapshot`), which these are not. What a reader is sent of a note is 6.4's.

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
  through a real sign-off. `finishNotes` (4.8) will call it on the phone, in L3's store cards.

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
5. **Effect `none`** (the note is already finished, or the sender does not act as its author):
   insert the `note_signoffs` row with `effect: 'none'`. The receipt's details carry the reason
   and `hashMatches`.
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
that supersedes the refused one, `apps/mobile/lib/sync/local_store.dart:1328-1345`). The server
applies it as a fresh sign-off.

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
  Effect `none`: `details: { effect: 'none', reason, status, attestation }`, the note's state now,
  so the phone settles every receipt the same way, and `hashMatches` **only to whoever acts as the
  author** (review findings RD-2, NOT-6): sent to anyone else it would check any guess of what the
  note holds, a hidden answer included. For `already_finished` it compares with the hash of the
  sign-off that finished the note, not with the note as it is now (NOT-7): the row by
  `completed_by` at `completed_at` with an effect other than `none`, the latest received on a tie,
  else the note's own hash. A co-signature (L2) must leave `completed_at` and `completed_by` as
  they are for this to keep naming the signature that finished it.
- **Notices and the audit event**: `note_saved_unsigned` to the signer, `change_not_applied` to a
  sender who does not act as the author, both on entity `encounter_note` and the note; one event
  on the note, with `signoffId` in its details (10.1).
- **Open** (review finding NOT-12): a held sign-off that the note no longer matches cannot be
  accepted, and its phone was told to let go of it. Either a refusal at accept time becomes a
  stored rejection the worker sees, as a push's would be, or rejecting such an item sends the
  worker a notice that the note needs completing.

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
  6. Each answer's version equals its `baseVersion`, else `field_changed`.
  7. Every answer already holds its `newValue`: stored with `outcome: 'no_change'`.
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
  they signed.
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
- **A correction, in the order built.** The design's step numbers are kept, and the tests are
  named by them. Before step 1: a record ID already stored is `record_exists`, asked before
  anything is read; a `signoffId` of another note is `note_signoff_missing`; a note the sender may
  not read at all is held. Then step 1 (`not_author`, with `change_not_applied` to the sender,
  ahead of the gate); step 3 (the Medical gate); the note's definition, where a version the team
  does not hold is `definition_error`; the `needs` gate for each answer, the author's included
  (review finding NOT-1); step 4 (a declined request is stored, the note unchanged, in any state);
  a finished note with no version is `definition_error`; step 5 (`checkAnswer`,
  `{ problem, field }`); the 1,000-answer bound (`too_many_fields`); step 2 (the draft edit);
  step 6 (`field_changed` `{ field }`); step 7 (`no_change`); step 8 (`incomplete`); step 9. The
  gates and a declined request come before the draft edit, unlike the order written above: a
  draft edit changes a Medical note as any set of it does, and a declined request must never
  edit a reopened note.
- **The draft edit** cannot answer a conflict, being part of a create. Each answer the person saw
  is written as `set`, a blank as `filled_blank`, the same value not at all; one they did not see
  refuses the whole correction with `field_changed`, and nothing is written. It is stored
  `draft_edit` even when nothing changed. A phase 2 draft is edited under its open path rule.
- **Step 9 as built**: the answers are written in one update, `app.note_correction` set to the
  loaded row's ID for that statement and reset to `''` after it; `correctionEffect` sets
  `status`, `attestation` and `signoff_id` in the same statement; a status that moves takes its
  next version and a `set` history row, the answers `corrected` ones. Then the row, naming each
  history row. Every correction's receipt is `accepted`, `serverVersion` 1,
  `details: { outcome, status, attestation }`.
- **The corrector's credential** is `signedUnder`'s, with the claim, at the correction's time,
  `notBefore` from the note's create as for a sign-off. A correction carries no statement version
  (12.1 #24).
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

As built (unit L3, card L3-registry, `apps/mobile/lib/sync/entities.dart`; the store cards come
next):

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
  referral names its own (`patientOfCreate`). The store does not read it yet, so until L3's store
  cards a sign-off, an addendum or a correction is kept with no patient on the phone.
- **Values**: `referral_in_future` joins `valueProblem`; a date in a year below 100 is refused, as
  the API refuses it (review finding FAK-2); a correction's missing `newValue` is a problem of its
  own kind (`_present`), since the API's schema still runs its refinements then; the two audit
  actions join `auditActions`. `packages/contract/test-vectors/sync-values.json` binds the new
  values on both sides, a visit's summary and place and an empty correction among them:
  `entities_test.dart` reads it through the registry and `patient_rules_test.dart` through the
  fake. Still owed: the registry's bound on `noteTypeVersion`, the API's `MAX_VERSION` (review
  finding FAK-1), and its vector; the fake checks the bound itself until then.
- **What the store still does as phase 2 left it**, for L3's store cards: `createEncounter`
  writes `kind` as an attribute and `status` as a field, and takes no `locationText`;
  `importServerRecord` takes an encounter's status from a `status` field the snapshot no longer
  has, where it should read the record's status; `_fixRejected` does not carry `locationText`; and
  `finishNotes`, the lock by effect and the receipts' settling are not built.

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
| 7 | `_signoff`, `_finishedRedFlags`, `_isRedFlags`, `_finishingHash` | Every `signoffEffect` case of `note-lifecycle.json` goes through a real sign-off, its note type, credential, Red flags note and hash built from the case |
| 8 | `_contentHash`, `_finishNote` | Every case of `note-content-hash.json`: the wrong hash is refused, the vector's is taken, and the note keeps exactly `effective` |
| 9 | `_create`'s addendum case, `_signoffOfOther` | |
| 10 | `_correction`, `_writeAnswers`, `_reviewersUndone` | Each step in the order of 4.7 as built |
| 11 | `_create`'s referral, problem, allergy and problem note cases, through `_visitOfOtherPatient`; `_set`'s `mayChange` | |
| 12 | `_medicalGate`, from the note create, `_noteSet`, `_signoff` and `_correction`; `_needsGate`, from all but `_signoff` | |
| 13 | `_refreshVisit` | Its case is named after the db test `db/test/encounter-lifecycle.test.ts`, "the encounter's status follows its notes", and reads `note-lifecycle.json`'s `encounterStatus` cases through the fake's sync read; no API test has that name |
| 14 | `checkAnswer` in the note create and `_noteSet`, `notCounted`, `_byDefinition` and the `forged` rows, stored as `definition_error` by `_decide` | |
| 15 | the registry's `auditIssues`, in `_decide` | |
| 16 | `_fetch`, `_asRead`, `_noteAsRead`, `_noteSnapshot`, `_readSnapshot`, `_medicalHidden`; `_hiddenFromSender`, `_unreadableBySender`, `noteReader`, `answerHidden` | With the read rules of 6.4 as built, and a retry answered from `_Receipt.result` as its sender may see the field (4.4) |
| 17 | `_noteStatusSet`, `_kindSet`, `_envelopeKept`, effect `none`, `_correction`'s `not_author` and `draft_edit` | One case walks the second table of 4.1 row by row; `sync-corrections.test.ts` has the API test of its name (FAK-7) |

What else the fake does, as the API does: `signedUnder` is a copy of `signed-under.ts`
(`FakeSyncServer.signedUnder`), and every case of `signed-under.json` runs through it;
`_signedUnderFor` reads `credentialChanges` and `heldAt`, and a note's `storedAt` (when it was
held, else when it was made) is `notBefore`. A visit moves its patient's last seen, later only and
never past the server's clock (review finding FAK-5), so the team index's version moves too.

**The fake's defaults:**

- **Anyone the fake does not list** has the role Healthcare Staff and the credential `attending`
  (`FakeSyncServer.defaultCredential`). The API's membership default is `none`, so a phone test
  that never sets a credential passes the Medical gate on the fake and would be held by the API.
  Open: default to `none`, as the API does, with each test that charts a Medical note setting one.
- **The CHW preset** holds `referrals.create` and `routes.view`, as `permissions.ts` does.
- **People and credentials**: `credentials`, `changeCredential` (which records the credential
  replaced) and `removedUsers`; the credential's capabilities are a copy of `CAPABILITIES`.
- **Note types**: `noteTypes`, by key and version, starts as the test-only types of
  `test_note_types.dart`; the Red flags and restricted types come from `sync-note-types.json`
  (`testRedFlags`, `testRestricted`, `testSensitive`, `testAssess`); `forged` names rows whose hash
  fails (D79).
- **Test hooks** stand in for what the fake has no route for: `finishNote` sets a note's state
  directly; `cosign()` and `attest()` stand in for L2's online routes, as the API tests' inserts
  do; `acceptHeld` is an admin's accept.

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
  `change_not_applied`, `note_corrected` (to a co-signer or attester whose note was corrected).
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
| `note_saved_unsigned` | the signer | a sign-off saved unsigned (4.6) |
| `note_corrected` | the co-signer whose co-signature a correction clears; every attester of the current signature when an attested note is no longer attested; never the corrector | a correction applied (4.7) |
| `conflict_resolved` (phase 2) | the note's author, when the value kept was someone else's | an answer of `keep_server` that saw the current value, a finished note's included (4.3) |

`note_cosigned`, `note_attested` and `note_assigned` come with the online routes (L2). A change
kept with `use_signoff`, `kind_cannot_go_back` or `patient_cannot_be_removed` sends none: the
receipt's `details.problem` tells the phone. An addendum tells nobody.

The record refresh reads the note's new attributes (4.4). In every copy but the acting author's
copy of a draft, a note's `version` and `updatedAt` are those of the latest field it shows, so
they do not move when only a hidden answer changes (6.4); the phone reads only the fields'
versions.

## 5. API routes that only work online

All are `@hono/zod-openapi` routes in a new file, `services/api/src/routes/encounters.ts`, with
their logic in `services/api/src/encounters/`. Each checks its permission first, runs in one
transaction and writes its audit event in that transaction. A refused request is logged too
(`services/api/test/permissions.test.ts` gets a row for each route).

**Every route that writes** (5.3, the attest of 5.4, 5.5) calls `lockTeamWrites` as its first
statement, as every online writer does today (`services/api/src/sync/locks.ts:13-15`;
`services/api/src/patients/corrections.ts:37`), and then loads each note it will change for
update. A push takes the team lock first and a note's row second; a route that did it the other
way round could deadlock with one, or check a hash and then sign a note that a correction had
just changed.

| # | Route | Key | Credential |
|---|---|---|---|
| 5.1 | `GET /v1/encounters/{encounterId}` | `patients.view` | none |
| 5.2 | `GET /v1/patients/{patientId}` (existing) gains `timeline` and `recentVisits`; `GET /v1/patients/{patientId}/timeline` | `patients.view` | none |
| 5.3 | `POST /v1/encounters/{encounterId}/cosign` | `encounters.chart` | `sign` |
| 5.4 | `GET /v1/team/cosign-queue`, `GET /v1/team/attestation-queue`, `POST /v1/encounters/{encounterId}/attest` | `encounters.chart` | `sign` for the first; `attest` for the other two |
| 5.5 | `POST /v1/notes/{noteId}/assign` | `team.manage_users`, and a recent sign-in | none |
| 5.6 | `GET /v1/me/notes-to-finish`, `GET /v1/team/incomplete-notes`, `GET /v1/me/counts` | `encounters.chart`; `team.manage_users`; any member | none |
| 5.7 | `GET /v1/encounters/{encounterId}/ems-handoff` | `patients.view`, and a recent sign-in | none |

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
this route (unit L2, not built yet) is to match:

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
  bullet above: a Program Admin without a clinical credential gets no hash. Open: whether this
  route's `contentHash` follows it; co-sign and attest (5.3, 5.4) need the hash.
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

### 5.5 Assign a note

Body: `{ toUserId, reason }` (3 to 500 characters). Like every `team.manage_users` route it
needs a recent sign-in (`services/api/src/routes/members.ts:157`). Checked by `mayAssign` (3.12): the note's
acting author is not an active member, else `409 author_active`; the assignee is an active
member with `encounters.chart`; the assignee's credential rank is at least the rank the note was
signed under, or for an unsigned note the author's last credential, else `422
credential_too_low`; the note holds no answer that counts in a section the assignee could not
see (6.4), else `422 cannot_see_all`. Then a `note_assignments` row and `assigned_user_id`.
Audit: `note.assigned`. Notice to the assignee: `note_assigned`.

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
  referral is read whole. Each record returned is logged: `encounter.viewed` for a visit,
  `note.viewed` for a note and for a sign-off, an addendum or a correction, `patient.viewed` for a
  referral (10.1).
- **Rule 2 in the sync read** is 5.1's note: a note the reader may not read, or whose definition
  cannot be read, is missing; a hidden answer leaves no value, version or mark; a note's version
  and time follow what it shows.
- **Rule 2 for a retry**: a change answered again from its receipt sends the field as the sender
  may see it now (4.4).
- **Rule 2 in the review queue.** A held change's value goes only to a reviewer who may read it,
  by the sync read's rules (`shownChange`, `review.ts`; review finding RD-3, as the coordinator
  decided): a visit's records need `encounters.chart`; a note's change, a note the reviewer may
  read, and every answer it sends or would replace one they may see; a held note create, a type
  they may read with none of its answers hidden; a held sign-off goes without its hash to a
  reviewer who does not see every answer of any note; a problem and its notes need the problem
  list's keys, and a sensitive one, or one whose create is still held, `patients.view_sensitive`;
  everything else `patients.view`. An item the reviewer may not read is listed with `field` and
  `value` null and `hidden: true` (`QuarantineItem` in the contract), and opening the queue still
  logs it with its patient. Open: a reviewer who cannot read a held value can still accept it, as
  before; the portal's queue page does not yet show such an item as held with nothing of it; and
  a held addendum that names no note is shown to any reviewer with `encounters.chart`, though the
  sync read keeps a Medical visit's from a reader without what reads its notes (5.1).
- **Rule 4** is the sign-off hash rule of 5.1.
- **Rule 5 as built.** Held for a Program Admin, with no `server` value: a set whose stored or sent
  value is hidden from the sender, an answer that does not count by where it is (4.4); any change
  of a note the sender may not read at all, a set, a sign-off, a correction or an addendum, so
  that no answer tells its state, who finished it, or whether a guess of it matches (review
  finding RD-11); an answer of a `needs` section from a credential that does not order
  medications, whoever acts as the author (4.2). The reader for each is the sender's role and
  their credential now.

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
  hash-confirmed receipt: nothing here touches the purge.
- **A draft nobody has touched for 7 days** is closed the same way, if nothing of it waits in
  the outbox (3.2). It stays on the server and opens again online.
- **Reading a visit that has left the phone.** The last three visits of a chart the phone holds
  are read offline, from the chart's `recentVisits` (5.2). An older visit is asked from the
  server (5.1) and shown from memory; offline it says "This visit isn't on this phone. Connect
  to open it." Adding an addendum or a correction to a visit that is not on the phone needs a
  connection first: the phone fetches the notes it will change through the sync read.

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

## 9. Screens

Every screen here follows the rules of `CLAUDE.md` and the phase 3 screens
(`docs/plan/patterns/phone-screen.md`, `portal-page.md`): Day, Night run and High contrast; text
at 200% with no overflow; a 320 px wide phone; 48 px targets; every control labelled, with a tap
action; live regions that speak once; text fields that hold patient details with suggestions and
autocorrect off; routes that carry UUIDs only; no patient details in a page title; nothing shown
once the store is frozen; every phone screen tested offline. Wording lives in
`apps/mobile/lib/features/encounters/encounter_labels.dart`, with curly apostrophes.

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

### 9.3 Medical or Non-Medical

Two large buttons, each with one line under it: "Medical: clinical notes, orders, signing" and
"Non-Medical: outreach, supplies, social needs" (PRD main 379). A person whose credential cannot
chart Medical (6.2) is not shown this screen: their encounter starts Non-Medical.

The encounter's header has **Switch to Medical** on a Non-Medical encounter, for a credential
that may chart Medical. It changes `kind` and keeps every answer (PRD main 379). On an encounter
with no patient it first asks who the patient is (3.10). There is no switch back: a Medical
encounter with only Non-Medical notes needs none (3.10).

### 9.4 Note types

"Choose an encounter type ... to load its template" (PRD main 380). A list of the note types
offered for the encounter's kind, from the forms part's registry. Tapping one creates the note
and opens its form. If the encounter already has a draft of that type, the app opens that draft.

The encounter screen lists its notes, each collapsed to its recap line, with **Add another note
type** below (PRD main 97). A note by a teammate shows their name. A draft the person authors
has **Remove this note** in its menu: it blanks every answer, after asking, and the note then
counts for nothing (3.1). Empty drafts are not listed.

### 9.5 The note form

The forms part's renderer: accordion sections, each collapsing to its recap line (PRD main 381,
392). This part fixes the frame around it:

- The header shows the patient's preferred name and the allergy badge of phase 3.
- Every answer is saved as it is entered. There is no Save button for a field.
- The bottom bar has **Save & Close** and **Continue**. Continue goes to the summary (9.6).
- A finished note opens read-only (9.7).
- A conflict on an answer (two people changed it) shows both values side by side on the field,
  with the phase 2 choice (PRD main 100).

### 9.6 The summary, and Complete

"Every encounter ends on a summary screen" (PRD main 433). From top to bottom:

1. The recap of each note (8.1), each under its note type's name. Above a recap, a line for
   each answer that someone else changed since the person last had the note open: "{name}
   changed Dressing applied." The screen works out each note's hash as it draws it and hands
   those hashes to Complete, which stops if a note has changed since: "This note changed. Read
   it again." (4.8).
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

### 9.7 The visit

Opened from the timeline or from Notes to finish. A draft the person may edit opens as the form
(9.5). Everything else opens as the read view, drawn from a read model: the phone's own, for a
visit it holds; the chart's `recentVisits`, offline, for the last three; the server's (5.1),
online, for the rest (8.2). The view:

- The envelope: date and time ("time not verified" when it was not), place, Medical or
  Non-Medical, the assessment.
- Each note: its recap, then its sections. A corrected answer shows the new value, and under it
  the old one struck through with who changed it, when and why (PRD main 460). An answer a
  correction took away shows no value, only the old one struck through (the read model's item
  with value null, forms 7.1). For a screen reader the old value is announced as "Replaced: {old
  value}".
- Below each note, in time order: sign-offs ("Signed by {name}, {credential}, {date}"),
  co-signatures, attestations ("Attested by {name}, {date}"), addenda (PRD main 459, 725).
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

### 9.8 The EMS handoff

Red flags answered Yes opens the EMS branch in the form (forms part). When EMS is activated, the
form offers **Show handoff**. It opens a full-screen page built by the forms part's
`handoffLines`: large text, high contrast in every theme, no app bar actions, **Done** at the
bottom. It has no copy and no share (PRD main 413), and its text cannot be selected. Showing it
is logged (`ems_handoff.shown`). It works offline.

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

### 9.10 Referrals (phone)

A sheet from the profile or the summary screen: the past referrals (7), then **Add referral**: a
date, today by default, and a details box of up to 2,000 characters. A row's menu has **Entered
in error**, which asks for a reason.

### 9.11 Portal: the visit page

`apps/portal/src/app/(app)/encounters/[encounterId]/page.tsx`, linked from the patient page's
new Timeline section (links carry `prefetch={false}`,
`apps/portal/src/lib/patient-links.test.ts`). It shows what 9.7 shows, read-only, from
`GET /v1/encounters/{encounterId}`. Its actions: **Co-sign**, **Attest**, **Assign** (9.12) and
**Export EMS handoff (PDF)** when the visit has one; the export asks for a fresh sign-in first
(5.7). The page title is "Visit". Under the patient page's first 50 visits, **Show earlier
visits** loads more (5.2).

### 9.12 Portal: notes not complete, and assigning

- Portal Home gains a count for a Program Admin: "4 notes not complete. 2 are older than a day."
- `apps/portal/src/app/(app)/team/incomplete-notes/page.tsx` lists every draft: the patient, the
  note type, the author, when the visit started, and "Older than a day". A draft whose author has
  left says so and has **Assign**.
- **Assign** is a form on the visit page: a clinician picker that lists only members who pass the
  checks of 5.5, and a reason.

### 9.13 Needs attention (phone)

`apps/mobile/lib/features/sync/sync_labels.dart` gains one sentence for each problem of 4.1, and
`needs_attention_screen.dart` the buttons that settle each (4.1, 8.4). The sentences:

| Problem | Sentence | Buttons |
|---|---|---|
| `content_changed` | "This note changed after you completed it. Open it, read it and complete it again." | Open the note |
| `incomplete` | "This is missing something the note needs. Open the note and try again." | Open the note |
| `red_flags_first` | "Answer the red-flag question first, then complete again." | Open the note |
| `field_changed` | "Someone corrected this answer first. Open the note and check it." | Correct again; Leave it |
| `medical_note_needs_patient` | "A clinical note needs a patient. Choose who this visit is for." | Choose a patient |
| `unknown_note_type` | "This note type isn’t on your team’s list. Choose the note type again." | Choose a note type |
| `definition_error` | "This couldn’t be checked. Tell a Program Admin." | none: a fault in a note type, which a new version fixes |
| `encounter_note_missing`, `note_signoff_missing` | "The note this belongs to isn’t on the team’s list." | as phase 3's missing-record card |
| `encounter_other_patient` | "The visit this names belongs to someone else." | Send without the visit; Choose a visit |

A sign-off that was held for a Program Admin shows on its note as "Sent for review" (4.8).

And four notices, shown on Home as phase 2's notices are:

| Notice | Sentence |
|---|---|
| `note_saved_unsigned` | "Your credential can’t sign this note type. It was saved unsigned for a co-signer." (the existing sentence, `services/api/src/sync/apply.ts:34`) |
| `late_change_kept` | "The note was already finished. Your change was kept in its history. Add an addendum if it matters." |
| `change_not_applied` | "Only the note’s author can do that. Nothing was changed." |
| `note_corrected` | "A note you signed was corrected. It needs your review again." |

### 9.14 Portal: the queues

`apps/portal/src/app/(app)/team/cosign/page.tsx` and `team/attestation/page.tsx`: the rows of
5.4, each opening the visit page. The navigation shows each link only to a credential that may
act. An attending's portal Home shows the attestation count (PRD main 216, 744).

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
finds it (D53). A refused online request is logged with the reason's name.

As built for the sync half (unit L1, with wave D's review). Every event below names its patient
in the row's patient column; its own keys follow `changeId` and, on a create, `clockVerified`.
None holds a value, a reason's text or an addendum's.

| Action | As built |
|---|---|
| `encounter.updated` | A switch of `kind` is a write of the field `kind`: `field`, `kind` (the history kind, `set`), `version`. No key names the new kind, which can only be `medical`. A Medical note's create writes its visit's switch this way, with the note's `changeId` |
| `encounter.kept_in_history`, `note.kept_in_history` | `field`, `version`, `problem` |
| `note.reopened` | A reopen that applied, written as any set is: `field`, `kind`, `version` |
| `note.completed` | `signoffId`, `act`, `effect`, `clockVerified`, on the note |
| `note.signed`, `note.saved_unsigned` | The same, plus `credential`, `needsAttestation`, and `claimedCredential` when it differs |
| `note.signoff_repeated` | `signoffId`, `reason`, `hashMatches`. The event keeps `hashMatches` for every sender, though the receipt gives it only to the acting author (4.6) |
| `note.corrected`, `note.amendment_declined` | One per correction, whatever its outcome: `note.amendment_declined` for `declined`, `note.corrected` for the rest, `not_author`, `no_change` and `draft_edit` included. `correctionId`, `fields` (every field the correction names, a list, since it holds up to ten), `outcome`, `requestedByPatient`, `credential`, `claimedCredential` when it differs, `statusAfter`, `attestationAfter`, `clockVerified`, on the note. A draft edit writes no `note.updated` for each answer |
| `addendum.added` | `encounterId`, `noteId`, on the addendum |
| `referral.created` | `encounterId`, on the referral |
| `referral.entered_in_error` | `field`, `kind`, `version`, and `encounterId` (review finding REC-5) |
| `encounter.viewed`, `note.viewed`, `patient.viewed` (the sync read) | One per record returned, with its entity and ID, and `{ source: 'sync' }`: a visit is `encounter.viewed`; a note, a sign-off, an addendum and a correction are `note.viewed`; a referral is `patient.viewed`. Not one per visit with `noteIds` |
| `ems_handoff.shown`, `notes_to_finish.viewed` (offline) | The closed list's keys (`AuditAppend`): the handoff names its visit by `entity` `encounter` and `entityId`, and its patient; Notes to finish names `patientIds` and `resultCount`, not `count`. `ems_handoff.exported` stays refused offline |

A sign-off's and a correction's events are on entity `encounter_note` and the note, with their
own ID in the details, so the audit search by note finds them. A change held for review writes
`sync.quarantined` with the reason `permission` and nothing that names the rule. Open: the online
events of L2 take the same keys (`resultCount`; `entity` and `entityId`), so that one search finds
both.

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

### 11.2 The test that holds each rule

Every rule below is checked to bite: put the old behaviour back, see the test fail, restore it
(`docs/plan/README.md`).

| Rule | Section | Test |
|---|---|---|
| The six states and the encounter's status | 3.1, 2.2 | `note-lifecycle.json` through `services/api/test/encounter-rules.test.ts` and `apps/mobile/test/encounters/rules_test.dart`; the trigger in `db/test/encounter-lifecycle.test.ts` |
| A finished note's answers change only through a correction | 2.2 | `db/test/encounter-lifecycle.test.ts` (the guard refuses an update, and lets a correction through) |
| The draft stays on its author's phone until finished | 3.2 | `apps/mobile/test/sync/store_encounters_test.dart` |
| Complete's hard stops | 3.3 | `apps/mobile/test/encounters/complete_test.dart` |
| Every row of the sign-off table | 3.4 | `note-lifecycle.json`; `services/api/test/sync-signoffs.test.ts`; parity case 7 |
| The credential a signature is recorded under | 3.5 | `signed-under.json` through `services/api/test/encounter-rules.test.ts`; one end-to-end case in `sync-signoffs.test.ts` (signs Monday, promoted Tuesday, syncs Wednesday) |
| A late change is kept, not refused | 3.6, 4.3, 4.4 | `services/api/test/sync-encounters.test.ts`; parity cases 2 and 5 |
| Reopen | 3.6, 4.4 | `sync-encounters.test.ts`; parity case 6 |
| Corrections, and what happens to the signature after one | 3.6, 4.7 | `services/api/test/sync-corrections.test.ts`; parity case 10 |
| A correction waits behind a refused sign-off | 4.7 | `apps/mobile/test/sync/store_encounters_test.dart` |
| Co-sign and attest: a second person, online, sees every section, hash matches | 3.7, 5.3, 5.4 | `services/api/test/encounters-cosign.test.ts`, `encounters-attest.test.ts` |
| Assigning a note | 3.8, 5.5 | `services/api/test/encounters-assign.test.ts` |
| Overdue after 24 hours, worked out when read | 3.9, 5.6 | `note-lifecycle.json`; `services/api/test/encounters-incomplete.test.ts` |
| No patient: Non-Medical only. Switching kind | 3.10, 4.3 | `sync-encounters.test.ts`; parity case 3 |
| The clock pause covers sign-offs, addenda and corrections, not referrals | 3.11 | `apps/mobile/test/sync/store_encounters_test.dart` |
| The content hash | 4.5 | `note-content-hash.json` through `services/api/test/note-content-hash.test.ts` and `apps/mobile/test/encounters/content_hash_test.dart`; a missing patient or summary hashed as `null`, in the TypeScript test alone (a vector cannot hold undefined); parity case 8 |
| The Medical gate holds a change for review | 4.2 | `sync-encounters.test.ts`; parity case 12 |
| Every encounter-side change takes the team lock | 4.2 | `services/api/test/sync-concurrency.test.ts` (two sign-offs and a kind change at once) |
| Each route's permission, and its refusal logged | 5, 6.1 | `services/api/test/permissions.test.ts` |
| Sensitive content is absent, not blanked | 6.4 | `services/api/test/encounters-read.test.ts`; a `/v1/sync/records` case in `sync-encounters.test.ts` |
| Every action writes its audit event in the same transaction, with no answer in it | 10.1 | `expectAudit` and `expectAuditClean` in each API test above (`services/api/test/patient-fixtures.ts`) |
| A visit read offline is logged or refused | 9.7 | `apps/mobile/test/encounters/visit_read_test.dart` |
| `referrals` is a chart table | 2.5 | the schema test in `services/api/test/patients-charts.test.ts:334-351` |
| Every screen: three themes, 200% text, 320 px, labels, offline, nothing once frozen | 9 | one widget test file per screen under `apps/mobile/test/features/encounters/`; the portal pages in `apps/portal/e2e/` with axe |

## 12. Defaults, risks and departures from the PRD

### 12.1 Defaults chosen

Each is a `PLAN-OPEN:` comment in the code and a row in the plan's section 6.

| # | Question | Default built | Who decides |
|---|---|---|---|
| 1 | Does a note signed offline count as signed at device time or at server receipt? (PRD main 452) | Device time, clock-corrected, with the receipt time stored beside it (plan section 6) | Counsel and the billing partner |
| 2 | The PA rule (PRD main 212) | A PA signs like an NP: attestation needed | Brooke and Mercy, the FQHC partner |
| 3 | May a note be added to a visit whose other notes are finished? | Yes. It is its own note with its own author and time (4.4) | Brooke and Mercy |
| 4 | How long does an untouched draft stay on its author's phone? | 7 days after its last change, then it is released if fully synced (3.2) | The team |
| 5 | The wording a signer, a co-signer and an attester are shown | The three sentences of 3.5, each with a version | Counsel |
| 6 | May a resident, NP or PA co-sign a student's note, or only an attending? | Any credential that signs; the note then waits for attestation if that credential needs it (3.7) | Brooke and Mercy |
| 7 | May the clinician assigned to a departed author's note complete its draft, or only correct it? | Both (3.8) | Brooke and Mercy |
| 8 | Can a co-signer send a note back to its author? | No. The author reopens it while it was never signed (3.6) | Brooke and Mercy |
| 9 | How is a wrong free-text assessment fixed after Complete? | By an addendum, not a field correction (3.6) | Brooke and Mercy |
| 10 | What does a patient's amendment request need beyond the logged decision? (HIPAA §164.526: a written answer in 60 days, a statement of disagreement) | Only the logged request and decision are built (3.6) | Counsel |
| 11 | Can a Medical note be written for someone who is not registered? | No. A Medical note needs a patient; a visit can be given one at any time (3.10) | Brooke and Mercy |
| 12 | Where does the EMS handoff PDF come from? | The portal. The phone shows it full-screen only (5.7) | The team |
| 13 | Who sees a sensitive exam section, and who may co-sign or attest a note that has one? | Whoever acts as the note's author, and holders of `patients.view_sensitive_exams`. A co-signer or attester needs the key too, so a team gives its attendings a role that has it; until then such a note waits (6.4) | Counsel, Brooke and Mercy |
| 14 | The Brief call note preset (PRD main 390) | Not built: the field spec has no fields for it | Brooke and Mercy |
| 15 | Is the GPS position stored, and how exact? | Captured only on a tap, stored as the phone gives it (9.2) | Counsel, the team |
| 16 | How do a note's problem statuses (New, Chronic, Improving, Worse) map to the problem list's (New, Ongoing, Resolved)? | New to New; the others to Ongoing; nothing resolves (8.3) | Brooke and Mercy |
| 17 | How many recent visits ride with a chart, to be read offline? | Three (5.2) | The team |
| 18 | Who may export the EMS handoff as a PDF? PRD main 413 lets a clinician; PRD main 602 keeps exports to Admin and Billing/Data | Whoever may read the Red flags note, with a fresh sign-in, a stamp of who and when, and an audit event (5.7) | Counsel, the team |
| 19 | Is a Social needs or Outreach note inside a Medical visit signed and attested? | No. A Non-Medical note is completed, never signed (3.1) | Brooke and Mercy, the billing partner |
| 20 | Who reads the substance use treatment part of a Harm reduction note? | The note's author, and people with `patients.view_sensitive` and a clinical credential (6.4) | Counsel (42 CFR Part 2) |
| 21 | Do roles without `encounters.chart` or `billing.view_codes` read Medical notes? | No, as D37 decided for the problem list (6.4) | The project lead |
| 22 | Which credential is a signature or a correction recorded under when its time cannot be trusted (the clock not verified, more than five minutes after the receipt, before the server received the note, or a time that cannot be read)? | The one held when the server receives it, with the phone's claim stored beside it; the claim can still make it wait for attestation (3.5) | Counsel and the billing partner |

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
2. **The fake server grows by about a third.** Fourteen rules are mirrored by hand (4.9). Each
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
6. **Card count.** See 13: about a third of this part's cards are level X. A small
   model can't shorten that third.

## 13. Units

The cards are in one index for the whole phase, `docs/plan/phase-4-encounters/README.md`, with
their levels, files and order. This part's units, and what each owns:

| Unit | Owns | Depends on |
|---|---|---|
| **L0** Schema and core rules | `db/migrations/0018` to `0021`, their `db/test` files, the three vector files of 3.12 and their readers, `services/api/src/encounters/{rules,content-hash,signed-under}.ts`, `apps/mobile/lib/encounters/{rules,content_hash}.dart` | forms F1 and F2 for `effectiveAnswers` (the content hash) |
| **L1** Server sync | `services/api/src/sync/**` (changes), `services/api/src/sync/entities/{note-signoff,note-addendum,note-correction,referral}.ts`, `services/api/src/encounters/signer.ts`, `services/api/test/sync-{encounters,signoffs,corrections,referrals}.test.ts`, and phase 2's sync tests, which move to a test-only note type (4.4) | L0; forms F1 (`checkAnswer`, `finishCheck`, `effectiveAnswers`, `visibleAnswers`) and F3 (stored definitions) |
| **L2** Server routes | `services/api/src/routes/encounters.ts`, `services/api/src/encounters/{read,timeline,queues,cosign,attest,assign,incomplete,counts,handoff}.ts`, the timeline and recent visits in `services/api/src/patients/{charts,projection,schemas}.ts`, `services/api/test/encounters-*.test.ts` | L1; forms F1 (`readModel`, `handoffLines`) |
| **L3** The phone's sync layer | `apps/mobile/lib/sync/{entities,local_store}.dart`, `apps/mobile/test/sync/{fake_server,fake_parity_test,fake_reads_test,store_encounters_test}.dart` | L0, L1 (the fake mirrors it); forms F2 and F4 (the fake reads definitions from the conformance file and the bundled presets) |
| **L4** The phone's domain layer | `apps/mobile/lib/encounters/` (all but the two core files of L0 and the two of forms F7), `apps/mobile/test/encounters/`, and named edits to `apps/mobile/lib/patients/{chart_cache,problems}.dart` | L3, the generated client from L2 |
| **L5** The phone's screens | `apps/mobile/lib/features/encounters/`, its tests, and named edits to `patient_screen.dart`, `home_screen.dart`, `app.dart`, `sync_labels.dart`, `needs_attention_screen.dart` | L4; forms F5 (the renderer and the read view, which F5 owns) |
| **L6** The portal | `apps/portal/src/app/(app)/encounters/`, `team/{cosign,attestation,incomplete-notes}/`, `apps/portal/src/app/actions/encounters.ts`, `apps/portal/e2e/{encounters,attestation}.spec.ts`, the Timeline on the patient page, the navigation links in `layout.tsx` | L2 |
| **L7** The Done when | `packages/contract/test-vectors/encounters-done-when.json`, `apps/mobile/test/encounters/{done_when_test,live_encounters_test}.dart`, `services/api/test/encounters-done-when.test.ts`, the line in `tools/live-sync.sh` | all |

This part is 94 of the phase's 218 cards: 4 at level S, 24 at T, 34 at R and 32 at X. The sync
core, the phone's store and the phone's test server are where the X cards are, and a small model
cannot shorten that third.

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
