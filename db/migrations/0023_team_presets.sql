-- Module 5: team presets (phase 5 design 4.1 to 4.3, D128). Every team setting is a preset: a head
-- the API changes, and versions that never change once written, for eight kinds in one pair of
-- tables. Presets are written online only, in the portal, never through the change protocol, so
-- the server makes every ID and every time. Note types keep 0017's versions and gain a head of the
-- same shape. Nothing here is ever deleted: remove means archive.

set search_path = sineobex, public, extensions;

-- The team revision. Every preset and note type write takes the next one through takeRevision
-- (packages/forms/src/revision.ts) under the team lock and holds the lock to commit, so revisions
-- commit in order with no gap, and stamps every head it changed with it: a phone asks for the
-- heads changed since the revision it holds (phase 5 design 6.1). A team made later gets its row
-- at its first write. The epoch is renewed after a database restore (docs/setup.md), so a phone
-- holding a copy from before the restore replaces it.
create table sineobex.team_preset_state (
  team_id   uuid primary key references sineobex.teams (id),
  revision  bigint not null default 0 check (revision >= 0),
  epoch     uuid not null default gen_random_uuid()
);
insert into sineobex.team_preset_state (team_id) select id from sineobex.teams;

-- A team's revision only moves forward. A phone holding revision N asks for what changed after N,
-- so a revision taken again at or below N, once the row went back, would never reach it. Class 23,
-- as 0018's guards; it holds for the owner too.
create function sineobex.keep_revision_forward() returns trigger
language plpgsql as $$
begin
  if new.revision < old.revision then
    raise exception 'a team revision never goes back'
      using errcode = 'check_violation', constraint = 'team_preset_state_revision_forward';
  end if;
  return new;
end $$;

create trigger team_preset_state_revision_forward before update of revision on sineobex.team_preset_state
  for each row execute function sineobex.keep_revision_forward();

-- One head per preset. Its body is its current version's; name, state and the platform columns are
-- what lists, the pull and the installer read without opening a body.
create table sineobex.team_presets (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references sineobex.teams (id),
  -- A later phase widens the list (phase 10 adds billing_code_map).
  -- PLAN-OPEN (PL-15): are bags defined in phase 5? Yes, as a kind of preset: a name and
  -- minimums; phase 6 adds stock and owners.
  -- PLAN-OPEN (PL-22): are alert rules configurable (PRD main 190)? Not in the MVP: the PRD defines
  -- none, so no kind holds them.
  kind             text not null check (kind in ('order_category', 'item', 'bundle', 'flag',
                     'field_supply_map', 'condition_supply_map', 'bag', 'settings')),
  name             text not null check (length(btrim(name)) between 1 and 80),   -- the body's name
  state            text not null default 'active' check (state in ('active', 'archived')),
  current_version  integer not null check (current_version >= 1),   -- its newest version
  origin_key       text,                            -- the platform preset it came from; null for the team's own
  origin_version   integer check (origin_version >= 1),   -- the platform version last taken
  -- The newest platform version the installer has seen: above origin_version, an update is offered.
  platform_latest  integer check (platform_latest >= 1),
  customized       boolean not null default false,  -- once the team edits, archives or restores it
  -- Never 0: a head written at no revision would never reach a phone that pulled before it.
  revision         bigint not null check (revision >= 1),
  created_by       uuid references sineobex.users (id),   -- null for the platform installer
  updated_by       uuid references sineobex.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- So the versions, the events and later tables can only name a preset of their own team.
  constraint team_presets_team_id_key unique (team_id, id),
  constraint team_presets_team_id_origin_key_key unique (team_id, origin_key)
);
-- The pull: the heads changed since a phone's revision.
create index team_presets_revision on sineobex.team_presets (team_id, revision);
-- An active preset's name is its own within its kind. An archived one keeps its name and frees it.
create unique index team_presets_active_name on sineobex.team_presets (team_id, kind, lower(name))
  where state = 'active';
-- PLAN-OPEN (PL-21): where do team settings live? In the settings preset, one per team, versioned
-- and sent to phones like every preset; teams.settings stays unused, and 0002's comment on it is
-- out of date (a merged migration is never edited).
create unique index team_presets_one_settings on sineobex.team_presets (team_id) where kind = 'settings';
comment on column sineobex.teams.settings is
  'Unused. A team''s settings are its settings preset (team_presets, kind settings; 0023).';
create trigger team_presets_touch before update on sineobex.team_presets
  for each row execute function sineobex.touch_updated_at();

-- A preset's kind never changes: what was counted against an item, ranked by a flag or fired by a
-- map would mean something else. Class 23, as 0018's guards.
create function sineobex.keep_preset_kind() returns trigger
language plpgsql as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'a preset keeps its kind'
      using errcode = 'check_violation', constraint = 'team_presets_kind_fixed';
  end if;
  return new;
end $$;

create trigger team_presets_kind_fixed before update of kind on sineobex.team_presets
  for each row execute function sineobex.keep_preset_kind();

