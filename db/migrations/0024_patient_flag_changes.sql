-- Module 2 and 5: a patient's flags (phase 5 design 4.5, 6.2). A flag is never a value on the
-- patient two phones could overwrite: each set or clear is a change of its own, made on the phone or
-- in the portal, created once and never changed but by one mark, entered in error, and the current
-- flags are worked out from the changes (design 5.3).
--
-- PLAN-OPEN (PL-16): is flagging patients built in phase 5? Yes: setting flags is stage 11, which the
-- build plan puts in phase 9, and it moves here, since phase 7 ranks patients by both tiers and a
-- flag nobody can set is shown to no one.

set search_path = sineobex, public, extensions;

-- The shape of a referral (0021): made on the phone, or by the portal page once per form, and never
-- overwritten. A merge moves nothing: a change keeps the patient it was stored with, and a chart
-- reads its group's (D27).
create table sineobex.patient_flag_changes (
  id                uuid primary key,
  team_id           uuid not null references sineobex.teams (id),
  patient_id        uuid not null,
  -- A preset of the team. That it is a flag is the sync rule's check, made before the insert, so this
  -- key never throws inside a push (design 6.2).
  flag_id           uuid not null,
  action            text not null check (action in ('set', 'clear')),
  -- Patient detail: never in audit details, logs or notices. Counted in code points, as the phone
  -- counts it (sync-values.json).
  reason            text not null check (length(btrim(reason)) between 1 and 500),
  -- PLAN-OPEN (PL-24): which time orders a patient's flag changes? The change's own time (corrected
  -- when the clock is verified, else the phone's), never later than the server received it, as a
  -- patient's last seen (D90); set by the server. The flags fold in this order, then by id.
  effective_at      timestamptz not null,
  device_time       timestamptz,                    -- the phone's own time; null from the portal
  clock_verified    boolean not null default false,
  author_user_id    uuid not null references sineobex.users (id),
  created_device_id uuid references sineobex.devices (id),   -- null from the portal
  change_id         uuid,                           -- the sync change that carried it; null from the portal
  approved_by       uuid references sineobex.users (id),     -- the Program Admin who accepted it from review
  status            text not null default 'active' check (status in ('active', 'entered_in_error')),
  error_reason      text check (error_reason is null or length(btrim(error_reason)) between 3 and 300),
  error_by          uuid references sineobex.users (id),
  error_at          timestamptz,
  -- The bookkeeping of a record with one field a phone may set, enteredInError, as on referrals.
  version           integer not null default 1,
  field_versions    jsonb not null default '{}',
  field_meta        jsonb not null default '{}',
  received_at       timestamptz not null default now(),   -- server receipt
  updated_at        timestamptz not null default now(),
  constraint patient_flag_changes_team_id_key unique (team_id, id),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  -- Composite, as every key to a preset is (0023): a change names only a flag of its own team.
  foreign key (team_id, flag_id) references sineobex.team_presets (team_id, id),
  -- Why, who and when go with the mark, all three or none.
  constraint patient_flag_changes_error_with_status check (
    num_nulls(error_reason, error_by, error_at) = case when status = 'entered_in_error' then 0 else 3 end),
  -- A phone whose clock runs ahead never dates a change after its receipt (PL-24).
  constraint patient_flag_changes_not_after_receipt check (effective_at <= received_at)
);
-- A chart folds its group's changes in order.
create index patient_flag_changes_patient on sineobex.patient_flag_changes (team_id, patient_id, effective_at, id);
create trigger patient_flag_changes_touch before update on sineobex.patient_flag_changes
  for each row execute function sineobex.touch_updated_at();

-- PLAN-OPEN (PL-18): what happens to a flag change made on the wrong patient? It is marked entered in
-- error, once, with a reason, and stays: who, when and why go with the mark, and it drops out of the
-- current flags.
--
-- The sync rule answers a second mark (set_once, design 6.2); this holds it for every writer, the
-- owner too. The one update a change takes is its mark: from active to entered in error, with why,
-- who and when, and its bookkeeping, the version one step on. Every other column stays as it was
-- written, a column a later migration adds included until that migration says otherwise; the touch
-- trigger keeps the time of last change. The error is class 23, as 0018's guards, so a push stores it
-- as a rejection and its queue goes on (D42). Each refusal names its own constraint.
create function sineobex.guard_flag_change() returns trigger
language plpgsql as $$
declare
  v_kept text;
begin
  if old.status = 'entered_in_error' then
    raise exception 'a flag change is marked entered in error once'
      using errcode = 'check_violation', constraint = 'patient_flag_changes_marked_once';
  end if;
  select n.key into v_kept from jsonb_each(to_jsonb(new)) n
  where n.key <> all (array['status', 'error_reason', 'error_by', 'error_at', 'version', 'field_versions',
                            'field_meta', 'updated_at'])
    and n.value is distinct from to_jsonb(old) -> n.key
  order by n.key limit 1;
  if v_kept is not null then
    raise exception 'a flag change keeps its %', v_kept
      using errcode = 'check_violation', constraint = 'patient_flag_changes_keeps_' || v_kept;
  end if;
  if new.status is distinct from 'entered_in_error' then
    raise exception 'a flag change changes only by its mark'
      using errcode = 'check_violation', constraint = 'patient_flag_changes_only_the_mark';
  end if;
  if new.version is distinct from old.version + 1 then
    raise exception 'the mark moves a flag change''s version one step'
      using errcode = 'check_violation', constraint = 'patient_flag_changes_mark_version';
  end if;
  return new;
end $$;

create trigger patient_flag_changes_one_mark before update on sineobex.patient_flag_changes
  for each row execute function sineobex.guard_flag_change();

-- The team index carries each patient's flags (design 6.1), so every change moves its version.
create trigger patient_flag_changes_index_insert after insert on sineobex.patient_flag_changes
  referencing new table as changed for each statement execute function sineobex.bump_team_index();
create trigger patient_flag_changes_index_update after update on sineobex.patient_flag_changes
  referencing new table as changed for each statement execute function sineobex.bump_team_index();

-- Row-level security, second line.
alter table sineobex.patient_flag_changes enable row level security;
create policy patient_flag_changes_team on sineobex.patient_flag_changes
  using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope())
  with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope());

