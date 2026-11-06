-- Module 2: patients, their street names, allergies and consent; search keys; field reviews and
-- corrections; the team index version; ranked candidate retrieval for search and duplicate matching.
--
-- Patients are never deleted. A merge moves nothing: every row keeps the patient ID it was stored
-- with and reads group by patients.canonical_id (phase 3 design, section 0.2). Every patient-side
-- foreign key is composite on (team_id, ...), so even a buggy handler can't point a row at another
-- team's patient: a foreign-key check runs as the table owner and ignores row-level security.
-- Records a phone can change carry the encounters' bookkeeping (field_versions, field_meta, version).

set search_path = sineobex, public, extensions;

-- Composite foreign keys from patient-side rows to encounters (phase 4 fills encounter_id columns).
alter table sineobex.encounters add constraint encounters_team_id_key unique (team_id, id);

-- A UUID from text that may not be one (values held for review were never schema-checked).
create function sineobex.as_uuid(p_text text) returns uuid
language sql immutable parallel safe as $$
  select case when p_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then p_text::uuid end
$$;

-- Double Metaphone codes (primary and alternate) of each token of a normalized name, tokens of 2+
-- characters. Immutable so triggers can store it; own search_path because fuzzystrmatch lives in
-- `sineobex` on RDS and `extensions` on Supabase (the normalize_name pattern, 0001).
create function sineobex.name_codes(p_norm text) returns text[]
language sql immutable parallel safe
set search_path = sineobex, public, extensions as $$
  select coalesce(array_agg(distinct c order by c) filter (where c is not null and c <> ''), '{}')
  from unnest(string_to_array(coalesce(p_norm, ''), ' ')) as t(tok),
       lateral (values (dmetaphone(t.tok)), (dmetaphone_alt(t.tok))) as v(c)
  where length(t.tok) >= 2
$$;

