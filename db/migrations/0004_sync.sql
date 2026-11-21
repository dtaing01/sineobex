-- Module 9: confirmed-receipt sync, devices, quarantine. Plus the first synced records: encounters
-- and their notes, minimal here and extended in the encounters migration (phase 4).

set search_path = sineobex, public, extensions;

-- A phone, per person signed in on it. The device key (Ed25519) lets a phone whose user was
-- removed upload unsynced records into quarantine; it can read nothing (module 9).
create table sineobex.devices (
  id                    uuid primary key,
  team_id               uuid not null references sineobex.teams (id),
  user_id               uuid not null references sineobex.users (id),
  platform              text not null check (platform in ('ios', 'android', 'other')),
  app_version           text not null check (length(app_version) <= 40),
  -- Ed25519 public key, raw 32 bytes as unpadded base64url.
  public_key            text not null check (public_key ~ '^[A-Za-z0-9_-]{43}$'),
  status                text not null default 'active' check (status in ('active', 'wipe_requested', 'wiped')),
  registered_at         timestamptz not null default now(),
  last_seen_at          timestamptz,
  last_sync_at          timestamptz,
  clock_offset_ms       integer,
  clock_flagged_at      timestamptz,
  unsynced_counts       jsonb not null default '{}' check (jsonb_typeof(unsynced_counts) = 'object'),
  oldest_unsynced_at    timestamptz,
  wipe_requested_by     uuid references sineobex.users (id),
  wipe_requested_at     timestamptz,
  wipe_reason           text,
  wiped_at              timestamptz
);
create index devices_team on sineobex.devices (team_id, status);
create index devices_user on sineobex.devices (user_id);

