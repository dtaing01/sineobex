> **Draft (Nov 14), not yet reviewed.** Sections 1 to 3 were written by a planning agent, sections 4 to 13 by the coordinating session. No second reader has checked it against the PRD and the code yet: do not build from it.

# Phase 4 design, part 2: the encounter lifecycle, sync and screens

Status: complete as a draft; waiting for the phase review and for the forms part.

This part covers how an encounter is stored, saved, completed, signed, attested, corrected and
synced, and the screens around it. The other part (`docs/design/phase-4/forms.md`) covers the form
definitions, their generation from the field specification, the renderer and field validation.

Who builds from this: a small local model, one task card at a time (`docs/plan/README.md`), with a
strong model or a person writing the tests for the safety-critical cards first. So the judgment
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
| Encounter sets and creates that name a patient take the team's write lock first. Note changes do not. | `services/api/src/sync/entities/encounter.ts:54-55`; `note.ts:42` | A sign-off writes the note and the encounter, so phase 4 makes every encounter-side change take the team lock first (4.2). |
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
| `summary` | `text`, null or 1 to 4,000 characters | The free-text assessment written on the summary screen | PRD main 383, 433 |
| `location_text` | `text`, null or 1 to 200 characters | The place, entered by hand | PRD main 378 |

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

**`encounter_notes`: new columns.**

| Column | Type | Meaning |
|---|---|---|
| `medical` | `boolean not null default false` | Whether the note is a Medical note (3.1). Set from its note type when the note is created, never changed. Rows from before this migration are Non-Medical. |
| `completed_at` | `timestamptz` | When the note last left draft (clock-corrected device time). Null while a draft. |
| `completed_by` | `uuid` references `users` | Who finished it |
| `first_signed_at` | `timestamptz` | Set once, at the first signature. A note that was ever signed is never reopened. |
| `signoff_id` | `uuid` | The sign-off that makes the note signed now. Null unless `status = 'signed'`. Foreign key `(team_id, signoff_id)` to `note_signoffs`, added in 0019. |
| `attestation` | `text not null default 'not_needed'`, one of `not_needed`, `waiting`, `attested` | Whether an attending must still attest the note as it reads now |
| `assigned_user_id` | `uuid` references `users` | The clinician a Program Admin assigned after the author left. Null: the author acts. |

Also `unique (team_id, id)` on `encounter_notes`, so other tables can point at a note with a
composite key, and one partial index for the attestation queue:

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
check ((status = 'draft') = (completed_at is null))
check ((completed_at is null) = (completed_by is null))
check (status = 'signed' or attestation = 'not_needed')
check (first_signed_at is not null or status <> 'signed')
check (medical or status <> 'signed')
```

`(status = 'signed') = (signoff_id is not null)` is added in 0019, once the table it points at
exists. Before the checks, the migration fills `completed_at = updated_at` and
`completed_by = author_user_id` for rows that are already `completed`.

**The finished-note guard.** A finished note's answers change only through a correction. The
database holds that rule itself:

```sql
create function sineobex.guard_finished_note() returns trigger
language plpgsql as $$
begin
  if old.status <> 'draft' and new.data is distinct from old.data
     and coalesce(current_setting('app.note_correction', true), '') <> old.id::text then
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
| `signer_npi` | `text` | Null when that credential has none |
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
| `note_id` | `uuid` | The note it is attached to. Null: it is about the visit's summary. |
| `text` | `text`, 1 to 4,000 characters | |
| `written_at` | `timestamptz not null` | Clock-corrected device time |
| `clock_verified` | `boolean not null` | |
| `author_user_id`, `author_name`, `author_credential` | | Who wrote it, as they were then |
| `created_device_id`, `change_id`, `created_at` | | As on `problem_notes` (`0010_problems.sql:63-79`) |

Index `(team_id, encounter_id, written_at)`.

**`note_corrections`**: "the author picks the wrong field, enters the right value and gives a
reason" (PRD main 460). A patient's amendment request uses the same row (PRD main 463), the way
`patient_corrections` records one for identity fields (`0009_patients.sql:288-308`). Append-only.

| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid primary key` | Made on the phone |
| `team_id`, `note_id` | `uuid not null` | Foreign key to `encounter_notes (team_id, id)` |
| `field` | `text not null`, starts with `data.` | The answer corrected |
| `outcome` | `text`, one of `corrected`, `declined`, `no_change` | `declined`: an amendment request refused, the note unchanged. `no_change`: the note already held that value. |
| `old_value`, `new_value` | `jsonb` | The value replaced, and the value asked for |
| `reason` | `text`, 3 to 500 characters | |
| `requested_by_patient` | `boolean not null default false` | A HIPAA §164.526 amendment request |
| `history_id` | `bigint` references `field_history (id)` | The `corrected` history row. Null unless `outcome = 'corrected'`. |
| `corrector_user_id`, `corrector_name`, `corrector_credential` | | Who corrected it, as they were then |
| `corrected_at` | `timestamptz not null` | Clock-corrected device time |
| `clock_verified`, `created_device_id`, `change_id`, `created_at` | | |

Checks: `outcome <> 'declined' or requested_by_patient`;
`(outcome = 'corrected') = (history_id is not null)`. Index `(team_id, note_id, corrected_at)`.

The app role gets no `update` or `delete` on these three tables.

### 2.4 `0020_note_attestations.sql`

**`note_attestations`**: "Attesting adds a dated statement below the note and doesn't change it"
(PRD main 216). Append-only. One row per attestation; a note corrected after it was attested gets
a second row when it is attested again.

| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Attesting is online, so the server makes the ID |
| `team_id`, `note_id` | `uuid not null` | Foreign key to `encounter_notes (team_id, id)` |
| `signoff_id` | `uuid not null` | The signature attested. Foreign key to `note_signoffs (team_id, id)`. |
| `content_hash` | `text not null` | The note as the attending read it |
| `attending_user_id`, `attending_name` | | |
| `attending_npi` | `text not null` | The billing export needs the attesting physician's NPI (PRD main 656) |
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
| `error_reason`, `error_by`, `error_at` | | As on `patient_allergies` |
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
5. If one of the notes is a Medical note and the person authors the encounter's Red flags and
   disposition note, that note is finished with the others and is not skipped as an empty
   draft: its finish check then asks for the red-flag answer (forms 6.2). A second clinician on
   the same visit is not held up by the first one's Red flags note.

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
| draft | any | the sender does not act as the author | refused: `not_author` | Draft |
| draft, Non-Medical note | `sign` | | refused: `sign_not_medical` | Draft |
| already finished | any | none | `none` | Unchanged |
| completed, Medical note | `cosign` (online, 5.3) | hash matches; a second person; can sign; can see every answer that counts | `signed` | Signed; attestation by the co-signer's credential |

Three of these need a word.

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
- **A refusal** (`content_changed`, `incomplete`) leaves the note a draft on the server and puts
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
Tuesday and syncs on Wednesday signed as a resident, and that note needs attestation.

The function `signedUnder` decides it. It is server-only and pure:

| Input | From |
|---|---|
| `current` | The signer's membership now: credential and fields (also when they were removed since) |
| `laterChanges` | `membership_changes` rows of kind `credential` for that membership, made after `signedAt`, oldest first (1.3) |
| `signedAt`, `receivedAt`, `clockVerified` | The change |
| `claimed` | The credential the phone's saved profile showed |

1. The time is **trusted** when `clockVerified` is true and `signedAt` is not more than 5 minutes
   after `receivedAt` (the clock limit, `services/api/src/sync/push.ts:19`).
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
- What: one answer (`data.<path>`) of a finished note, a new value, a reason of 3 to 500
  characters, and the version of the answer the person was looking at.
- The server writes the new value with history kind `corrected`, and a `note_corrections` row
  with the old value, the reason and who.
- If the answer already holds that value, the correction is stored as `no_change`.
- If the answer changed since the person looked (another correction got there first), it is
  refused with `field_changed`. The fix is to look again and correct again.
- A correction to a draft is refused with `note_not_finished`: the author just edits it.
- The free-text summary is not corrected field by field. A wrong summary gets an addendum
  (PLAN-OPEN 12.1 #9).
- Works offline.

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
- Nobody co-signs or attests a note they act as the author of.
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
  hashMatches: boolean; finishOk: boolean;
}): { refuse: 'not_author' | 'sign_not_medical' | 'content_changed' | 'incomplete' }
  | { effect: 'none' }
  | { effect: 'completed' | 'signed' | 'saved_unsigned'; statusAfter: NoteStatus; attestationAfter: Attestation }
```

