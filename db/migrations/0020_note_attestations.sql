-- Module 4: attestations and assignments (phase 4 design, lifecycle 2.4). Both are what a second
-- person does to a note, online only, so the server makes the ID and the time. Both are append-only.

set search_path = sineobex, public, extensions;

-- "Attesting adds a dated statement below the note and doesn't change it." One row per
-- attestation: a note corrected after it was attested gets a second row when it is attested again.
create table sineobex.note_attestations (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references sineobex.teams (id),
  note_id            uuid not null,
  signoff_id         uuid not null,                   -- the signature attested
  content_hash       text not null check (content_hash ~ '^[0-9a-f]{64}$'),   -- the note as the attending read it
  attending_user_id  uuid not null references sineobex.users (id),
  attending_name     text not null,                   -- name, NPI and license as they were then
  attending_npi      text not null,                   -- the billing export needs it
  attending_fields   jsonb not null default '{}' check (jsonb_typeof(attending_fields) = 'object'),
  statement_version  text not null,                   -- which wording the attending was shown
  attested_at        timestamptz not null default now(),
  foreign key (team_id, note_id) references sineobex.encounter_notes (team_id, id),
  foreign key (team_id, signoff_id) references sineobex.note_signoffs (team_id, id)
);
create index note_attestations_note on sineobex.note_attestations (team_id, note_id, attested_at);
create trigger note_attestations_append_only before update or delete on sineobex.note_attestations
  for each row execute function sineobex.forbid_mutation();

-- Who a Program Admin put in a departed author's place, and why. The current assignee is
-- encounter_notes.assigned_user_id; these rows are how it came to be.
create table sineobex.note_assignments (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references sineobex.teams (id),
  note_id       uuid not null,
  from_user_id  uuid not null references sineobex.users (id),   -- who acted as the author until now
  to_user_id    uuid not null references sineobex.users (id),
  assigned_by   uuid not null references sineobex.users (id),
  reason        text not null check (length(btrim(reason)) between 3 and 500),
  assigned_at   timestamptz not null default now(),
  foreign key (team_id, note_id) references sineobex.encounter_notes (team_id, id)
);
create trigger note_assignments_append_only before update or delete on sineobex.note_assignments
  for each row execute function sineobex.forbid_mutation();

-- The body of 0009 with the entities phase 4 adds, so the review queue can still name the patient
-- of a held change. A sign-off and a correction name their note, an addendum its visit; a referral
-- is a row with a patient, like an allergy. The referrals table arrives in 0021; PL/pgSQL resolves
-- it when it runs.
create or replace function sineobex.patient_of_change(p_entity text, p_record uuid, p_value jsonb) returns uuid
language plpgsql stable as $$
declare
  v_patient uuid;
  v_problem uuid;
  v_note uuid;
  v_encounter uuid;
begin
  if p_entity = 'patient' then
    return p_record;
  elsif p_entity = 'patient_alias' then
    select a.patient_id into v_patient from sineobex.patient_aliases a where a.id = p_record;
  elsif p_entity = 'patient_allergy' then
    select a.patient_id into v_patient from sineobex.patient_allergies a where a.id = p_record;
  elsif p_entity = 'patient_consent' then
    select c.patient_id into v_patient from sineobex.patient_consents c where c.id = p_record;
  elsif p_entity = 'problem' then
    select pr.patient_id into v_patient from sineobex.problems pr where pr.id = p_record;
  elsif p_entity = 'id_link' then
    select l.patient_id into v_patient from sineobex.patient_id_links l where l.id = p_record;
  elsif p_entity = 'referral' then
    select r.patient_id into v_patient from sineobex.referrals r where r.id = p_record;
  elsif p_entity = 'problem_note' then
    v_problem := coalesce(
      (select n.problem_id from sineobex.problem_notes n where n.id = p_record),
      sineobex.as_uuid(p_value ->> 'problemId'));
    return coalesce(
      (select pr.patient_id from sineobex.problems pr where pr.id = v_problem),
      (select sineobex.as_uuid(c.value ->> 'patientId') from sineobex.quarantine_items c
       where c.entity = 'problem' and c.op = 'create' and c.record_id = v_problem
       order by c.received_at desc limit 1));
  elsif p_entity in ('encounter', 'encounter_note', 'note_signoff', 'note_correction', 'note_addendum') then
    if p_entity = 'encounter' then
      v_encounter := p_record;
    elsif p_entity = 'note_addendum' then
      v_encounter := sineobex.as_uuid(p_value ->> 'encounterId');
    else
      v_note := case when p_entity = 'encounter_note' then p_record
                     else sineobex.as_uuid(p_value ->> 'noteId') end;
      v_encounter := coalesce(
        (select n.encounter_id from sineobex.encounter_notes n where n.id = v_note),
        (select sineobex.as_uuid(c.value ->> 'encounterId') from sineobex.quarantine_items c
         where c.entity = 'encounter_note' and c.op = 'create' and c.record_id = v_note
         order by c.received_at desc limit 1));
    end if;
    v_patient := coalesce(
      (select e.patient_id from sineobex.encounters e where e.id = v_encounter),
      (select sineobex.as_uuid(c.value ->> 'patientId') from sineobex.quarantine_items c
       where c.entity = 'encounter' and c.op = 'create' and c.record_id = v_encounter
       order by c.received_at desc limit 1));
  end if;
  -- A scalar value (a set) has no keys; ->> answers null rather than failing.
  return coalesce(v_patient, sineobex.as_uuid(p_value ->> 'patientId'));
end $$;

-- Row-level security, second line.
do $$
declare t text;
begin
  foreach t in array array['note_attestations', 'note_assignments'] loop
    execute format('alter table sineobex.%I enable row level security', t);
    execute format(
      'create policy %I on sineobex.%I using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope()) '
      'with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope())',
      t || '_team', t);
  end loop;
end $$;

revoke update, delete on sineobex.note_attestations, sineobex.note_assignments from sineobex_app;
