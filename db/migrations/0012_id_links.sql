-- Module 2: Street Medicine ID links. A token is 128 random bits, base64url (22 characters),
-- carried in the URL fragment so no server log ever sees it. Stored as plaintext, so anyone with
-- patients.edit can copy the link again, and as SHA-256, which uniqueness and every lookup use
-- (phase 3 design, section 10).

set search_path = sineobex, public, extensions;

create table sineobex.patient_id_links (
  id                  uuid primary key,                -- made on the phone, or by the API online
  team_id             uuid not null references sineobex.teams (id),
  patient_id          uuid not null,
  token               text not null check (token ~ '^[A-Za-z0-9_-]{22}$'),   -- 128 bits, base64url
  token_hash          text not null check (token_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 of the token's ASCII
  status              text not null check (status in ('active', 'retired')),
  reason              text not null check (reason in ('first_card', 'lost', 'damaged', 'stolen', 'patient_request', 'other')),
  replaces_link_id    uuid,                            -- the link the issuer saw as active
  effective_at        timestamptz not null,            -- corrected device time (offline) or server time (online): decides conflicts
  clock_verified      boolean not null,
  made_offline        boolean not null,
  -- Only staff retire a token, by regenerating (module 2). A merge never does (D39).
  retired_reason      text check (retired_reason in ('regenerated', 'superseded_by_newer')),
  retired_by_link     uuid,
  retired_at          timestamptz,
  restored_at         timestamptz,                     -- a merge undo gave this record its token back
  restored_by_merge   uuid,                            -- that patient_merges row
  issued_by           uuid not null references sineobex.users (id),
  issued_device_id    uuid references sineobex.devices (id),
  change_id           uuid,
  received_at         timestamptz not null default now(),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  check ((status = 'retired') = (retired_at is not null and retired_reason is not null))
);
-- Global, not team-led: a token must be unique across every team, because phase 9 resolves a card
-- before the scanner's team is known to match. Inserts use `on conflict (token_hash) do nothing`,
-- so a taken hash is a validation rejection, never an error inside a push.
create unique index patient_id_links_token_hash on sineobex.patient_id_links (token_hash);
-- One active token per patient record (row). A merged group may hold one per record until the next
-- regeneration retires them all (D39), so nothing enforces one per group.
create unique index patient_id_links_one_active on sineobex.patient_id_links (team_id, patient_id) where status = 'active';
create index patient_id_links_patient on sineobex.patient_id_links (team_id, patient_id, received_at);

-- The index shows the group's active link IDs.
create trigger patient_id_links_index_insert after insert on sineobex.patient_id_links
  referencing new table as changed for each statement execute function sineobex.bump_team_index();
create trigger patient_id_links_index_update after update on sineobex.patient_id_links
  referencing new table as changed for each statement execute function sineobex.bump_team_index();

-- Row-level security, second line.
alter table sineobex.patient_id_links enable row level security;
create policy patient_id_links_team on sineobex.patient_id_links
  using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope())
  with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope());

revoke delete on sineobex.patient_id_links from sineobex_app;