create table sineobex.patients (
  id                     uuid primary key,                       -- made on the phone (v4)
  team_id                uuid not null references sineobex.teams (id),
  status                 text not null default 'active' check (status in ('active', 'merged')),
  merged_into            uuid,                                   -- the direct survivor
  canonical_id           uuid not null,                          -- end of the merge chain; itself when active
  preferred_name         text check (preferred_name is null or length(btrim(preferred_name)) between 1 and 80),
  legal_given_name       text check (legal_given_name is null or length(btrim(legal_given_name)) between 1 and 80),
  legal_family_name      text check (legal_family_name is null or length(btrim(legal_family_name)) between 1 and 80),
  visual_descriptor      text check (visual_descriptor is null or length(btrim(visual_descriptor)) between 1 and 200),
  -- Sync field `birth` = {precision, date?, year?}. Null precision: unknown.
  birth_precision        text check (birth_precision in ('day', 'year', 'estimated')),
  birth_date             date check (birth_date >= date '1900-01-01'),
  birth_year             smallint,
  -- Sync field `livingSituation` = {kind, other?}.
  living_situation       text check (living_situation in ('unsheltered', 'vehicle', 'emergency_shelter',
                           'transitional_housing', 'couch_surfing', 'hotel_motel', 'housed', 'institution',
                           'unknown', 'other')),
  living_situation_other text check (living_situation_other is null or length(btrim(living_situation_other)) between 1 and 200),
  usual_area             text check (usual_area is null or length(btrim(usual_area)) between 1 and 200),
  preferred_language     text check (preferred_language is null or preferred_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  allergy_screen         text not null default 'not_asked' check (allergy_screen in ('not_asked', 'none_known')),
  id_card_choice         text not null default 'not_asked' check (id_card_choice in ('not_asked', 'wants', 'declined')),
  profile_photo_id       uuid,          -- phase 8 adds patient_photos and the FK
  priority_flag_key      text,          -- phase 5 adds the team flag table and the FK
  last_seen_at           timestamptz,   -- intake sets it; phase 4 encounters and phase 9 check-ins move it
  registered_at          timestamptz not null,  -- clock-corrected device time of the intake
  clock_verified         boolean not null default false,
  author_user_id         uuid not null references sineobex.users (id),
  created_device_id      uuid references sineobex.devices (id),
  field_versions         jsonb not null default '{}',
  field_meta             jsonb not null default '{}',
  version                integer not null default 1,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (team_id, id),
  foreign key (team_id, merged_into) references sineobex.patients (team_id, id),
  foreign key (team_id, canonical_id) references sineobex.patients (team_id, id),
  check ((status = 'merged') = (merged_into is not null)),
  check (merged_into is distinct from id),
  check ((status = 'active') = (canonical_id = id)),
  check ((birth_precision is null and birth_date is null and birth_year is null)
      or (birth_precision = 'day' and birth_date is not null and birth_year = extract(year from birth_date))
      or (birth_precision in ('year', 'estimated') and birth_date is null and birth_year between 1900 and 2100)),
  check ((living_situation = 'other') = (living_situation_other is not null)),
  -- Someone must be recognisable: a name or what they look like ("man in blue wheelchair").
  -- Fields sync one by one, so the API checks the row it would leave before every write to one
  -- of these four (`recognisableAfter`); this constraint is the backstop, never the answer.
  constraint patients_recognisable
    check (coalesce(preferred_name, legal_given_name, legal_family_name, visual_descriptor) is not null)
);
create index patients_team_canonical on sineobex.patients (team_id, canonical_id);
create index patients_team_updated on sineobex.patients (team_id, status, updated_at);
create index patients_team_birth_year on sineobex.patients (team_id, birth_year);
create trigger patients_touch before update on sineobex.patients
  for each row execute function sineobex.touch_updated_at();

-- Street names, one row each, so two phones adding aliases offline union. Removal is one-way.
create table sineobex.patient_aliases (
  id                uuid primary key,
  team_id           uuid not null references sineobex.teams (id),
  patient_id        uuid not null,
  alias             text not null check (length(btrim(alias)) between 1 and 60),
  status            text not null default 'active' check (status in ('active', 'removed')),
  removed_reason    text check (removed_reason is null or length(btrim(removed_reason)) between 3 and 300),
  removed_by        uuid references sineobex.users (id),
  removed_at        timestamptz,
  author_user_id    uuid not null references sineobex.users (id),
  created_device_id uuid references sineobex.devices (id),
  field_versions    jsonb not null default '{}',
  field_meta        jsonb not null default '{}',
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  check ((status = 'removed') = (removed_at is not null and removed_reason is not null))
);
create index patient_aliases_patient on sineobex.patient_aliases (team_id, patient_id, status);
create trigger patient_aliases_touch before update on sineobex.patient_aliases
  for each row execute function sineobex.touch_updated_at();

-- Search keys, derived, one row per name-like string. Merged patients keep theirs: search groups
-- by canonical_id, so an alias only the merged record had still finds the survivor.
create table sineobex.patient_name_keys (
  team_id     uuid not null,
  patient_id  uuid not null,
  source      text not null check (source in ('legal', 'preferred', 'alias', 'descriptor')),
  source_id   uuid not null,          -- the patient (legal, preferred, descriptor) or the alias row
  norm        text not null,          -- sineobex.normalize_name(value)
  tokens      text[] not null,        -- string_to_array(norm, ' ')
  dm_codes    text[] not null,        -- name_codes(norm); '{}' for descriptor
  primary key (team_id, patient_id, source, source_id),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id)
);
-- btree_gin (0001) lets each GIN index lead with team_id.
create index patient_name_keys_trgm on sineobex.patient_name_keys using gin (team_id, norm gin_trgm_ops);
create index patient_name_keys_codes on sineobex.patient_name_keys using gin (team_id, dm_codes);
create index patient_name_keys_tokens on sineobex.patient_name_keys using gin (team_id, tokens);

-- One key row, or none when the value normalizes to nothing.
create function sineobex.put_name_key(p_team uuid, p_patient uuid, p_source text, p_source_id uuid, p_value text)
returns void
language plpgsql as $$
declare
  v_norm text := sineobex.normalize_name(p_value);
begin
  if v_norm is null then
    return;
  end if;
  insert into sineobex.patient_name_keys (team_id, patient_id, source, source_id, norm, tokens, dm_codes)
  values (p_team, p_patient, p_source, p_source_id, v_norm, string_to_array(v_norm, ' '),
          case when p_source = 'descriptor' then '{}'::text[] else sineobex.name_codes(v_norm) end);