The checks run in this order, and the first that applies decides:

1. `noteStatus` is not `draft`: `{ effect: 'none' }`.
2. `actsAsAuthor` is false: refuse `not_author`.
3. `act` is `sign` and `medicalNote` is false: refuse `sign_not_medical`.
4. `hashMatches` is false: refuse `content_changed`.
5. `finishOk` is false: refuse `incomplete`.
6. `medicalNote` is false, or `act` is `complete`: `completed`, status `completed`,
   `not_needed`.
7. `canSign` is true: `signed`, status `signed`, `waiting` if `needsAttestation`, else
   `not_needed`.
8. Otherwise: `saved_unsigned`, status `completed`, `not_needed`.

**`reopenEffect`** (the table in 4.4):

```ts
reopenEffect(i: { noteStatus: NoteStatus; everSigned: boolean; medicalNote: boolean; actsAsAuthor: boolean }):
  'apply' | 'nothing' | 'keep_in_history' | { refuse: 'not_author' }
```

1. `draft`: `nothing`. 2. `signed`, or `everSigned`: `keep_in_history`. 3. Not a Medical note:
`keep_in_history`. 4. `actsAsAuthor`: `apply`. 5. Otherwise refuse `not_author`.

**`correctionEffect`** (the table in 3.6), called only for a finished note:

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
  noteStatus: NoteStatus; attestation: Attestation; actsAsAuthor: boolean; canAttest: boolean;
  seesAllThatCounts: boolean; hashMatches: boolean;
}): { refuse: 'not_waiting' | 'is_author' | 'cannot_attest' | 'cannot_see_all' | 'content_changed' }
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

## 4. Sync

Everything in this section is level X: it changes `services/api/src/sync/**`,
`apps/mobile/lib/sync/**` and the phone's test server. A strong model builds it, a second review
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
`encounter_missing` does today. The new problems:

| `details.problem` | Raised by | The worker's fix |
|---|---|---|
| `content_changed` | a sign-off whose hash differs from the note the server holds | Open the note, read it, Complete again |
| `incomplete` | a sign-off on a note that fails the finish check | Fill in what is missing, Complete again |
| `not_author` | a sign-off, reopen or correction from someone who does not act as the note's author | Discard it (the screens never offer this) |
| `sign_not_medical` | `sign` on a Non-Medical note | Complete again (the screens never send this) |
| `use_signoff` | a `set` of a note's `status` to `completed` | None: only an old build sends it |
| `note_not_finished` | a correction or an addendum to a draft | Edit the draft |
| `field_changed` | a correction whose answer changed since the person looked | Look again, correct again |
| `note_type_needs_medical` | a Medical note on a Non-Medical encounter | Switch the encounter to Medical, which is always possible (3.10) |
| `medical_note_needs_patient` | a Medical note on an encounter with no patient | Name the patient, which is always possible (3.1) |
| `unknown_note_type` | a note on a key or version the team does not have | None: the phone only offers listed versions (forms 3.4) |
| `kind_cannot_go_back` | a `set` of `kind` to `non_medical` on a Medical encounter | None: the screens never send it |

A create that names a note or a sign-off the team does not have is refused with the existing
`stale_reference` (`encounter_note_missing`, `note_signoff_missing`), as any create with a
missing parent is (`services/api/src/sync/apply.ts:494-495`). It is held instead when the
sender's own create of that parent waits for review (`:466-482`).

Each problem gets one sentence in `apps/mobile/lib/features/sync/sync_labels.dart` (9.13).

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
does not: anyone who charts may add one. The phone offers a Medical note type only to a
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

### 4.3 The encounter

- **Create** takes `kind`, `patientId`, `location` and, new, `locationText` (1 to 200 characters,
  PRD main 378).
- **Settable fields**: `patientId`, `location`, `locationText`, `summary` (1 to 4,000 characters)
  and `kind`.
- **`kind`** takes one value from a phone, `medical`. It applies at any time, finished notes or
  not (3.10). A `set` to `non_medical` on a Non-Medical encounter changes nothing; on a Medical
  encounter it is refused with `kind_cannot_go_back`.
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
  that has no patient still applies. This replaces `record_locked` for encounters.
- **A merged patient.** A merge moves no rows (D27). An encounter keeps the patient ID it was
  made with, and every read takes the merged group, so an encounter never needs a redirect.
