-- Module 4: the life of a note and of its encounter (phase 4 design, lifecycle 2.2). The database
-- works out an encounter's status from its notes, and holds the rule that a finished note's answers
-- change only through a correction.

set search_path = sineobex, public, extensions;

alter table sineobex.encounters
  add column summary        text check (length(summary) between 1 and 4000),         -- the free-text assessment
  add column location_text  text check (length(location_text) between 1 and 200);    -- the place, entered by hand

alter table sineobex.encounter_notes
  -- From the note's type when the note is made, never changed. Rows from phase 2 are Non-Medical.
  add column medical           boolean not null default false,
  add column completed_at      timestamptz,                           -- when it last left draft; clock-corrected device time
  add column completed_by      uuid references sineobex.users (id),
  add column first_signed_at   timestamptz,                           -- set once: a note that was ever signed is never reopened
  add column signoff_id        uuid,                                  -- the sign-off that makes it signed now (foreign key in 0019)
  add column attestation       text not null default 'not_needed'
                                 check (attestation in ('not_needed', 'waiting', 'attested')),
  -- The clinician a Program Admin put in the author's place. Null: the author acts.
  add column assigned_user_id  uuid references sineobex.users (id),
  -- Composite foreign keys from sign-offs, addenda and corrections to their note.
  add constraint encounter_notes_team_id_key unique (team_id, id);

-- Phase 2 let a phone mark a note completed and recorded nothing more: the last change and the
-- author are the nearest facts. The touch trigger is off for this one statement, so the row's own
-- time of last change stays what it was.
alter table sineobex.encounter_notes disable trigger encounter_notes_touch;
update sineobex.encounter_notes set completed_at = updated_at, completed_by = author_user_id
where status = 'completed';
alter table sineobex.encounter_notes enable trigger encounter_notes_touch;

-- NOT VALID, as 0013: phase 2 preview rows stay as they are (one marked signed by hand has no
-- signer), and every new or changed row is checked.
alter table sineobex.encounter_notes
  add constraint encounter_notes_completed_at_when_finished
    check ((status = 'draft') = (completed_at is null)) not valid,
  add constraint encounter_notes_completed_by_with_at
    check ((completed_at is null) = (completed_by is null)) not valid,
  add constraint encounter_notes_attestation_when_signed
    check (status = 'signed' or attestation = 'not_needed') not valid,
  add constraint encounter_notes_signed_has_first_signed
    check (first_signed_at is not null or status <> 'signed') not valid,
  -- Non-Medical work has no signing or co-signing.
  add constraint encounter_notes_signed_is_medical
    check (medical or status <> 'signed') not valid;

-- An empty draft does not count: a note type picked by mistake, or the Red flags note nobody has
-- answered yet. The API and the phone have the same rule (noteIsEmpty, pinned by shared vectors).
create function sineobex.note_is_empty(p_data jsonb) returns boolean
language sql immutable as $$
  select not exists (
    select 1 from jsonb_each(p_data) e
    where e.value not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb))
$$;

-- Of the notes that count: draft while there is none or any is a draft; completed while a Medical
-- note waits for a co-signer; signed once a note is signed and none waits; completed when only
-- finished Non-Medical notes are left.
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

-- A trigger and not API code: a sign-off, a reopen, an online co-sign and a correction all change
-- a note's status, and a fifth path would forget the encounter. It writes only when the status
-- moves, so charting in a draft does not touch the encounter row.
create function sineobex.refresh_encounter_status() returns trigger
language plpgsql as $$
begin
  update sineobex.encounters e set status = sineobex.encounter_status(new.encounter_id)
  where e.id = new.encounter_id and e.status is distinct from sineobex.encounter_status(new.encounter_id);
  return null;
end $$;

-- On data as well as status: the first answer makes an empty draft count.
create trigger encounter_notes_status after insert or update of status, data on sineobex.encounter_notes
  for each row execute function sineobex.refresh_encounter_status();

-- The correction code names the one note it corrects in app.note_correction, for its own
-- transaction. The error is class 23 on purpose: sync stores a class 23 error as a rejection
-- (server_constraint), and any other class would stop the phone's queue (D42).
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

-- The attestation queue and the co-sign queue.
create index encounter_notes_waiting on sineobex.encounter_notes (team_id, updated_at)
  where attestation = 'waiting';
create index encounter_notes_cosign on sineobex.encounter_notes (team_id, completed_at)
  where status = 'completed' and medical;