end $$;

-- The patient's own keys: legal ("given family"), preferred and descriptor.
create function sineobex.patients_name_keys() returns trigger
language plpgsql as $$
begin
  delete from sineobex.patient_name_keys
  where team_id = new.team_id and patient_id = new.id and source in ('legal', 'preferred', 'descriptor');
  perform sineobex.put_name_key(new.team_id, new.id, 'legal', new.id,
    concat_ws(' ', new.legal_given_name, new.legal_family_name));
  perform sineobex.put_name_key(new.team_id, new.id, 'preferred', new.id, new.preferred_name);
  perform sineobex.put_name_key(new.team_id, new.id, 'descriptor', new.id, new.visual_descriptor);
  return null;
end $$;

create trigger patients_name_keys_insert after insert on sineobex.patients
  for each row execute function sineobex.patients_name_keys();
create trigger patients_name_keys_update after update on sineobex.patients
  for each row
  when (old.preferred_name is distinct from new.preferred_name
        or old.legal_given_name is distinct from new.legal_given_name
        or old.legal_family_name is distinct from new.legal_family_name
        or old.visual_descriptor is distinct from new.visual_descriptor)
  execute function sineobex.patients_name_keys();

-- An alias's key; none once it is removed.
create function sineobex.aliases_name_keys() returns trigger
language plpgsql as $$
begin
  delete from sineobex.patient_name_keys
  where team_id = new.team_id and patient_id = new.patient_id and source = 'alias' and source_id = new.id;
  if new.status = 'active' then
    perform sineobex.put_name_key(new.team_id, new.patient_id, 'alias', new.id, new.alias);
  end if;
  return null;
end $$;

create trigger patient_aliases_name_keys_insert after insert on sineobex.patient_aliases
  for each row execute function sineobex.aliases_name_keys();
create trigger patient_aliases_name_keys_update after update on sineobex.patient_aliases
  for each row
  when (old.alias is distinct from new.alias or old.status is distinct from new.status)
  execute function sineobex.aliases_name_keys();

-- Allergies: a union, never overwritten (module 9). The only change is entered in error.
create table sineobex.patient_allergies (
  id                uuid primary key,
  team_id           uuid not null references sineobex.teams (id),
  patient_id        uuid not null,
  substance         text not null check (length(btrim(substance)) between 1 and 120),
  category          text not null default 'unknown' check (category in ('drug', 'food', 'environment', 'other', 'unknown')),
  reaction          text check (reaction is null or length(btrim(reaction)) between 1 and 200),
  severity          text not null default 'unknown' check (severity in ('mild', 'moderate', 'severe', 'unknown')),
  encounter_id      uuid,
  status            text not null default 'active' check (status in ('active', 'entered_in_error')),
  error_reason      text check (error_reason is null or length(btrim(error_reason)) between 3 and 300),
  error_by          uuid references sineobex.users (id),
  error_at          timestamptz,
  recorded_at       timestamptz not null,           -- clock-corrected device time
  author_user_id    uuid not null references sineobex.users (id),
  created_device_id uuid references sineobex.devices (id),
  field_versions    jsonb not null default '{}',
  field_meta        jsonb not null default '{}',
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  foreign key (team_id, encounter_id) references sineobex.encounters (team_id, id),
  check ((status = 'entered_in_error') = (error_reason is not null and error_at is not null))
);
create index patient_allergies_patient on sineobex.patient_allergies (team_id, patient_id, status);
create trigger patient_allergies_touch before update on sineobex.patient_allergies
  for each row execute function sineobex.touch_updated_at();