- **Last seen.** When an encounter that names a patient is accepted, and when a `patientId` set
  is applied, the server moves that patient's `last_seen_at` to the encounter's `started_at` if
  that is later than the value held and not later than the server's clock. It never moves
  backwards.

### 4.4 The note

- **Create** is accepted whatever state the encounter's other notes are in. Today it is refused
  with `record_locked` on a signed encounter (`services/api/src/sync/entities/note.ts:50`); from
  phase 4 the note is the unit (the one-page summary, point 1), and a teammate adding a Social
  needs note after the clinician signed must not lose it. The checks on a create, in order: the
  key and version are in the team's `note_type_versions`, else `unknown_note_type`; for a Medical
  note, the encounter is Medical, else `note_type_needs_medical`; it names a patient, else
  `medical_note_needs_patient`; then the Medical gate (4.2).
- **A note with no version** exists only as a phase 2 preview row. It keeps the open path rule it
  was written under, is never checked against a definition, and counts as a Non-Medical note. No
  new note can be created without a version.
- **Phase 2's own tests** chart on made-up note types (`vitals`, `wound_care`) with free paths and
  set `status` to `completed` (`services/api/test/sync.test.ts`,
  `apps/mobile/test/sync/local_store_test.dart`, `sync_scenarios_test.dart`, `live_api_test.dart`,
  `apps/mobile/test/features/sync_flow_test.dart`). Card L1-0 gives them a test-only note type,
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
  `rejected('permission')` and so is held for a Program Admin. The acting author may always set
  their own note's answers.
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
| `completed`, never signed, a Medical note | someone else | Refused: `not_author` |

A `set` of `status` to `completed` is refused with `use_signoff`. Nothing in the app sends it.

