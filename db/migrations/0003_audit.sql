-- Module 10: tamper-evident audit log.
--
-- One hash chain per team (and one for platform-level owner actions). Each row's hash covers the
-- previous row's hash and every field of the row, so altering or deleting any entry breaks every
-- later hash. Rows can only be added through sineobex.append_audit, which takes a per-chain lock,
-- numbers the row and computes its hash; the application role cannot insert, update or delete
-- directly. Chain heads are periodically written to S3 Object Lock (compliance mode) by the
-- anchoring job, so even the database owner cannot rewrite history unnoticed.

set search_path = sineobex, public, extensions;

-- The platform chain holds owner actions that are not about one team.
create function sineobex.platform_chain() returns uuid
language sql immutable as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;

create table sineobex.audit_events (
  id               bigint generated always as identity primary key,
  chain_key        uuid not null,
  seq              bigint not null check (seq > 0),
  team_id          uuid references sineobex.teams (id),
  occurred_at      timestamptz not null,
  -- For events recorded on a phone while offline: when they happened there (clock-corrected).
  device_time      timestamptz,
  actor_user_id    uuid references sineobex.users (id),
  actor_role       text,
  actor_credential text,
  action           text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity           text,
  entity_id        text,
  patient_id       uuid,
  device_id        uuid,
  ip               inet,
  request_id       text,
  location         jsonb,
  details          jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  prev_hash        bytea,
  hash             bytea not null,
  unique (chain_key, seq),
  check ((seq = 1) = (prev_hash is null))
);

-- Indexes for the admin dashboard (module 2: "(team, patient, time) and (user, time)").
create index audit_events_team_patient_time on sineobex.audit_events (team_id, patient_id, occurred_at);
create index audit_events_actor_time on sineobex.audit_events (actor_user_id, occurred_at);
create index audit_events_team_time on sineobex.audit_events (team_id, occurred_at);

create trigger audit_events_append_only before update or delete on sineobex.audit_events
  for each row execute function sineobex.forbid_mutation();
create trigger audit_events_no_truncate before truncate on sineobex.audit_events
  for each statement execute function sineobex.forbid_mutation();

create table sineobex.audit_chain_heads (
  chain_key   uuid primary key,
  seq         bigint not null,
  hash        bytea not null,
  updated_at  timestamptz not null
);

-- Chain heads written to the anchor store (S3 Object Lock in production).
create table sineobex.audit_anchors (
  id          bigint generated always as identity primary key,
  chain_key   uuid not null,
  seq         bigint not null,
  hash        bytea not null,
  store       text not null,
  object_key  text not null,
  anchored_at timestamptz not null default now(),
  unique (chain_key, seq)
);
create trigger audit_anchors_append_only before update or delete on sineobex.audit_anchors
  for each row execute function sineobex.forbid_mutation();

-- Canonical form of a row for hashing. Timestamps are formatted explicitly in UTC so the digest
-- never depends on the session's TimeZone setting; jsonb's text form is already canonical.
create function sineobex.audit_digest(
  p_prev_hash bytea, p_chain_key uuid, p_seq bigint, p_team_id uuid, p_occurred_at timestamptz,
  p_device_time timestamptz, p_actor uuid, p_actor_role text, p_actor_credential text,
  p_action text, p_entity text, p_entity_id text, p_patient uuid, p_device uuid, p_ip inet,
  p_request_id text, p_location jsonb, p_details jsonb
) returns bytea
language sql immutable parallel safe as $$
  select sha256(convert_to(jsonb_build_object(
    'prev', coalesce(encode(p_prev_hash, 'hex'), ''),
    'chain', p_chain_key,
    'seq', p_seq,
    'team', p_team_id,
    'at', to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'deviceTime', to_char(p_device_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor', p_actor,
    'role', p_actor_role,
    'credential', p_actor_credential,
    'action', p_action,
    'entity', p_entity,
    'entityId', p_entity_id,
    'patient', p_patient,
    'device', p_device,
    'ip', host(p_ip),
    'requestId', p_request_id,
    'location', p_location,
    'details', p_details
  )::text, 'UTF8'))
$$;

create function sineobex.append_audit(
  p_team_id uuid,
  p_actor uuid,
  p_actor_role text,
  p_actor_credential text,
  p_action text,
  p_entity text default null,
  p_entity_id text default null,
  p_patient uuid default null,
  p_device uuid default null,
  p_ip inet default null,
  p_request_id text default null,
  p_device_time timestamptz default null,
  p_location jsonb default null,
  p_details jsonb default '{}'
) returns bigint
language plpgsql security definer
set search_path = sineobex, pg_temp as $$
declare
  v_chain uuid := coalesce(p_team_id, sineobex.platform_chain());
  v_seq bigint;
  v_prev bytea;
  v_at timestamptz := clock_timestamp();
  v_hash bytea;
  v_id bigint;
begin
  -- Request handlers may only write to the chain of the team they are acting in.
  if p_team_id is distinct from sineobex.current_team_id() and not sineobex.is_platform_scope() then
    raise exception 'audit event for another team' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || v_chain::text, 0));
  select seq, hash into v_seq, v_prev from sineobex.audit_chain_heads where chain_key = v_chain;
  v_seq := coalesce(v_seq, 0) + 1;

  v_hash := sineobex.audit_digest(v_prev, v_chain, v_seq, p_team_id, v_at, p_device_time, p_actor,
    p_actor_role, p_actor_credential, p_action, p_entity, p_entity_id, p_patient, p_device, p_ip,
    p_request_id, p_location, coalesce(p_details, '{}'));

  insert into sineobex.audit_events (chain_key, seq, team_id, occurred_at, device_time, actor_user_id,
    actor_role, actor_credential, action, entity, entity_id, patient_id, device_id, ip, request_id,
    location, details, prev_hash, hash)
  values (v_chain, v_seq, p_team_id, v_at, p_device_time, p_actor, p_actor_role, p_actor_credential,
    p_action, p_entity, p_entity_id, p_patient, p_device, p_ip, p_request_id, p_location,
    coalesce(p_details, '{}'), v_prev, v_hash)
  returning id into v_id;

  insert into sineobex.audit_chain_heads (chain_key, seq, hash, updated_at)
  values (v_chain, v_seq, v_hash, v_at)
  on conflict (chain_key) do update set seq = excluded.seq, hash = excluded.hash, updated_at = excluded.updated_at;

  return v_id;