-- Consent decisions, append-only (design 11.2). A changed decision is a new row.
create table sineobex.patient_consents (
  id             uuid primary key,                  -- phone-made, including the rows a patient create carries
  team_id        uuid not null references sineobex.teams (id),
  patient_id     uuid not null,
  kind           text not null check (kind in ('care_and_record', 'privacy_notice')),
  decision       text not null,
  method         text not null check (method in ('verbal', 'written', 'not_applicable')),
  script_version text not null check (script_version ~ '^[a-z0-9_.-]{1,40}$'),
  language       text not null check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  reason         text check (reason is null or length(btrim(reason)) between 3 and 300),
  recorded_by    uuid not null references sineobex.users (id),
  recorded_at    timestamptz not null,              -- clock-corrected device time
  clock_verified boolean not null,
  device_id      uuid references sineobex.devices (id),
  change_id      uuid,
  created_at     timestamptz not null default now(),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  check ((kind = 'care_and_record' and decision in ('given', 'unable'))
      or (kind = 'privacy_notice' and decision in ('acknowledged', 'declined', 'unable', 'not_offered'))),
  check (decision not in ('unable', 'not_offered') or reason is not null)
);
create index patient_consents_patient on sineobex.patient_consents (team_id, patient_id, kind, recorded_at);
create trigger patient_consents_append_only before update or delete on sineobex.patient_consents
  for each row execute function sineobex.forbid_mutation();

-- "Two edits to the same field keep both values and flag the record for review" (module 9).
-- The competing values are field_history rows (kind 'kept_both') carrying review_id.
create table sineobex.field_reviews (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references sineobex.teams (id),
  patient_id        uuid not null,                  -- the record's patient (canonical when opened)
  entity            text not null check (entity in ('patient')),
  record_id         uuid not null,
  field             text not null,
  needs             text not null check (needs in ('patients.edit', 'patients.correct_identity')),
  status            text not null default 'open' check (status in ('open', 'decided', 'obsolete')),
  opened_at         timestamptz not null default now(),
  opened_by_change  uuid,                           -- null when a merge opened it
  merge_id          uuid,
  decided_at        timestamptz,
  decided_by        uuid references sineobex.users (id),
  decision          jsonb,                          -- {kept: 'current' | 'alternate', historyId}
  comment           text check (comment is null or length(btrim(comment)) between 3 and 500),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  check ((status = 'open') = (decided_at is null))
);
create unique index field_reviews_one_open on sineobex.field_reviews (team_id, entity, record_id, field) where status = 'open';
create index field_reviews_queue on sineobex.field_reviews (team_id, status, needs, opened_at, id);
create index field_reviews_patient on sineobex.field_reviews (team_id, patient_id, status);

alter table sineobex.field_history add column review_id uuid references sineobex.field_reviews (id);
-- Widened only, as 0008 did for quarantine_items_reason_check.
alter table sineobex.field_history drop constraint field_history_kind_check;
alter table sineobex.field_history add constraint field_history_kind_check check (kind in (
  'created', 'set', 'filled_blank', 'replaced_after_review', 'kept_both',
  'confirmed',          -- the same problem status observed again
  'redirected',         -- an edit sent to a merged record, applied to its survivor
  'corrected',          -- an admin identity correction
  'review_decided',     -- an alternate chosen in a field review
  'merge_fill',         -- a survivor blank filled by a merge (reverted by undo)
  'merge_undone',       -- a merge_fill reverted
  'cleared_by_allergy', -- allergyScreen 'none_known' set back to 'not_asked' by an allergy
  'entered_in_error')); -- an allergy, problem or status marked entered in error

-- Every change made "with a reason": identity corrections, declined amendment requests, problem
-- reversals, review decisions on identity fields, merge undo. Old and new values are also in
-- field_history; this row holds the reason. Append-only.
create table sineobex.patient_corrections (
  id                   uuid primary key default gen_random_uuid(),
  team_id              uuid not null references sineobex.teams (id),
  patient_id           uuid not null,
  kind                 text not null check (kind in ('identity', 'amendment_declined', 'problem_reversal',
                         'reversal_declined', 'review_decision', 'merge_undo')),
  entity               text not null,
  record_id            uuid not null,
  field                text,
  old_value            jsonb,
  new_value            jsonb,
  reason               text not null check (length(btrim(reason)) between 3 and 500),
  requested_by_patient boolean not null default false,   -- HIPAA 164.526 amendment request
  history_id           bigint references sineobex.field_history (id),
  decided_by           uuid not null references sineobex.users (id),
  decided_at           timestamptz not null default now(),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id)
);
create index patient_corrections_patient on sineobex.patient_corrections (team_id, patient_id, decided_at);
create trigger patient_corrections_append_only before update or delete on sineobex.patient_corrections
  for each row execute function sineobex.forbid_mutation();

