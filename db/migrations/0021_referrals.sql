-- Module 6: referrals (phase 4 design, lifecycle 2.5 and 7). "A referral records only a date and
-- free-text details." Status, the completion prompt and completion reporting are V2, and the table
-- has no column for them.

set search_path = sineobex, public, extensions;

-- The shape of patient_allergies (0009): made on the phone, never overwritten, and the only change
-- is entered in error.
create table sineobex.referrals (
  id                uuid primary key,
  team_id           uuid not null references sineobex.teams (id),
  patient_id        uuid not null,
  referred_on       date not null,                  -- typed by the worker; not the time it was recorded
  details           text not null check (length(btrim(details)) between 1 and 2000),
  encounter_id      uuid,                           -- the visit it was made in, if any
  status            text not null default 'active' check (status in ('active', 'entered_in_error')),
  error_reason      text check (error_reason is null or length(btrim(error_reason)) between 3 and 300),
  error_by          uuid references sineobex.users (id),
  error_at          timestamptz,
  recorded_at       timestamptz not null,           -- clock-corrected device time
  clock_verified    boolean not null default false,
  author_user_id    uuid not null references sineobex.users (id),
  created_device_id uuid references sineobex.devices (id),
  field_versions    jsonb not null default '{}',
  field_meta        jsonb not null default '{}',
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint referrals_team_id_key unique (team_id, id),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  foreign key (team_id, encounter_id) references sineobex.encounters (team_id, id),
  -- Why, who and when go with the mark, all three or none.
  constraint referrals_error_with_status check (
    num_nulls(error_reason, error_by, error_at) = case when status = 'entered_in_error' then 0 else 3 end)
);
-- A chart lists its group's referrals newest first.
create index referrals_patient on sineobex.referrals (team_id, patient_id, referred_on desc);
create trigger referrals_touch before update on sineobex.referrals
  for each row execute function sineobex.touch_updated_at();

-- Row-level security, second line.
alter table sineobex.referrals enable row level security;
create policy referrals_team on sineobex.referrals
  using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope())
  with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope());

-- A mistake is marked entered in error and stays in the list.
revoke delete on sineobex.referrals from sineobex_app;