end $$;

-- Walks a chain and recomputes every hash. Detects edited rows (hash mismatch), deleted rows
-- (gap in seq) and a truncated tail (head disagrees with the last row).
create function sineobex.verify_audit_chain(p_chain_key uuid)
returns table (ok boolean, checked bigint, first_bad_seq bigint, problem text)
language plpgsql stable security definer
set search_path = sineobex, pg_temp as $$
declare
  r sineobex.audit_events%rowtype;
  v_prev bytea := null;
  v_expected_seq bigint := 1;
  v_count bigint := 0;
  v_head record;
begin
  if p_chain_key is distinct from sineobex.current_team_id() and not sineobex.is_platform_scope() then
    raise exception 'cannot verify another team''s chain' using errcode = 'insufficient_privilege';
  end if;
  for r in select * from sineobex.audit_events where chain_key = p_chain_key order by seq loop
    if r.seq <> v_expected_seq then
      return query select false, v_count, v_expected_seq, 'missing entry';
      return;
    end if;
    if r.prev_hash is distinct from v_prev or r.hash <> sineobex.audit_digest(r.prev_hash, r.chain_key, r.seq,
        r.team_id, r.occurred_at, r.device_time, r.actor_user_id, r.actor_role, r.actor_credential,
        r.action, r.entity, r.entity_id, r.patient_id, r.device_id, r.ip, r.request_id, r.location,
        r.details) then
      return query select false, v_count, r.seq, 'hash mismatch';
      return;
    end if;
    v_prev := r.hash;
    v_expected_seq := r.seq + 1;
    v_count := v_count + 1;
  end loop;

  select seq, hash into v_head from sineobex.audit_chain_heads where chain_key = p_chain_key;
  if found and (v_head.seq <> v_expected_seq - 1 or v_head.hash is distinct from v_prev) then
    return query select false, v_count, v_expected_seq, 'chain head does not match the last entry';
    return;
  end if;
  return query select true, v_count, null::bigint, null::text;
end $$;

alter table sineobex.audit_events enable row level security;
create policy audit_events_visible on sineobex.audit_events
  using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope());

alter table sineobex.audit_chain_heads enable row level security;
create policy audit_heads_visible on sineobex.audit_chain_heads
  using (chain_key = sineobex.current_team_id() or sineobex.is_platform_scope());

alter table sineobex.audit_anchors enable row level security;
create policy audit_anchors_visible on sineobex.audit_anchors
  using (chain_key = sineobex.current_team_id() or sineobex.is_platform_scope())
  with check (sineobex.is_platform_scope());

-- The application appends only through append_audit and reads through policies.
revoke insert, update, delete, truncate on sineobex.audit_events from sineobex_app;
revoke insert, update, delete, truncate on sineobex.audit_chain_heads from sineobex_app;
revoke update, delete, truncate on sineobex.audit_anchors from sineobex_app;
revoke execute on function sineobex.append_audit from public;
grant execute on function sineobex.append_audit to sineobex_app;
revoke execute on function sineobex.verify_audit_chain from public;
grant execute on function sineobex.verify_audit_chain to sineobex_app;