-- Moves whenever anything a team index entry shows changes. Statement-level triggers with a
-- transition table named `changed` (column lists are not allowed with transition tables).
create table sineobex.team_index_versions (
  team_id     uuid primary key references sineobex.teams (id),
  version     bigint not null default 0,
  updated_at  timestamptz not null default now()
);

create function sineobex.bump_team_index() returns trigger
language plpgsql as $$
begin
  insert into sineobex.team_index_versions (team_id, version)
  select distinct team_id, 1 from changed
  on conflict (team_id) do update set version = sineobex.team_index_versions.version + 1, updated_at = now();
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['patients', 'patient_aliases', 'patient_allergies', 'field_reviews'] loop
    execute format(
      'create trigger %I after insert on sineobex.%I referencing new table as changed '
      'for each statement execute function sineobex.bump_team_index()', t || '_index_insert', t);
    execute format(
      'create trigger %I after update on sineobex.%I referencing new table as changed '
      'for each statement execute function sineobex.bump_team_index()', t || '_index_update', t);
  end loop;
end $$;

-- One event may disclose several patients (a search, a match check). Their IDs go in
-- details.patientIds; this lets a patient's access report find them (module 10).
create index audit_events_patient_ids on sineobex.audit_events using gin (team_id, (details -> 'patientIds'));

-- Candidate retrieval for search and duplicate matching (design 5.4). A function so the trigram
-- operators resolve on both hosts and the thresholds are set beside the query. It ranks before it
-- cuts: each branch is limited separately in order of similarity or overlap, groups are ordered by
-- their best name rank, and a birth year only breaks ties. A birth year never retrieves anyone.
create function sineobex.patient_candidates(
  p_norms text[],                 -- normalized query strings (each name, each alias)
  p_tokens text[],                -- query tokens plus their nickname partners
  p_year_lo int, p_year_hi int,   -- the query's birth year range, or nulls: orders ties, never retrieves
  p_sources text[],               -- key sources the caller may search
  p_trgm real, p_word_trgm real,
  p_branch_limit int,             -- per query string (trigrams), and for tokens and codes
  p_limit int)
returns table (canonical_id uuid, name_rank real, year_in_range boolean)
language plpgsql volatile                  -- security invoker: row-level security applies
set search_path = sineobex, public, extensions as $$
#variable_conflict use_column
declare
  v_codes text[];
begin
  perform set_config('pg_trgm.similarity_threshold', p_trgm::text, true);
  perform set_config('pg_trgm.word_similarity_threshold', p_word_trgm::text, true);
  select coalesce(array_agg(distinct c), '{}') into v_codes
    from unnest(p_norms) as q(n), unnest(sineobex.name_codes(q.n)) as c;
  return query
  with trgm as (            -- spelling: the best keys for each query string. The mean of whole-string
                            -- and word similarity: word similarity alone rates "smity" as close to
                            -- "smit abcde" as to "smitty" (0.667 each), and a tie would cut by ID.
    select c.patient_id, c.r from unnest(p_norms) as q(n)
    cross join lateral (
      select k.patient_id, ((similarity(k.norm, q.n) + word_similarity(q.n, k.norm)) / 2)::real as r
      from sineobex.patient_name_keys k
      where k.team_id = sineobex.current_team_id() and k.source = any (p_sources)
        and (k.norm % q.n or q.n <% k.norm)
      order by 2 desc, k.patient_id limit p_branch_limit) c
  ),
  toks as (                 -- a whole token or nickname partner (0.8), else a sound-alike code (0.4),
                            -- plus a fifth of the key's best spelling similarity, so ties break by spelling
    select k.patient_id,
           ((case when k.tokens && p_tokens then 0.8 else 0.4 end)
            + 0.2 * (select max(similarity(k.norm, q.n)) from unnest(p_norms) as q(n)))::real as r
    from sineobex.patient_name_keys k
    where k.team_id = sineobex.current_team_id() and k.source = any (p_sources)
      and k.source <> 'descriptor'
      and (k.tokens && p_tokens or k.dm_codes && v_codes)
    order by 2 desc, k.patient_id limit p_branch_limit
  ),
  ranked as (
    select p.canonical_id as cid, max(h.r)::real as best,
           coalesce(bool_or(p.birth_year between p_year_lo and p_year_hi), false) as in_range
    from (select * from trgm union all select * from toks) h
    join sineobex.patients p on p.team_id = sineobex.current_team_id() and p.id = h.patient_id
    group by p.canonical_id
  )
  select r.cid, r.best, r.in_range from ranked r
  order by r.best desc, r.in_range desc, r.cid
  limit p_limit;