-- Encounters (module 4). Times are clock-corrected device times; device_time keeps the raw value.
create table sineobex.encounters (
  id               uuid primary key,
  team_id          uuid not null references sineobex.teams (id),
  patient_id       uuid,
  kind             text not null check (kind in ('medical', 'non_medical')),
  status           text not null default 'draft' check (status in ('draft', 'completed', 'signed')),
  author_user_id   uuid not null references sineobex.users (id),
  started_at       timestamptz not null,
  started_device_time timestamptz,
  clock_verified   boolean not null default false,
  location         jsonb,
  created_device_id uuid references sineobex.devices (id),
  field_versions   jsonb not null default '{}',
  field_meta       jsonb not null default '{}',
  version          integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index encounters_team_status on sineobex.encounters (team_id, status, updated_at);
create trigger encounters_touch before update on sineobex.encounters for each row execute function sineobex.touch_updated_at();

-- One note per care type within an encounter (Oct 19: "One encounter holds several care types").
-- `data` holds the form's answers keyed by field path; every field carries its own version.
create table sineobex.encounter_notes (
  id               uuid primary key,
  team_id          uuid not null references sineobex.teams (id),
  encounter_id     uuid not null references sineobex.encounters (id),
  note_type_key    text not null check (note_type_key ~ '^[a-z][a-z0-9_]{1,60}$'),
  note_type_version integer,
  status           text not null default 'draft' check (status in ('draft', 'completed', 'signed')),
  author_user_id   uuid not null references sineobex.users (id),
  data             jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  field_versions   jsonb not null default '{}',
  field_meta       jsonb not null default '{}',
  version          integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index encounter_notes_encounter on sineobex.encounter_notes (encounter_id);
create index encounter_notes_team_status on sineobex.encounter_notes (team_id, status, updated_at);
create trigger encounter_notes_touch before update on sineobex.encounter_notes for each row execute function sineobex.touch_updated_at();

-- Every accepted value, with the one it replaced (Oct 19: "Every edit logs the old and new value",
-- and the reconciliation rule: "The replaced value and who approved it are logged").
create table sineobex.field_history (
  id              bigint generated always as identity primary key,
  team_id         uuid not null references sineobex.teams (id),
  entity          text not null,
  record_id       uuid not null,
  field           text not null,
  version         integer not null,
  value           jsonb,
  previous_value  jsonb,
  kind            text not null check (kind in ('created', 'set', 'filled_blank', 'replaced_after_review', 'kept_both')),
  changed_by      uuid not null references sineobex.users (id),
  approved_by     uuid references sineobex.users (id),
  change_id       uuid,
  device_id       uuid,
  device_time     timestamptz,
  recorded_at     timestamptz not null default now()
);
create index field_history_record on sineobex.field_history (team_id, entity, record_id, field, version);
create trigger field_history_append_only before update or delete on sineobex.field_history
  for each row execute function sineobex.forbid_mutation();

-- The receipt for every change a phone sent. A repeated change ID gets the same receipt back,
-- so "the app was killed after the server committed" is a retry, never a duplicate.
create table sineobex.sync_changes (
  change_id       uuid primary key,
  team_id         uuid not null references sineobex.teams (id),
  device_id       uuid not null references sineobex.devices (id),
  user_id         uuid not null references sineobex.users (id),
  device_seq      bigint not null,
  entity          text not null,
  record_id       uuid not null,
  op              text not null check (op in ('create', 'set', 'append')),
  field           text,
  value_hash      text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  base_version    integer not null default 0,
  -- How this change relates to others: the earlier local change to the same field it builds on,
  -- the rejected change it fixes, and the conflict it resolves (with the user's choice).
  follows         uuid,
  supersedes      uuid,
  conflict_of     uuid,
  resolution      text check (resolution in ('replace', 'keep_server')),
  device_time     timestamptz not null,
  corrected_time  timestamptz,
  clock_verified  boolean not null default false,
  status          text not null check (status in ('accepted', 'rejected', 'conflict')),
  server_version  integer,
  reason          text,
  details         jsonb,
  resolved_by_change uuid,
  received_at     timestamptz not null default now()
);
create index sync_changes_device on sineobex.sync_changes (device_id, device_seq);
create index sync_changes_record on sineobex.sync_changes (record_id);
create index sync_changes_open_rejections on sineobex.sync_changes (team_id, user_id) where status = 'rejected' and resolved_by_change is null;

-- Records sent from a phone whose user lost access while offline (module 9). Never applied
-- automatically; a Program Admin accepts or rejects each one.
create table sineobex.quarantine_items (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references sineobex.teams (id),
  device_id       uuid not null references sineobex.devices (id),
  user_id         uuid not null references sineobex.users (id),
  change_id       uuid not null unique,
  entity          text not null,
  record_id       uuid not null,
  op              text not null,
  field           text,
  value           jsonb,
  value_hash      text not null,
  -- The rest of the change entry (base version, follows, corrected time), so an accepted item
  -- is applied exactly as the phone sent it.
  details         jsonb not null default '{}',
  device_time     timestamptz not null,
  reason          text not null check (reason in ('access_removed', 'permission')),
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decided_by      uuid references sineobex.users (id),
  decided_at      timestamptz,
  decision_reason text,
  received_at     timestamptz not null default now()
);
create index quarantine_items_team on sineobex.quarantine_items (team_id, status, received_at);

-- What a person should look at, without patient details ("A change to a note you wrote needs review").
create table sineobex.user_notices (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references sineobex.teams (id),
  user_id     uuid not null references sineobex.users (id),
  kind        text not null,
  entity      text,
  record_id   uuid,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index user_notices_user on sineobex.user_notices (user_id, read_at);

-- Signed device requests (quarantine upload, status, wipe confirmation) carry no user token, so
-- there is no team to scope the lookup to until the device is found. This returns only what
-- verifying the signature needs; everything after runs in the device's own team scope.
create function sineobex.device_for_signature(p_device uuid)
returns table (team_id uuid, user_id uuid, public_key text, status text)
language sql stable security definer
set search_path = sineobex, pg_temp as $$
  select d.team_id, d.user_id, d.public_key, d.status from sineobex.devices d where d.id = p_device
$$;
revoke all on function sineobex.device_for_signature(uuid) from public;
grant execute on function sineobex.device_for_signature(uuid) to sineobex_app;

-- Row-level security, second line.
do $$
declare t text;
begin
  foreach t in array array['devices', 'encounters', 'encounter_notes', 'field_history', 'sync_changes', 'quarantine_items', 'user_notices'] loop
    execute format('alter table sineobex.%I enable row level security', t);
    execute format(
      'create policy %I on sineobex.%I using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope()) '
      'with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope())',
      t || '_team', t);
  end loop;
end $$;

revoke update, delete on sineobex.field_history from sineobex_app;
revoke delete on sineobex.sync_changes, sineobex.encounters, sineobex.encounter_notes, sineobex.quarantine_items from sineobex_app;
