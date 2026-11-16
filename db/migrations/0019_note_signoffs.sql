-- Module 4: sign-offs, addenda and corrections (phase 4 design, lifecycle 2.3). A finished note
-- never changes: what happens to it afterwards is a row in one of these three append-only tables.

set search_path = sineobex, public, extensions;

-- One row each time someone finishes or signs a note. The signer's name, credential and NPI are
-- stored here, as they were: the billing export needs them, and a signed note keeps the
-- credential it was signed under whatever the membership says later.
create table sineobex.note_signoffs (
  id                  uuid primary key,               -- made on the phone; by the server for an online co-sign
  team_id             uuid not null references sineobex.teams (id),
  note_id             uuid not null,
  act                 text not null check (act in ('complete', 'sign', 'cosign')),   -- what the person asked for
  effect              text not null                   -- what the server did
                        check (effect in ('signed', 'completed', 'saved_unsigned', 'none')),
  content_hash        text not null check (content_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 of what the person saw
  signer_user_id      uuid not null references sineobex.users (id),
  signer_name         text not null,
  -- The credential the server recorded the act under; it may differ from what the phone claimed.
  signer_credential   text not null
                        check (signer_credential in ('attending', 'resident', 'np', 'pa', 'student', 'chw', 'none')),
  signer_npi          text,                           -- null when that credential has none
  signer_fields       jsonb not null default '{}' check (jsonb_typeof(signer_fields) = 'object'),
  -- What the phone's saved profile said. Null for an online co-sign and for a plain complete.
  claimed_credential  text
                        check (claimed_credential in ('attending', 'resident', 'np', 'pa', 'student', 'chw', 'none')),
  needs_attestation   boolean not null,
  statement_version   text not null,                  -- which wording the person was shown
  signed_at           timestamptz not null,           -- clock-corrected device time; server time for an online co-sign
  signed_device_time  timestamptz,                    -- the phone's own time; null online
  clock_verified      boolean not null,
  received_at         timestamptz not null default now(),
  change_id           uuid,                           -- the sync change that carried it; null online
  created_device_id   uuid references sineobex.devices (id),
  approved_by         uuid references sineobex.users (id),   -- the Program Admin who accepted it from quarantine
  constraint note_signoffs_team_id_key unique (team_id, id),
  -- So a note, or an attestation, can only name a sign-off of its own note.
  constraint note_signoffs_team_id_note_id_id_key unique (team_id, note_id, id),
  foreign key (team_id, note_id) references sineobex.encounter_notes (team_id, id)
);
create index note_signoffs_note on sineobex.note_signoffs (team_id, note_id, received_at);
create trigger note_signoffs_append_only before update or delete on sineobex.note_signoffs
  for each row execute function sineobex.forbid_mutation();

-- A note is signed exactly while it names the sign-off that signs it, and that sign-off is one of
-- its own: a signature made on other content never signs it. A correction by someone who cannot
-- sign clears both. The check is NOT VALID, as the checks of 0018: a preview row marked signed by
-- hand names none. The key is valid: every signoff_id is null when it is added.
alter table sineobex.encounter_notes
  add constraint encounter_notes_signoff_fk
    foreign key (team_id, id, signoff_id) references sineobex.note_signoffs (team_id, note_id, id),
  add constraint encounter_notes_signoff_when_signed
    check ((status = 'signed') = (signoff_id is not null)) not valid;

-- A dated entry by its author below a finished note, or below the visit when note_id is null.
create table sineobex.note_addenda (
  id                 uuid primary key,
  team_id            uuid not null references sineobex.teams (id),
  encounter_id       uuid not null,
  note_id            uuid,
  text               text not null check (length(btrim(text)) between 1 and 4000),
  written_at         timestamptz not null,            -- clock-corrected device time
  clock_verified     boolean not null,
  author_user_id     uuid not null references sineobex.users (id),
  author_name        text not null,                   -- name and credential as they were then
  author_credential  text not null
                       check (author_credential in ('attending', 'resident', 'np', 'pa', 'student', 'chw', 'none')),
  created_device_id  uuid references sineobex.devices (id),
  change_id          uuid,
  created_at         timestamptz not null default now(),
  foreign key (team_id, encounter_id) references sineobex.encounters (team_id, id),
  -- Its note is a note of its visit. Unchecked when note_id is null: an addendum to the visit.
  foreign key (team_id, encounter_id, note_id) references sineobex.encounter_notes (team_id, encounter_id, id)
);
create index note_addenda_encounter on sineobex.note_addenda (team_id, encounter_id, written_at);
create trigger note_addenda_append_only before update or delete on sineobex.note_addenda
  for each row execute function sineobex.forbid_mutation();

-- A list of 1 to 10 changes, each an object that names an answer of the note (data.<path>). A
-- function, so that a value of the wrong shape breaks the check (class 23, a stored rejection)
-- and never raises an error of another class, which would stop a phone's queue.
create function sineobex.note_correction_changes_ok(p_changes jsonb) returns boolean
language sql immutable as $$
  select case when jsonb_typeof(p_changes) = 'array' then
    jsonb_array_length(p_changes) between 1 and 10
    and not exists (
      select 1 from jsonb_array_elements(p_changes) c
      where jsonb_typeof(c) is distinct from 'object'
         or jsonb_typeof(c -> 'field') is distinct from 'string'
         or c ->> 'field' not like 'data._%')
  else false end
$$;

-- One correction: one reason, and the answers changed together. Old and new values are also in
-- field_history (kind 'corrected'); this row holds the reason and the outcome. A patient's
-- amendment request (HIPAA 164.526) is the same row, as patient_corrections is for identity fields.
create table sineobex.note_corrections (
  id                    uuid primary key,
  team_id               uuid not null references sineobex.teams (id),
  note_id               uuid not null,
  -- Each { field, oldValue, newValue, historyId }; historyId is null when nothing was written.
  changes               jsonb not null,
  outcome               text not null check (outcome in (
    'corrected',
    'declined',      -- an amendment request refused; the note unchanged
    'no_change',     -- the note already held those values
    'draft_edit',    -- the note was a draft again; the changes went in as edits
    'not_author')),  -- the sender does not act as the note's author; nothing changed
  reason                text not null check (length(btrim(reason)) between 3 and 500),
  requested_by_patient  boolean not null default false,
  corrector_user_id     uuid not null references sineobex.users (id),
  corrector_name        text not null,
  corrector_credential  text not null
                          check (corrector_credential in ('attending', 'resident', 'np', 'pa', 'student', 'chw', 'none')),
  claimed_credential    text
                          check (claimed_credential in ('attending', 'resident', 'np', 'pa', 'student', 'chw', 'none')),
  corrected_at          timestamptz not null,         -- clock-corrected device time
  clock_verified        boolean not null,
  created_device_id     uuid references sineobex.devices (id),
  change_id             uuid,
  created_at            timestamptz not null default now(),
  foreign key (team_id, note_id) references sineobex.encounter_notes (team_id, id),
  constraint note_corrections_changes_shape check (sineobex.note_correction_changes_ok(changes)),
  constraint note_corrections_declined_is_request check (outcome <> 'declined' or requested_by_patient)
);
create index note_corrections_note on sineobex.note_corrections (team_id, note_id, corrected_at);
create trigger note_corrections_append_only before update or delete on sineobex.note_corrections
  for each row execute function sineobex.forbid_mutation();

-- Row-level security, second line.
do $$
declare t text;
begin
  foreach t in array array['note_signoffs', 'note_addenda', 'note_corrections'] loop
    execute format('alter table sineobex.%I enable row level security', t);
    execute format(
      'create policy %I on sineobex.%I using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope()) '
      'with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope())',
      t || '_team', t);
  end loop;
end $$;

revoke update, delete on sineobex.note_signoffs, sineobex.note_addenda, sineobex.note_corrections from sineobex_app;