-- One row per version, never changed: an order or a count made on version 2 is read with version 2
-- for good. A new body is a new version.
create table sineobex.team_preset_versions (
  team_id     uuid not null,
  preset_id   uuid not null,
  version     integer not null check (version >= 1),
  body        jsonb not null check (jsonb_typeof(body) = 'object'),   -- the shape for its kind, checked by the API
  source      text not null check (source in ('team', 'platform')),
  created_by  uuid references sineobex.users (id),
  created_at  timestamptz not null default now(),
  primary key (team_id, preset_id, version),
  foreign key (team_id, preset_id) references sineobex.team_presets (team_id, id),
  -- 32 KiB, as PostgreSQL writes the body out: with a space after each separator, so a body of
  -- 32 KiB in compact JSON is over already.
  constraint team_preset_versions_body_size check (octet_length(body::text) <= 32768),
  -- A platform version is the platform's, written by no person.
  constraint team_preset_versions_platform_no_author check (source = 'team' or created_by is null)
);
create trigger team_preset_versions_append_only before update or delete on sineobex.team_preset_versions
  for each row execute function sineobex.forbid_mutation();

-- The head phase 4 left to this phase (forms 3.1): whether the team offers a note type, its newest
-- version, and what the platform offers. The versions stay in note_type_versions as they are.
create table sineobex.note_types (
  team_id          uuid not null references sineobex.teams (id),
  key              text not null check (key ~ '^[a-z][a-z0-9_]{1,60}$'),   -- as note_type_versions.key
  title            text not null,                   -- the newest definition's
  state            text not null default 'active' check (state in ('active', 'archived')),
  current_version  integer not null check (current_version >= 1),
  platform_latest  integer check (platform_latest >= 1),   -- the newest platform version seen
  customized       boolean not null default false,
  revision         bigint not null check (revision >= 0),  -- 0 for a head filled below, before any write
  updated_by       uuid references sineobex.users (id),   -- null for the installer
  updated_at       timestamptz not null default now(),
  primary key (team_id, key)
);
create trigger note_types_touch before update on sineobex.note_types
  for each row execute function sineobex.touch_updated_at();

-- Filled from the versions present, so every key a team holds has its head. Phase 4 wrote platform
-- versions only; a key whose versions include a team's own is customized all the same, so no
-- platform version is ever put above it (phase 5 design 5.2). A definition names its title; the
-- key stands in only where one does not, so no stored row can stop this migration.
insert into sineobex.note_types (team_id, key, title, current_version, platform_latest, customized, revision)
select team_id, key, case when btrim(title) <> '' then title else key end, current_version, platform_latest,
       customized, 0
from (
  select team_id, key,
         (array_agg(definition ->> 'title' order by version desc))[1] as title,
         max(version) as current_version,
         (array_agg(preset_version order by version desc) filter (where origin = 'preset'))[1] as platform_latest,
         bool_or(origin = 'team') as customized
  from sineobex.note_type_versions
  group by team_id, key
) newest;

-- One row for every act on a preset or a note type, so the reason a person gave is kept with the
-- act and the history can show it (PRD main 930, 951, 955). A reason is admin text: it lives here
-- only, never in the audit log's details or in logs (phase 5 design 9).
create table sineobex.team_preset_events (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references sineobex.teams (id),
  preset_id      uuid,
  note_type_key  text,
  act            text not null check (act in ('created', 'updated', 'archived', 'restored', 'update_taken',
                   'reordered', 'installed', 'platform_updated')),
  version        integer not null check (version >= 1),   -- the version the act made, or stood on
  -- PLAN-OPEN (PL-14): does every preset and note type write need a reason? Yes, every act by a
  -- person: 3 to 300 characters, kept here and shown in the history, never in the audit log.
  reason         text check (reason is null or length(btrim(reason)) between 3 and 300),
  created_by     uuid references sineobex.users (id),
  created_at     timestamptz not null default now(),
  foreign key (team_id, preset_id) references sineobex.team_presets (team_id, id),
  foreign key (team_id, note_type_key) references sineobex.note_types (team_id, key),
  constraint team_preset_events_one_subject check (num_nonnulls(preset_id, note_type_key) = 1),
  -- A person's act says who and why. The platform installer's acts, and only those, say neither.
  constraint team_preset_events_reason_with_person check ((reason is null) = (created_by is null)),
  constraint team_preset_events_installer_acts
    check ((created_by is null) = (act in ('installed', 'platform_updated')))
);
-- The history of one preset, or of one note type.
create index team_preset_events_preset on sineobex.team_preset_events (team_id, preset_id, created_at);
create index team_preset_events_note_type on sineobex.team_preset_events (team_id, note_type_key, created_at);
create trigger team_preset_events_append_only before update or delete on sineobex.team_preset_events
  for each row execute function sineobex.forbid_mutation();

-- Row-level security, second line.
do $$
declare t text;
begin
  foreach t in array array['team_preset_state', 'team_presets', 'team_preset_versions', 'note_types',
                           'team_preset_events'] loop
    execute format('alter table sineobex.%I enable row level security', t);
    execute format(
      'create policy %I on sineobex.%I using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope()) '
      'with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope())',
      t || '_team', t);
  end loop;
end $$;

-- PLAN-OPEN (PL-12): is a preset nobody uses deleted, or archived like the rest? Archived: nothing
-- here is deleted, so every old note, order and report still names what it used.
revoke delete on sineobex.team_preset_state, sineobex.team_presets, sineobex.team_preset_versions,
  sineobex.note_types, sineobex.team_preset_events from sineobex_app;
revoke update on sineobex.team_preset_versions, sineobex.team_preset_events from sineobex_app;
-- Of a state row the app role changes its revision only, through takeRevision. The epoch is renewed
-- after a restore, as the owner (docs/setup.md), and a new one makes every phone of the team
-- download its presets again; a row never moves to another team.
revoke update on sineobex.team_preset_state from sineobex_app;
grant update (revision) on sineobex.team_preset_state to sineobex_app;
