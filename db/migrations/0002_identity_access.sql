-- Module 1: teams, people, roles, credentials and memberships.
--
-- Two layers of access: a role decides which screens and patients a user reaches; a clinical
-- credential decides which clinical acts they may perform. Both are stored per team membership,
-- so one login can belong to several teams (decided Oct 12) and a resident rotating between
-- programs keeps one account. Permissions are checked in the API; the policies below are the
-- second line of defense.

set search_path = sineobex, public, extensions;

create table sineobex.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  status      text not null default 'active' check (status in ('active', 'suspended')),
  -- Team presets that are plain values (phone auto-lock minutes, unsynced-banner hours, ...).
  settings    jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now()
);
create trigger teams_touch before update on sineobex.teams
  for each row execute function sineobex.touch_updated_at();

-- People, independent of teams. Staff names and emails, never patients.
-- auth_issuer + auth_subject bind the row to exactly one identity at the OIDC provider. The API
-- sets them when it invites someone, so a sign-in is never matched to a person by email alone.
create table sineobex.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (email = lower(email) and position('@' in email) > 1),
  display_name  text not null check (length(btrim(display_name)) between 1 and 120),
  auth_issuer   text not null,
  auth_subject  text not null,
  status        text not null default 'active' check (status in ('active', 'disabled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (auth_issuer, auth_subject)
);
create unique index users_email_key on sineobex.users (email);
create trigger users_touch before update on sineobex.users
  for each row execute function sineobex.touch_updated_at();

-- The owner registry (module 1): the few people who create teams and appoint Program Admins.
-- On AWS each owner also has a named IAM identity; this table is what the API checks.
create table sineobex.platform_owners (
  user_id   uuid primary key references sineobex.users (id),
  added_at  timestamptz not null default now(),
  added_by  uuid references sineobex.users (id)
);

-- Roles. Standard roles are shared rows (team_id is null); custom roles belong to one team and
-- may only combine existing permissions (decided Oct 12). The API owns the permission catalog;
-- this check stops a typo or a stale client writing a permission that doesn't exist.
create table sineobex.roles (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid references sineobex.teams (id),
  key          text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name         text not null check (length(btrim(name)) between 1 and 60),
  description  text,
  permissions  text[] not null,
  is_standard  boolean not null default false,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid references sineobex.users (id),
  unique nulls not distinct (team_id, key),
  check (is_standard = (team_id is null))
);

create function sineobex.known_permissions() returns text[]
language sql immutable as $$
  select array[
    'team.manage_users', 'team.manage_presets', 'team.view_audit',
    'patients.view', 'patients.edit', 'patients.correct_identity', 'patients.review_duplicates',
    'patients.view_sensitive', 'patients.view_sensitive_exams', 'patients.reverse_resolved',
    'encounters.chart', 'checkins.create', 'referrals.create',
    'routes.view', 'routes.manage',
    'inventory.view', 'inventory.manage',
    'billing.view_codes', 'exports.billing', 'exports.grant', 'exports.data',
    'quarantine.review', 'devices.manage'
  ]::text[]
$$;

alter table sineobex.roles add constraint roles_known_permissions
  check (permissions <@ sineobex.known_permissions());

-- The four standard roles confirmed on the Impromptu Call. Program Admin holds everything for
-- its team; who may appoint one is enforced in the API (owners only).
insert into sineobex.roles (team_id, key, name, description, permissions, is_standard) values
  (null, 'program_admin', 'Program Admin', 'Everything for the team: users, presets, routes, exports, audit dashboard.',
    sineobex.known_permissions(), true),
  (null, 'logistics', 'Logistics', 'Builds and assigns routes, views patients, charts encounters.',
    array['patients.view', 'patients.edit', 'patients.view_sensitive', 'encounters.chart', 'checkins.create',
          'referrals.create', 'routes.view', 'routes.manage', 'inventory.view', 'inventory.manage'], true),
  (null, 'healthcare_staff', 'Healthcare Staff', 'Views team patients, charts encounters, creates referrals.',
    array['patients.view', 'patients.edit', 'patients.view_sensitive', 'encounters.chart', 'checkins.create',
          'referrals.create', 'routes.view', 'inventory.view'], true),
  (null, 'billing_data', 'Billing/Data', 'View only: charts, ICD-10 and CPT codes, supply logs; runs exports.',
    array['patients.view', 'billing.view_codes', 'inventory.view', 'exports.billing', 'exports.grant'], true);

-- Clinical credentials (module 1). What each may do lives in the API; the fields each needs
-- before an upgrade takes effect are checked there too (Oct 19).
create table sineobex.team_memberships (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references sineobex.teams (id),
  user_id            uuid not null references sineobex.users (id),
  role_id            uuid not null references sineobex.roles (id),
  credential         text not null default 'none'
                       check (credential in ('attending', 'resident', 'np', 'pa', 'student', 'chw', 'none')),
  credential_fields  jsonb not null default '{}' check (jsonb_typeof(credential_fields) = 'object'),
  status             text not null default 'active' check (status in ('active', 'removed')),
  invited_by         uuid references sineobex.users (id),
  invited_at         timestamptz not null default now(),
  removed_at         timestamptz,
  removed_by         uuid references sineobex.users (id),
  removal_reason     text,
  updated_at         timestamptz not null default now(),
  unique (team_id, user_id),
  check ((status = 'removed') = (removed_at is not null))
);
create index team_memberships_user on sineobex.team_memberships (user_id);
create trigger team_memberships_touch before update on sineobex.team_memberships
  for each row execute function sineobex.touch_updated_at();

-- Every role, credential and status change with the reason given (Oct 19: "a role change needs a
-- reason and is logged"). Append-only; the audit log records the same events in its chain.
create table sineobex.membership_changes (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references sineobex.teams (id),
  membership_id  uuid not null references sineobex.team_memberships (id),
  kind           text not null check (kind in ('invited', 'role', 'credential', 'removed', 'restored')),
  old_value      jsonb,
  new_value      jsonb,
  reason         text,
  changed_by     uuid not null references sineobex.users (id),
  changed_at     timestamptz not null default now()
);
create index membership_changes_membership on sineobex.membership_changes (membership_id, changed_at);
create trigger membership_changes_append_only before update or delete on sineobex.membership_changes
  for each row execute function sineobex.forbid_mutation();

-- Terms of Use and the confidentiality acknowledgement, accepted by each person at first sign-in
-- (Business strategy, BAA). The organization's BAA is a separate, per-team record.
create table sineobex.acknowledgements (
  user_id      uuid not null references sineobex.users (id),
  kind         text not null check (kind in ('terms_of_use', 'confidentiality')),
  version      text not null,
  accepted_at  timestamptz not null default now(),
  primary key (user_id, kind, version)
);

-- The first time the API sees a provider session, it writes a session.started audit event, so the
-- audit log shows sign-ins next to what was done in them (log-in monitoring, §164.308(a)(5)).
create table sineobex.sessions_seen (
  session_id     text primary key,
  user_id        uuid not null references sineobex.users (id),
  first_seen_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Row-level security (second line). Request transactions set app.team_id and app.user_id.
-- ---------------------------------------------------------------------------------------------

alter table sineobex.teams enable row level security;
alter table sineobex.roles enable row level security;
alter table sineobex.team_memberships enable row level security;
alter table sineobex.membership_changes enable row level security;
alter table sineobex.acknowledgements enable row level security;
alter table sineobex.sessions_seen enable row level security;

-- A person sees their own memberships in every team (to pick a team), and every membership of
-- the team they are acting in.
create policy memberships_visible on sineobex.team_memberships
  using (team_id = sineobex.current_team_id()
         or user_id = sineobex.current_user_id()
         or sineobex.is_platform_scope())
  with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope());

create policy teams_visible on sineobex.teams
  using (id = sineobex.current_team_id()
         or sineobex.is_platform_scope()
         or exists (select 1 from sineobex.team_memberships m
                    where m.team_id = teams.id and m.user_id = sineobex.current_user_id()
                      and m.status = 'active'))
  with check (sineobex.is_platform_scope() or id = sineobex.current_team_id());

create policy roles_visible on sineobex.roles
  using (team_id is null or team_id = sineobex.current_team_id() or sineobex.is_platform_scope()
         or exists (select 1 from sineobex.team_memberships m
                    where m.role_id = roles.id and m.user_id = sineobex.current_user_id()))
  with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope());

create policy membership_changes_visible on sineobex.membership_changes
  using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope())
  with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope());

create policy sessions_seen_own on sineobex.sessions_seen
  using (user_id = sineobex.current_user_id() or sineobex.is_platform_scope())
  with check (user_id = sineobex.current_user_id());

create policy acknowledgements_own on sineobex.acknowledgements
  using (user_id = sineobex.current_user_id() or sineobex.is_platform_scope())
  with check (user_id = sineobex.current_user_id());

-- Standard roles are reference data: the app may read them but never change them.
revoke delete on sineobex.roles from sineobex_app;
revoke update, delete on sineobex.membership_changes from sineobex_app;
revoke update, delete on sineobex.acknowledgements from sineobex_app;
revoke update, delete on sineobex.sessions_seen from sineobex_app;
revoke delete on sineobex.team_memberships from sineobex_app;
revoke delete on sineobex.teams from sineobex_app;
revoke delete on sineobex.users from sineobex_app;