- **What the sync read shows of a note.** The snapshot of a note in `/v1/sync/records` gains the
  attributes `attestation`, `actingAuthorId`, `completedAt` and `signoffId`, so the author's
  phone can show the state of a note it still holds.

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
   `hashMatches` (4.5), `finishOk` (the forms part's `finishCheck` returns nothing), and from
   `signedUnder` (3.5) `canSign` and `needsAttestation`.
3. Call `signoffEffect`. The sync code holds no rule of its own: it writes what the function says.
4. **Refuse**: `rejected('validation', { problem })`. Nothing is written but the stored rejection.
5. **Effect `none`** (the note is already finished): insert the `note_signoffs` row with
   `effect: 'none'`. The receipt's details carry `hashMatches`.
6. **Any other effect**: insert the `note_signoffs` row; update the note in one statement:
   `data` (the answers that count, 4.5), `status`, `completed_at`, `completed_by`, and when
   signed `first_signed_at`, `signoff_id` and `attestation`; write a `field_history` row for
   `status` and one for each answer dropped. The trigger updates the encounter.
7. One audit event, in the same transaction: `note.completed`, `note.signed` or
   `note.saved_unsigned` (10.1).
8. `saved_unsigned` also writes a notice to the signer (`user_notices`, kind
   `note_saved_unsigned`).

The receipt is `accepted` with `details: { effect, status, attestation, hashMatches }`. The
phone writes that onto its copy of the note (4.8).

**Sent twice.** The same change sent again answers with its stored receipt, as every change does
(phase 2). A second sign-off for a note that is already finished is effect `none`.

**After a refusal.** The phone sends the same sign-off record again with the new hash (a create
that supersedes the refused one, `apps/mobile/lib/sync/local_store.dart:1328-1345`). The server
applies it as a fresh sign-off.

**From a removed person.** Their changes are held for a Program Admin
(`services/api/src/sync/apply.ts:403-443`). When the admin accepts a held sign-off it applies as
above. `signedUnder` reads the membership as it is now, removed or not, and its history.

### 4.7 Addenda, corrections and referrals

**`note_addendum`**: `{ encounterId: uuid, noteId: uuid | null, text: 1..4000, signoffId: uuid |
null }`. Parents: the encounter, the note when given, and `signoffId` when given. The phone fills
`signoffId` with its own sign-off while that sign-off is not yet confirmed, as it does for a
correction below, so an addendum written a moment after Complete waits behind the sign-off and is
never lost or sent early (PRD main 564). An addendum to a draft note, or to a visit with no
finished note, is refused with `note_not_finished`. Audit: `addendum.added`.

**`note_correction`**:

```ts
{ noteId: uuid, field: `data.${path}`, newValue: unknown, baseVersion: number,
  reason: 3..500, requestedByPatient: boolean, declined: boolean, signoffId: uuid | null }
```

- Parents: the note, and `signoffId` when given. The phone fills `signoffId` with its own
  sign-off of that note while that sign-off is not yet confirmed. The phone's hold rule then
  keeps the correction waiting if that sign-off is refused
  (`apps/mobile/lib/sync/local_store.dart:976-1018`), and releases it when the same sign-off
  record is sent again and accepted. So a correction never reaches a note that is still a draft
  because of a race.
- Checks, in order: the note is finished, else `note_not_finished`; the sender acts as the
  author, else `not_author`; for a Medical note, the Medical gate; `newValue` passes
  `checkAnswer`; `declined` only with `requestedByPatient`; the answer's version equals
  `baseVersion`, else `field_changed`.
- `declined`: the row is stored with `outcome: 'declined'` and the note is unchanged.
- The answer already holds `newValue`: stored with `outcome: 'no_change'`.
- Otherwise: `set_config('app.note_correction', noteId, true)`, then the answer is written with
  history kind `corrected` (the guard of 2.2 lets it through), the `note_corrections` row is
  inserted with the history row's ID, and `correctionEffect` (3.12) says what happens to `status`,
  `signoff_id` and `attestation` (the table in 3.6). Two small changes to
  `services/api/src/sync/records.ts` make this possible: `'corrected'` joins the `HistoryKind`
  type (`:228-237`), and `appendHistory` returns the row's ID (`:256-264`).
- A correction can hide a field that holds an answer, or show one again. The answer stays in the
  note and counts or not by the definition, as `effectiveAnswers` says. The signer saw it when
  they signed.
- Audit: `note.corrected`, `note.amendment_declined`. The details name the field path and the
  outcome, never a value.

**`referral`**: `{ patientId: uuid, referredOn: date, details: 1..2000, encounterId: uuid | null }`.
Its shape copies `patient_allergy` (`services/api/src/sync/entities/allergy.ts`), with its own
rule for who may act:

- Create needs `referrals.create`.
- One settable field, `enteredInError`, of class `set_once`, with the value `{ reason }` the
  allergy uses (`allergy.ts:127`). It needs `referrals.create`, and `mayChange` allows it for the
  referral's author or for anyone who holds `encounters.chart`. A community health worker can
  take back their own referral; a clinician can take back anyone's.
- `referredOn` may not be more than one day in the future (`valueProblem`, as a birth date is
  checked).
- Parents: the patient, and the encounter when given.
- Audit: `referral.created`, `referral.entered_in_error`.

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
- `ems_handoff.shown` joins the list of actions a phone may log offline, on the phone and on the
  server (`services/api/src/sync/entities/values.ts:269-277`). The list is closed, so without
  this the handoff page could not be logged, and a read that can't be logged is refused.

`apps/mobile/lib/sync/local_store.dart` gains:

1. **`finishNotes`**. One transaction. For each note it drops from the phone's copy the answers
   that do not count (4.5), then makes the sign-off: a new `note_signoff` create, or, for a note
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

### 4.9 The phone's test server

`apps/mobile/test/sync/fake_server.dart` mirrors the API by hand (plan risk 7). Each rule below
gets the same change in the fake and one case in `apps/mobile/test/sync/fake_parity_test.dart`
or `fake_reads_test.dart`, which hold the fake to the API's answers (D52). The API side of each
case is an API test with the same name.

| # | Rule the fake must mirror |
|---|---|
| 1 | An encounter's `status` is not settable; `summary` and `locationText` are; `kind` goes to `medical` at any time and never back |
| 2 | The envelope lock: a late change is `accepted` with `server` and `details.outcome: 'history_only'`; sent twice, it answers the same; a blank patient can still be filled |
| 3 | A Medical note needs a Medical encounter and a patient |
| 4 | A note create is accepted on an encounter whose notes are finished; an unknown key or version is refused |
| 5 | A change to a finished note is kept in history, with a notice to the sender and to the author |
| 6 | A note's `status` takes `draft` only; each row of the reopen table in 4.4 |
| 7 | Every row of the sign-off table in 3.4, from `note-lifecycle.json`; a sign-off sent again after a refusal |
| 8 | The content hash over the answers that count, from `note-content-hash.json`; a finished note holds only those answers |
| 9 | An addendum needs a finished note, and waits behind a refused sign-off |
| 10 | Each check of a correction, in the order of 4.7; each row of the table in 3.6 |
| 11 | A referral: create; `enteredInError` once, by its author or a charting role; the date rule |
| 12 | The Medical gate holds every kind of change to a Medical note for review |
| 13 | The encounter's status follows its notes (the trigger of 2.2, as code in the fake) |
| 14 | An answer that fails `checkAnswer` is refused with `validation` |
| 15 | `ems_handoff.shown` is an offline audit action |
| 16 | The sync read: a note's new attributes; for a reader who may not see a section, its answers, their versions and their history marks are all absent |

The fake reads the same vector files, so rules 7 and 8 cannot drift.

### 4.10 What a phone learns later

Co-signing, attesting and assigning happen online, on another device. The author's phone learns
of them in three ways:

- **A notice** (`user_notices`) on the next sync. New notice kinds, none with any text:
  `note_cosigned`, `note_attested`, `note_assigned`, `note_saved_unsigned`, `late_change_kept`,
  `note_corrected` (to a co-signer or attester whose note was corrected).
- **The record refresh**, for a note the phone still holds open: the snapshot's new attributes
  (4.4) show its state. The refresh covers open records only
  (`apps/mobile/lib/sync/sync_engine.dart:497-517`).
- **The visit read** (5.1), for everything else. A finished note has left the phone, and a
  teammate's addenda, corrections, co-signatures and attestations are rows the phone never held.
  The visit screen asks the server for the whole visit and shows it from memory. It is not saved
  on the phone, and it is not available offline (8.2).

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
| 5.5 | `POST /v1/notes/{noteId}/assign` | `team.manage_users` | none |
| 5.6 | `GET /v1/me/notes-to-finish`, `GET /v1/team/incomplete-notes` | `encounters.chart`; `team.manage_users` | none |
| 5.7 | `GET /v1/encounters/{encounterId}/ems-handoff` | `patients.view`, and a recent sign-in | none |

### 5.1 Read a visit

Answer: the envelope (`kind`, `status`, `startedAt`, `clockVerified`, `locationText`, `summary`,
`patientId`), the visit's own addenda, and for each note the reader may see (6.4):
`noteTypeKey`, `noteTypeVersion`, `status`, `attestation`, author and acting author (ID and
display name), `read` (the note laid out for reading by the forms part's `readModel`, which the
portal and the phone draw), `signoffs`, `addenda`, `corrections`, `attestations`, `contentHash`.

- `read` is built from the answers the reader may see (the forms part's `visibleAnswers`, 6.4).
  A note the reader may not see at all is absent, not blanked.
- `contentHash` is present only when the reader sees every answer that counts. Co-sign and
  attest need it.
- Refusals: `404` for an encounter the team does not have. Audit: `encounter.viewed`, with the
  patient ID and the note IDs shown.

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
card L4-11 adds `timeline`, `recentVisits` and the referral snapshots to it.

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
  caller does not act as its author, else `403`; the credential can attest; the caller sees
  every answer that counts; the hash matches, else `409 content_changed`. All or nothing, as in
  5.3. Then for each note a `note_attestations` row and `attestation = 'attested'`. Audit: one
  `note.attested` per note. Notice to each signer: `note_attested`, one per visit.

### 5.5 Assign a note

Body: `{ toUserId, reason }` (3 to 500 characters). Checked by `mayAssign` (3.12): the note's
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

### 5.7 The EMS handoff

"Sineobex builds a handoff summary from the encounter. It is shown full-screen for the medic and
can be exported as a PDF; both are audit-logged. There is no copy-to-clipboard or share-sheet
option" (PRD main 413). The phone shows the summary full-screen, offline, built by the forms
part's `handoffLines` (9.8). The PDF comes from the portal: this route returns
`application/pdf`, built on the server from the same lines. A PDF made on the phone would have
to leave through a share sheet, which the PRD rules out (PLAN-OPEN 12.1 #12).

A file leaves our control, so the PRD's rule for desktop exports applies (PRD main 602):

- The route needs a recent sign-in. Without one it answers `reauth_required`, and the portal
  sends the person through its existing `/reauth` page.
- Every page is stamped with who exported it and when.
- The answer is sent with `Cache-Control: no-store`.
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
   read and the queues. In the sync read the answers' versions and history marks go with them:
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
- **A mistake** is marked entered in error with a reason, as an allergy is. It stays in the
  list, struck through. Nothing is deleted.
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
- **When a finished note leaves the phone.** A screen-level listener calls the store's
  `closeRecord` for a note once its sign-off is confirmed, and for the encounter once every one
  of the person's notes on it is closed. The purge then removes what is confirmed
  (`apps/mobile/lib/sync/local_store.dart:1895-1922`). Data still leaves the phone only after a
  hash-confirmed receipt: nothing here touches the purge.
- **Opening a visit that has left the phone** needs a connection: the visit screen loads it
  through the record refresh. Offline it says "This visit isn't on this phone. Connect to open
  it."

### 8.3 Problems made or changed in an encounter

Phase 3 left two hooks (1.1, 1.2): `problems.source` and the `encounterId` of a status.

- The General note's Assessment has a problem search with a status (field spec, lines 31-37). The
  forms part gives it a field kind that stores what was picked in the note: the code, the label
  and the status as tapped.
- Under it sits **Add to the problem list**. It creates a `problem` record through the phase 3
  path (`PatientRepository`, `apps/mobile/lib/patients/problems.dart`), with the encounter's ID.
  The problem create's value gains an optional `encounterId`; the server sets
  `source = 'encounter'` when it is present (`services/api/src/sync/entities/problem.ts:185-197`).
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
  Attested). It opens the visit (9.7). The type filter of PRD main 725 is one row of chips above
  the list, built from the note types present.

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
chart Medical (6.2) is not shown this screen: the encounter is Non-Medical.

The encounter's header has **Switch to Medical** while no note is finished, for a credential
that may. It changes `kind` and keeps every answer (PRD main 379). **Switch to Non-Medical**
shows only when every note's type allows it.

### 9.4 Note types

"Choose an encounter type ... to load its template" (PRD main 380). A list of the note types
offered for the encounter's kind, from the forms part's registry. Tapping one creates the note
and opens its form. If the encounter already has a draft of that type, the app opens that draft.

The encounter screen lists its notes, each collapsed to its recap line, with **Add another note
type** below (PRD main 97). A note by a teammate shows their name.

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

1. The recap of each note (8.1), each under its note type's name.
2. **Assessment**: a text box of up to 4,000 characters (the encounter's `summary`), with a
   counter that speaks at 90% and at the limit, as phase 3's note counter does.
3. **Suggested next steps**: chips from the forms part's suggestion rules (PRD main 433), each
   adding a note type.
4. **Add referral** (7).
5. What stops Complete, when anything does, as a list. Each line names the note and the section,
   and jumps to it: "Wound care: record consent for the exam."
6. The signing sentence (3.5), when the button signs.
7. **Save & Close** and the Complete button, worded by the table in 3.3.

Complete finishes the person's own notes. If a teammate's draft is in the same encounter, a line
says so: "{name}'s note stays a draft until they complete it." After Complete, the chart opens
(8.2).

### 9.7 The visit

Opened from the timeline or from Notes to finish. A draft the person may edit opens as the form
(9.5). Everything else opens as the read view:

- The envelope: date and time ("time not verified" when it was not), place, Medical or
  Non-Medical, the assessment.
- Each note: its recap, then its sections. A corrected answer shows the new value, and under it
  the old one struck through with who changed it, when and why (PRD main 460). For a screen
  reader the old value is announced as "Replaced: {old value}".
- Below each note, in time order: sign-offs ("Signed by {name}, {credential}, {date}"),
  co-signatures, attestations ("Attested by {name}, {date}"), addenda (PRD main 459, 725).
- Actions, each shown only when the server would accept it: **Add addendum**; **Correct** on an
  answer, for the acting author; **Reopen**, for a note waiting for a co-signer that was never
  signed; **Co-sign** and **Attest**, online only, greyed with "Connect to co-sign" offline.

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
**Export EMS handoff (PDF)** when the visit has one. The page title is "Visit".

### 9.12 Portal: notes not complete, and assigning

- Portal Home gains a count for a Program Admin: "4 notes not complete. 2 are older than a day."
- `apps/portal/src/app/(app)/team/incomplete-notes/page.tsx` lists every draft: the patient, the
  note type, the author, when the visit started, and "Older than a day". A draft whose author has
  left says so and has **Assign**.
- **Assign** is a form on the visit page: a clinician picker that lists only members who pass the
  checks of 5.5, and a reason.

### 9.13 Needs attention (phone)

`apps/mobile/lib/features/sync/sync_labels.dart` gains one sentence for each problem of 4.1, and
`needs_attention_screen.dart` the two buttons of 8.4. The sentences:

| Problem | Sentence |
|---|---|
| `content_changed` | "This note changed after you completed it. Open it, read it and complete it again." |
| `incomplete` | "This note is missing something it needs. Open it and complete it again." |
| `not_author` | "Only the note’s author can do this." |
| `note_not_finished` | "This note isn’t finished yet, so it can be edited directly." |
| `field_changed` | "Someone corrected this answer first. Open the note and check it." |
| `note_type_needs_medical` | "This note type needs a Medical encounter." |

And three notices, shown on Home as phase 2's notices are:

| Notice | Sentence |
|---|---|
| `note_saved_unsigned` | "Your credential can’t sign this note type. It was saved unsigned for a co-signer." (the existing sentence, `services/api/src/sync/apply.ts:34`) |
| `late_change_kept` | "The note was already finished. Your change was kept in its history. Add an addendum if it matters." |
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
| `encounter.late_change_kept` | an envelope change after a finished note | `field`, `changeId` |
| `note.created`, `note.updated` | existing | existing |
| `note.late_change_kept` | a change to a finished note | `field`, `changeId` |
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
| `cosign_queue.viewed`, `attestation_queue.viewed`, `notes_to_finish.viewed`, `incomplete_notes.viewed` | 5.4, 5.6 | `patientIds`, `count` |
| `ems_handoff.shown`, `ems_handoff.exported` | 9.8, 5.7 | `encounterId` |

Every event names its patient in the audit row's patient column, so the audit search by patient
finds it (D53). A refused online request is logged with the reason's name.

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
| 4 | Offline again, later. They open the visit from Notes to finish, write the assessment and press Complete and sign. | Four sign-offs wait in the outbox. The notes are read-only. The patient's chart opens with the visit marked "Waiting to send". |
| 5 | The phone reconnects. | Four `note_signoffs` rows with effect `signed`. The notes are `signed` with `attestation = 'waiting'`. The encounter is `signed`. One audit event per sign-off, each in its change's transaction. |
| 6 | The phone's sync finishes. | The notes and the encounter have left the phone. Notes to finish is gone. |
| 7 | An attending, online, opens the attestation queue and attests the visit in one action. | The queue lists one visit with four notes, then none. Four `note_attestations` rows. `attestation = 'attested'`. Audit events `attestation_queue.viewed` and `note.attested`. The resident has one `note_attested` notice for the visit. |

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
| The content hash | 4.5 | `note-content-hash.json` on both sides; parity case 8 |
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
| 11 | Can a Medical encounter have no patient? | No. A visit with no patient is Non-Medical (3.10) | Brooke and Mercy |
| 12 | Where does the EMS handoff PDF come from? | The portal. The phone shows it full-screen only (5.7) | The team |
| 13 | Who sees a sensitive exam section? | Whoever acts as the note's author, and holders of `patients.view_sensitive_exams` (6.4) | Counsel, Brooke and Mercy |
| 14 | The Brief call note preset (PRD main 390) | Not built: the field spec has no fields for it | Brooke and Mercy |
| 15 | Is the GPS position stored, and how exact? | Captured only on a tap, stored as the phone gives it (9.2) | Counsel, the team |
| 16 | How do a note's problem statuses (New, Chronic, Improving, Worse) map to the problem list's (New, Ongoing, Resolved)? | New to New; the others to Ongoing; nothing resolves (8.3) | Brooke and Mercy |

### 12.2 Questions that need a person and have no default

1. **Whether NP attestation is a payer rule or the partner's policy** (PRD main 216). The code
   reads one flag per credential (`billingNeedsAttestation`), so the answer is a data change.
2. **42 CFR Part 2** (PRD main 435). Until counsel answers, the three sensitive note types stay
   behind `patients.view_sensitive`.
3. **A registered nurse credential.** The PRD's table has none (PRD main 208-214) and the code
   has seven credentials (1.3). An RN today is `none`, and charts Non-Medical only.
4. **Retention of drafts that are never completed.** They stay drafts for ever, flagged as
   overdue. Whether an admin may close one unfinished is not decided.

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

### 12.4 Risks

1. **Signing offline is the riskiest rule in the product.** A signature must cover what was
   read. The content hash is the whole defence, so its two implementations are pinned by one
   vector file, the fake uses the same file, and the live job signs against the real API.
2. **The fake server grows by about a third.** Fourteen rules are mirrored by hand (4.9). Each
   has a parity case; a rule added later without one is plan risk 7 again.
3. **The status trigger and the finished-note guard put rules in the database.** They are the
   second line, as row-level security is. The first line is still the API, and the guard's error
   class is chosen so that a bug in it becomes a stored rejection, never a stuck queue (2.2).
4. **The membership history decides credentials.** `signedUnder` trusts
   `membership_changes`. If a credential is changed by hand in the database, signatures made
   offline before the change are recorded under the wrong one.
5. **Card count.** This part alone is 73 cards, and 21 of them are level X. A small
   model can't shorten that third.

## 13. Units and card index

Units own disjoint files and land in this order. L0 lands first, alone, with CI green. The forms
part's units are in `forms.md`; the merged order and the final card numbers are in
`docs/design/phase-4-encounters.md`. Levels are those of `docs/plan/README.md`: **S** small model
alone, **T** tests written first by the planner, **R** reviewer reads the result, **X** strong
model only.

| Unit | Owns | Depends on |
|---|---|---|
| **L0** Schema and core rules | `db/migrations/0018` to `0021`, their `db/test` files, the three vector files of 3.12 and `encounters-done-when.json`, `services/api/src/encounters/{rules,content-hash,signed-under}.ts`, `apps/mobile/lib/encounters/{rules,content_hash}.dart` | the forms part's definition format (for `noteTypeKey` and versions) |
| **L1** Server sync | `services/api/src/sync/**` (changes), `services/api/src/sync/entities/{note-signoff,note-addendum,note-correction,referral}.ts`, `services/api/src/encounters/signer.ts`, `services/api/test/sync-{encounters,signoffs,corrections,referrals}.test.ts` | L0; the forms part's `checkAnswer`, `finishCheck`, `visibleAnswers` |
| **L2** Server routes | `services/api/src/routes/encounters.ts`, `services/api/src/encounters/{read,queues,cosign,attest,assign,incomplete,handoff}.ts`, the timeline in `services/api/src/patients/{charts,projection}.ts`, `services/api/test/encounters-*.test.ts`, the generated contract | L1 |
| **L3** Phone sync layer | `apps/mobile/lib/sync/{entities,local_store}.dart`, `apps/mobile/test/sync/{fake_server,fake_parity_test,fake_reads_test,store_encounters_test}.dart` | L0, L1 (the fake mirrors it) |
| **L4** Phone domain | `apps/mobile/lib/encounters/` (all but the two core files of L0), `apps/mobile/test/encounters/` | L3, the generated client from L2 |
| **L5** Phone screens | `apps/mobile/lib/features/encounters/`, `apps/mobile/test/features/encounters/`, and named edits to `patient_screen.dart`, `home_screen.dart`, `app.dart`, `sync_labels.dart`, `needs_attention_screen.dart` | L4; the forms part's renderer |
| **L6** Portal | `apps/portal/src/app/(app)/encounters/`, `team/{cosign,attestation,incomplete-notes}/`, `apps/portal/src/app/actions/encounters.ts`, `apps/portal/e2e/{encounters,attestation}.spec.ts`, the Timeline on the patient page | L2 |
| **L7** Done when | `apps/mobile/test/encounters/{done_when_test,live_encounters_test}.dart`, `services/api/test/encounters-done-when.test.ts`, the line in `tools/live-sync.sh` | all |

### Cards

One line each: the card, its level, the files it changes, what it needs first. No card changes
more than three source files.

**L0 Schema and core rules**

| Card | Level | Files | Needs |
|---|---|---|---|
| L0-1 Migration 0018: encounter and note columns, the status trigger, the finished-note guard | X | `0018_encounter_lifecycle.sql`, `db/test/encounter-lifecycle.test.ts` | — |
| L0-2 Migration 0019: sign-offs, addenda, corrections | X | `0019_note_signoffs.sql`, `db/test/note-signoffs.test.ts` | L0-1 |
| L0-3 Migration 0020: attestations, assignments, `patient_of_change` | X | `0020_note_attestations.sql`, `db/test/note-attestations.test.ts` | L0-2 |
| L0-4 Migration 0021: referrals, and the chart table row | X | `0021_referrals.sql`, `db/test/referrals.test.ts`, `services/api/src/patients/charts.ts` | L0-1 |
| L0-5 Write the vector files: every row of the tables in 3.1, 3.4, 3.5, 3.6, 3.9, 4.4, 4.5 | X | the three vector files | — |
| L0-6 `rules.ts`: `signoffEffect`, `reopenEffect`, `correctionEffect`, `encounterStatus`, `envelopeLocked`, `isOverdue` | T | `services/api/src/encounters/rules.ts`, `services/api/test/encounter-rules.test.ts` | L0-5 |
| L0-7 `content-hash.ts`: `noteContentHash` | T | `services/api/src/encounters/content-hash.ts` | L0-5 |
| L0-8 `signed-under.ts`: `signedUnder` | T | `services/api/src/encounters/signed-under.ts` | L0-5 |
| L0-9 `rules.dart`, the same functions | T | `apps/mobile/lib/encounters/rules.dart`, `apps/mobile/test/encounters/rules_test.dart` | L0-5 |
| L0-10 `content_hash.dart` | T | `apps/mobile/lib/encounters/content_hash.dart`, `apps/mobile/test/encounters/content_hash_test.dart` | L0-5 |

**L1 Server sync** (all X)

| Card | Files | Needs |
|---|---|---|
| L1-1 The team lock for every encounter-side change; `loadSigner`; the `needsCapability` hook and the Medical gate | `entities/encounter.ts`, `entities/note.ts`, `apply.ts`, `encounters/signer.ts` | L0 |
| L1-2 The encounter: new fields, `status` removed, `kind` rules, the envelope lock, last seen | `records.ts`, `entities/encounter.ts`, `entities/fields.ts` | L1-1 |
| L1-3 The note: create on any encounter, answers checked by `checkAnswer`, `MAX_NOTE_FIELDS` raised to 1,000, late changes kept, reopen | `records.ts`, `entities/note.ts`, `entities/fields.ts` | L1-2, forms |
| L1-4 `note_signoff` | `entities/note-signoff.ts`, `entities/index.ts`, `entities/values.ts` | L1-3 |
| L1-5 `note_addendum` and `note_correction` | `entities/note-addendum.ts`, `entities/note-correction.ts`, `entities/index.ts` | L1-4 |
| L1-6 `referral` | `entities/referral.ts`, `entities/index.ts`, `entities/values.ts` | L1-1 |
| L1-7 Sensitive content: `/v1/sync/records` filters by `visibleAnswers`; a set to a hidden answer is held | `routes/sync.ts`, `sync/review.ts`, `entities/note.ts` | L1-3, forms |
| L1-8 The problem create's `encounterId` and `source` | `entities/problem.ts`, `entities/values.ts` | L1-1 |
| L1-9 Regenerate the contract and `sync-values.json` | generated files | L1-1 to L1-8 |

**L2 Server routes**

| Card | Level | Files | Needs |
|---|---|---|---|
| L2-1 Read a visit | T | `routes/encounters.ts`, `encounters/read.ts`, `test/encounters-read.test.ts` | L1 |
| L2-2 The timeline in the chart answer | R | `patients/charts.ts`, `patients/projection.ts`, `test/patients-charts.test.ts` | L1 |
| L2-3 Co-sign | T | `routes/encounters.ts`, `encounters/cosign.ts`, `test/encounters-cosign.test.ts` | L2-1 |
| L2-4 The two queues | T | `routes/encounters.ts`, `encounters/queues.ts`, `test/encounters-queues.test.ts` | L2-1 |
| L2-5 Attest | T | `routes/encounters.ts`, `encounters/attest.ts`, `test/encounters-attest.test.ts` | L2-4 |
| L2-6 Assign a note | T | `routes/encounters.ts`, `encounters/assign.ts`, `test/encounters-assign.test.ts` | L2-1 |
| L2-7 Notes to finish, and the team's incomplete notes | T | `routes/encounters.ts`, `encounters/incomplete.ts`, `test/encounters-incomplete.test.ts` | L2-1 |
| L2-8 The EMS handoff PDF | R | `routes/encounters.ts`, `encounters/handoff.ts`, `test/encounters-handoff.test.ts` | L2-1, forms |
| L2-9 A row in the permissions test for each new route | R | `test/permissions.test.ts` | L2-1 to L2-8 |
| L2-10 Mount the routes; regenerate the contract | S | `app.ts`, generated files | L2-1 to L2-8 |
| L2-11 Seed made-up visits for the preview | S | `db/seed/demo-encounters.ts`, `db/seed/seed.ts` | L1 |

**L3 Phone sync layer** (all X)

| Card | Files | Needs |
|---|---|---|
| L3-1 The registry: changed and new entities | `lib/sync/entities.dart` | L1 |
| L3-2 The store: `finishNotes`, the lock by effect, receipts settle the effect, the clock guard | `lib/sync/local_store.dart`, `test/sync/store_encounters_test.dart` | L3-1 |
| L3-3 The fake: rules 1 to 6 and 13 of 4.9 | `test/sync/fake_server.dart` | L3-1 |
| L3-4 The fake: rules 7 to 12 and 14 | `test/sync/fake_server.dart` | L3-3 |
| L3-5 A parity case for each of the fourteen rules | `test/sync/fake_parity_test.dart`, `test/sync/fake_reads_test.dart` | L3-4 |

**L4 Phone domain**

| Card | Level | Files | Needs |
|---|---|---|---|
| L4-1 Models, and reading a visit from the store with its read logged | T | `encounter_models.dart`, `encounter_repository.dart`, `test/encounters/visit_read_test.dart` | L3 |
| L4-2 Start an encounter, add a note, switch kind | T | `encounter_repository.dart`, `test/encounters/start_test.dart` | L4-1 |
| L4-3 Complete: the hard stops, then `finishNotes` | T | `encounter_repository.dart`, `test/encounters/complete_test.dart` | L4-2, forms |
| L4-4 Reopen, addendum, correction | T | `note_actions.dart`, `test/encounters/note_actions_test.dart` | L4-3 |
| L4-5 Referrals | T | `referrals.dart`, `test/encounters/referrals_test.dart` | L3 |
| L4-6 Notes to finish: the phone's drafts merged with the server's list | T | `notes_to_finish.dart`, `test/encounters/notes_to_finish_test.dart` | L4-1 |
| L4-7 Online: the queues, co-sign, attest | T | `encounter_api.dart`, `test/encounters/encounter_api_test.dart` | L2 |
| L4-8 The timeline: the chart's list merged with unconfirmed visits | T | `timeline.dart`, `test/encounters/timeline_test.dart` | L4-1 |
| L4-9 Problems made or changed in an encounter carry its ID | R | `lib/patients/problems.dart`, `test/patients/problems_test.dart` | L1-8 |
| L4-10 Close a finished note once its sign-off is confirmed | T | `encounter_providers.dart`, `test/encounters/close_after_confirm_test.dart` | L4-3 |

**L5 Phone screens** (paths under `apps/mobile/lib/features/encounters/` unless named)

| Card | Level | Files | Needs |
|---|---|---|---|
| L5-1 The labels file | S | `encounter_labels.dart` | — |
| L5-2 Start, and the new encounter steps | R | `start_sheet.dart`, `new_encounter_screen.dart`, `lib/app.dart` | L4-2 |
| L5-3 Medical or Non-Medical, and the switch | R | `kind_screen.dart` | L5-2 |
| L5-4 The encounter screen and the note type list | R | `encounter_screen.dart`, `note_type_list.dart` | L5-3, forms |
| L5-5 The frame around a note's form | R | `note_screen.dart` | L5-4, forms |
| L5-6 The summary, and Complete | R | `summary_screen.dart` | L5-5, L4-3 |
| L5-7 The visit read view | R | `visit_screen.dart`, `note_read_view.dart` | L4-1, forms |
| L5-8 The correction sheet and the addendum sheet | R | `correction_sheet.dart`, `addendum_sheet.dart` | L5-7, L4-4 |
| L5-9 The EMS handoff page | R | `handoff_screen.dart` | L5-5, forms |
| L5-10 Home: Notes to finish | R | `notes_to_finish_screen.dart`, `lib/features/home/home_screen.dart` | L4-6 |
| L5-11 Home: the queues, with Co-sign and Attest | R | `queue_screen.dart`, `lib/features/home/home_screen.dart` | L4-7, L5-7 |
| L5-12 The referrals sheet | R | `referrals_sheet.dart` | L4-5 |
| L5-13 The profile: + Encounter, + Referral and the timeline | R | `timeline_section.dart`, `lib/features/patients/patient_screen.dart` | L4-8, L5-12 |
| L5-14 Needs attention: the new sentences and the two buttons | R | `lib/features/sync/sync_labels.dart`, `lib/features/sync/needs_attention_screen.dart` | L3 |
| L5-15 Use my location | R | `location_field.dart`, `apps/mobile/pubspec.yaml` | L5-2 |

Each L5 card includes its widget test file under `apps/mobile/test/features/encounters/`.

**L6 Portal** (paths under `apps/portal/src/app/(app)/` unless named)

| Card | Level | Files | Needs |
|---|---|---|---|
| L6-1 The visit page | R | `encounters/[encounterId]/page.tsx`, `encounters/[encounterId]/NoteView.tsx` | L2-1, forms |
| L6-2 The Timeline and the referrals on the patient page | R | `patients/[patientId]/Timeline.tsx`, `patients/[patientId]/page.tsx` | L2-2 |
| L6-3 The two queue pages | R | `team/cosign/page.tsx`, `team/attestation/page.tsx` | L2-4 |
| L6-4 The Co-sign and Attest actions | R | `apps/portal/src/app/actions/encounters.ts`, `encounters/[encounterId]/SignActions.tsx` | L2-3, L2-5 |
| L6-5 Notes not complete, and the Home counts | R | `team/incomplete-notes/page.tsx`, `home/page.tsx` | L2-7 |
| L6-6 The Assign form | R | `encounters/[encounterId]/AssignForm.tsx`, `apps/portal/src/app/actions/encounters.ts` | L2-6 |
| L6-7 The EMS handoff link | S | `encounters/[encounterId]/page.tsx` | L2-8 |
| L6-8 End-to-end tests with axe in three themes, and reflow | R | `apps/portal/e2e/encounters.spec.ts`, `apps/portal/e2e/attestation.spec.ts` | L6-1 to L6-7 |

**L7 Done when**

| Card | Level | Files | Needs |
|---|---|---|---|
| L7-1 The shared steps | X | `packages/contract/test-vectors/encounters-done-when.json` | L0 |
| L7-2 The server half | T | `services/api/test/encounters-done-when.test.ts` | L2 |
| L7-3 The phone against its test server | T | `apps/mobile/test/encounters/done_when_test.dart` | L4 |
| L7-4 The phone against the real API | X | `apps/mobile/test/encounters/live_encounters_test.dart`, `tools/live-sync.sh` | L7-3 |
| L7-5 The story on the screens | R | `apps/mobile/test/features/encounters/done_when_flow_test.dart` | L5 |

Counts for this part: 73 cards. X: 21. T: 22. R: 26. S: 4.

## What this part needs from the forms part

The lifecycle treats a note's answers as data it does not understand. It needs these from
`packages/forms` and its generated Dart and TypeScript, each a pure function with no database or
network in it:

| Needed | Used by |
|---|---|
| A registry of note types: for each key and version, the kinds it is offered for (`medical`, `non_medical`), its `sensitivity`, and its sections with `sensitiveExam` | 3.10, 4.3, 4.4, 6.4, 9.4 |
| `checkAnswer(definition, path, value)`: null, or the problem with an answer (an unknown path, a wrong type, an unknown option, out of range) | 4.4, 4.7 |
| `finishCheck(definition, answers)`: the list of what stops Complete (a required answer, consent for a sensitive exam, a contradictory disposition), each with the section it is in | 3.3, 3.4, 4.6, 9.6 |
| `visibleAnswers(definition, answers, reader)`: the answers a reader may see | 5.1, 6.4 |
| `recapLines(definition, answers)`: one line per section, nothing from a sensitive exam | 8.1 |
| `handoffLines(definition, answers)`: the EMS handoff summary | 5.7, 9.8 |
| Suggestion rules: an answer that suggests a note type | 9.6 |
| A problem-search field kind that stores the code, the label and the status tapped | 8.3 |
| The form widget for a draft note, and the read widget that shows a corrected answer with the old value struck through | 9.5, 9.7 |
| Stable answer paths: a path means the same field in every version of a note type, and a note keeps the version it was written on | 2.6, 4.5, 8.1 |

`finishCheck`, `visibleAnswers` and `checkAnswer` run on the server and on the phone, so each
needs a shared vector file, as the functions of 3.12 have.