-- A mistake is marked entered in error and stays in the history.
revoke delete on sineobex.patient_flag_changes from sineobex_app;

-- A notice names the patient a held change was about, as 0022's names a note: a held flag change
-- that will not reach the chart tells its sender (flag_change_not_applied, design 6.2), and the
-- change waits in quarantine_items, in no sync read, so the notice names its patient. The API names
-- one only after reading it on the chart. Composite on (team_id, patient_id): a foreign key check
-- ignores row-level security, so a notice never names another team's patient. It blocks nothing: a
-- patient is never deleted (0009). Valid at once: no row written before names a patient. No index:
-- nothing reads notices by their patient.
alter table sineobex.user_notices
  add column patient_id uuid,
  add foreign key (team_id, patient_id) references sineobex.patients (team_id, id);

-- The body of 0020 with the flag change, so the review queue can name the patient of a held one. A
-- change is a row with a patient, like an allergy or a referral, and falls back to its held create:
-- a create names its patient in its value, but an Entered in error mark's value is a reason and no
-- patient.
create or replace function sineobex.patient_of_change(p_entity text, p_record uuid, p_value jsonb) returns uuid
language plpgsql stable as $$
declare
  v_patient uuid;
  v_problem uuid;
  v_note uuid;
  v_encounter uuid;
  v_held_create text;
begin
  if p_entity = 'patient' then
    return p_record;
  elsif p_entity = 'patient_alias' then
    select a.patient_id into v_patient from sineobex.patient_aliases a where a.id = p_record;
  elsif p_entity = 'patient_allergy' then
    select a.patient_id into v_patient from sineobex.patient_allergies a where a.id = p_record;
    v_held_create := 'patient_allergy';
  elsif p_entity = 'patient_consent' then
    select c.patient_id into v_patient from sineobex.patient_consents c where c.id = p_record;
  elsif p_entity = 'problem' then
    select pr.patient_id into v_patient from sineobex.problems pr where pr.id = p_record;
  elsif p_entity = 'id_link' then
    select l.patient_id into v_patient from sineobex.patient_id_links l where l.id = p_record;
  elsif p_entity = 'referral' then
    select r.patient_id into v_patient from sineobex.referrals r where r.id = p_record;
    v_held_create := 'referral';
  elsif p_entity = 'patient_flag_change' then
    select f.patient_id into v_patient from sineobex.patient_flag_changes f where f.id = p_record;
    v_held_create := 'patient_flag_change';
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
  -- An allergy, a referral or a flag change marked entered in error while its create is held too:
  -- the mark's value is a reason and no patient, so the held create names it. After the value's own
  -- patient, so every answer the function gave before stays the same.
  if v_held_create is not null and v_patient is null and sineobex.as_uuid(p_value ->> 'patientId') is null then
    select sineobex.as_uuid(c.value ->> 'patientId') into v_patient from sineobex.quarantine_items c
    where c.entity = v_held_create and c.op = 'create' and c.record_id = p_record
    order by c.received_at desc limit 1;
  end if;
  -- A scalar value (a set) has no keys; ->> answers null rather than failing.
  return coalesce(v_patient, sineobex.as_uuid(p_value ->> 'patientId'));
end $$;

-- 0009's line comment on the column says a later phase adds the flag table and its key; a merged
-- migration is never edited, so this says what is true now (design 12.2).
comment on column sineobex.patients.priority_flag_key is
  'Unused. A patient''s flags are worked out from their flag changes (patient_flag_changes; 0024).';
