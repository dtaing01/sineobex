-- Base schema, extensions, the application role and shared helpers.
--
-- Portability rules (Build plan, "Rules that keep the move to AWS cheap"):
--   * Plain PostgreSQL 16. Nothing here depends on Supabase; the same files run on RDS.
--   * Everything lives in the `sineobex` schema, never `public`, so Supabase's PostgREST
--     cannot expose a table even by accident. The apps reach data only through our API.
--   * Row-level security is a second line of defense. Permissions are checked in the API.

set search_path = sineobex, public, extensions;

create schema if not exists sineobex;

-- Fuzzy patient search and duplicate matching (module 2). All four ship with PostgreSQL contrib
-- and are available on RDS and Supabase. On Supabase they may already exist in `extensions`.
create extension if not exists pg_trgm;
create extension if not exists fuzzystrmatch;
create extension if not exists unaccent;
create extension if not exists btree_gin;

-- The API connects as a login role that is a member of sineobex_app. sineobex_app owns nothing,
-- so row-level security applies to it. Login roles and their passwords are created by the deploy
-- (Secrets Manager on AWS, the dashboard on Supabase), never in a migration.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'sineobex_app') then
    create role sineobex_app nologin;
  end if;
end $$;

revoke all on schema sineobex from public;
grant usage on schema sineobex to sineobex_app;
alter default privileges in schema sineobex grant select, insert, update, delete on tables to sineobex_app;
alter default privileges in schema sineobex grant usage, select on sequences to sineobex_app;
alter default privileges in schema sineobex grant execute on functions to sineobex_app;

-- Supabase creates these roles for its auto-generated REST API. Make sure they can never see our
-- schema. On RDS the roles don't exist and this block does nothing.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema sineobex from %I', r);
      execute format('alter default privileges in schema sineobex revoke all on tables from %I', r);
    end if;
  end loop;
end $$;

-- What kind of environment this database is. Written once by the deploy (`db migrate --environment`),
-- read by the seed (which runs only in demo environments) and by the API (which shows the
-- Demo data only banner and refuses to start in production mode against a demo database).
create table sineobex.environment (
  singleton  boolean primary key default true check (singleton),
  kind       text not null check (kind in ('local', 'test', 'preview', 'pilot', 'production')),
  set_at     timestamptz not null default now()
);
grant select on sineobex.environment to sineobex_app;
revoke insert, update, delete on sineobex.environment from sineobex_app;

create function sineobex.forbid_environment_change() returns trigger
language plpgsql as $$
begin
  raise exception 'sineobex.environment is write-once';
end $$;

create trigger environment_write_once
  before update or delete on sineobex.environment
  for each row execute function sineobex.forbid_environment_change();

create function sineobex.is_demo_environment() returns boolean
language sql stable as $$
  select coalesce((select kind in ('local', 'test', 'preview') from sineobex.environment), false)
$$;

-- Request context. The API sets these with `set local` at the start of every transaction.
-- current_setting(..., true) returns NULL rather than raising when a setting is absent.
create function sineobex.current_team_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.team_id', true), '')::uuid
$$;

create function sineobex.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Platform-level work (owner actions, scheduled jobs) runs with app.scope = 'platform'
-- and may cross teams. Request handlers never set it.
create function sineobex.is_platform_scope() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.scope', true), '') = 'platform'
$$;

create function sineobex.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- For tables that are append-only by design (audit log, field history, stock movements).
create function sineobex.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only; % is not allowed', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end $$;

-- Name normalization for search and duplicate matching (module 2): lower case, accents removed,
-- punctuation collapsed to single spaces. Immutable wrapper so it can back an index.
create function sineobex.normalize_name(input text) returns text
language sql immutable parallel safe
set search_path = sineobex, public, extensions as $$
  select nullif(
    btrim(regexp_replace(lower(unaccent('unaccent'::regdictionary, coalesce(input, ''))), '[^a-z0-9]+', ' ', 'g')),
    ''
  )
$$;