end $$;

-- A search by a full birth date and nothing else (a year alone never searches). Exact dates first,
-- then day and month swapped, then year-only or estimated births within p_range years; bounded.
create function sineobex.patient_candidates_by_birth(p_date date, p_range int, p_limit int)
returns table (canonical_id uuid)
language sql stable                         -- security invoker: row-level security applies
set search_path = sineobex, public, extensions as $$
  with q as (select extract(year from p_date)::int as y,
                    -- day and month swapped, only when the day could be a month (SQL doesn't
                    -- promise to short-circuit an OR, so make_date must never see a day > 12)
                    case when extract(day from p_date) <= 12
                         then make_date(extract(year from p_date)::int, extract(day from p_date)::int,
                                        extract(month from p_date)::int) end as swapped)
  select p.canonical_id from sineobex.patients p, q
  where p.team_id = sineobex.current_team_id()
    and p.birth_year between q.y - p_range and q.y + p_range
    and (p.birth_date = p_date
         or p.birth_date = q.swapped
         or p.birth_date is null)
  group by p.canonical_id
  order by min(case when p.birth_date = p_date then 0 when p.birth_date is not null then 1
                    when p.birth_year = q.y then 2 else 3 end), p.canonical_id
  limit p_limit
$$;

-- The patient a change is about, for the review queue and the hand-over: the record itself, its
-- row's patient, or what the value names; for a note or an encounter, through the encounter (on the
-- chart, or its create held for review). The problem, note and link tables arrive in 0010 to 0012;
-- PL/pgSQL resolves them when it runs.
create function sineobex.patient_of_change(p_entity text, p_record uuid, p_value jsonb) returns uuid
language plpgsql stable as $$
declare
  v_patient uuid;
  v_problem uuid;
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
  elsif p_entity = 'problem_note' then
    v_problem := coalesce(
      (select n.problem_id from sineobex.problem_notes n where n.id = p_record),
      sineobex.as_uuid(p_value ->> 'problemId'));
    return coalesce(
      (select pr.patient_id from sineobex.problems pr where pr.id = v_problem),
      (select sineobex.as_uuid(c.value ->> 'patientId') from sineobex.quarantine_items c
       where c.entity = 'problem' and c.op = 'create' and c.record_id = v_problem
       order by c.received_at desc limit 1));
  elsif p_entity in ('encounter', 'encounter_note') then
    if p_entity = 'encounter' then
      v_encounter := p_record;
    else
      v_encounter := coalesce(
        (select n.encounter_id from sineobex.encounter_notes n where n.id = p_record),
        (select sineobex.as_uuid(c.value ->> 'encounterId') from sineobex.quarantine_items c
         where c.entity = 'encounter_note' and c.op = 'create' and c.record_id = p_record
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
  foreach t in array array['patients', 'patient_aliases', 'patient_name_keys', 'patient_allergies',
                           'patient_consents', 'field_reviews', 'patient_corrections', 'team_index_versions'] loop
    execute format('alter table sineobex.%I enable row level security', t);
    execute format(
      'create policy %I on sineobex.%I using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope()) '
      'with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope())',
      t || '_team', t);
  end loop;
end $$;

-- Patients are never deleted. Search keys are derived and rebuilt by the triggers above.
revoke delete on sineobex.patients, sineobex.patient_aliases, sineobex.patient_allergies,
  sineobex.field_reviews, sineobex.team_index_versions from sineobex_app;
revoke update, delete on sineobex.patient_consents, sineobex.patient_corrections from sineobex_app;
