-- Module 4: the note type definitions a team has installed (phase 4 design, forms 3.1). Forms are
-- data (D13): a note names a key and a version, and the row for that pair says what the form asks.

set search_path = sineobex, public, extensions;

-- One row per version, never changed: a note finished under version 3 is read with version 3 for
-- good. A new wording is a new version.
create table sineobex.note_type_versions (
  team_id         uuid not null references sineobex.teams (id),   -- definitions are per team
  key             text not null check (key ~ '^[a-z][a-z0-9_]{1,60}$'),   -- as encounter_notes.note_type_key
  version         integer not null check (version >= 1),
  definition      jsonb not null check (jsonb_typeof(definition) = 'object'),   -- the resolved definition
  hash            text not null check (hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 of the definition's canonical JSON
  origin          text not null check (origin in ('preset', 'team')),   -- phase 4 writes 'preset' only
  preset_version  integer check (preset_version >= 1),   -- the platform version a preset row was installed from
  created_at      timestamptz not null default now(),
  primary key (team_id, key, version),
  constraint note_type_versions_preset_names_version check (origin <> 'preset' or preset_version is not null)
);
-- No foreign key from encounter_notes: the sync rules check a note's key and version, and phase 2
-- preview notes have no version.

create trigger note_type_versions_append_only before update or delete on sineobex.note_type_versions
  for each row execute function sineobex.forbid_mutation();

-- Row-level security, second line.
alter table sineobex.note_type_versions enable row level security;
create policy note_type_versions_team on sineobex.note_type_versions
  using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope())
  with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope());

revoke update, delete on sineobex.note_type_versions from sineobex_app;
