-- Module 5: the problem list. Statuses New, Ongoing and Resolved (Oct 12); the status history is
-- field_history on (problem, status); only patients.reverse_resolved moves a problem out of
-- Resolved (phase 3 design, section 9). Title and code never change: a wrong entry is marked
-- entered in error and added again.

set search_path = sineobex, public, extensions;

create table sineobex.problems (
  id                    uuid primary key,
  team_id               uuid not null references sineobex.teams (id),
  patient_id            uuid not null,
  title                 text not null check (length(btrim(title)) between 1 and 200),
  code_system           text check (code_system in ('icd10cm')),
  code                  text check (code is null or code ~ '^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$'),
  code_display          text check (code_display is null or length(code_display) <= 300),
  sensitive             boolean not null,
  -- Sync field `status` = {status, encounterId}; history is field_history on (problem, status).
  status                text not null check (status in ('new', 'ongoing', 'resolved')),
  status_encounter_id   uuid,
  status_changed_at     timestamptz not null,      -- when the current status was observed (corrected time)
  status_changed_by     uuid not null references sineobex.users (id),
  status_checked_at     timestamptz not null,      -- last set or re-confirmation: module 5's 90-day check
  recurrence_of         uuid,                      -- an earlier Resolved entry that came back
  resolved_in_error_of  uuid,                      -- the Resolved entry this one stands in for
  reversal_request      text check (reversal_request in ('open', 'reversed', 'declined')),
  merged_into           uuid,                      -- absorbed into another entry after a reversal
  error_reason          text check (error_reason is null or length(btrim(error_reason)) between 3 and 300),
  error_by              uuid references sineobex.users (id),
  error_at              timestamptz,
  source                text not null default 'manual' check (source in ('manual', 'encounter')),
  created_encounter_id  uuid,
  onset_date            date,
  author_user_id        uuid not null references sineobex.users (id),
  created_device_id     uuid references sineobex.devices (id),
  field_versions        jsonb not null default '{}',
  field_meta            jsonb not null default '{}',
  version               integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (team_id, id),
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id),
  foreign key (team_id, recurrence_of) references sineobex.problems (team_id, id),
  foreign key (team_id, resolved_in_error_of) references sineobex.problems (team_id, id),
  foreign key (team_id, merged_into) references sineobex.problems (team_id, id),
  foreign key (team_id, status_encounter_id) references sineobex.encounters (team_id, id),
  foreign key (team_id, created_encounter_id) references sineobex.encounters (team_id, id),
  check ((code is null) = (code_system is null)),
  check (num_nonnulls(recurrence_of, resolved_in_error_of) <= 1),
  check ((resolved_in_error_of is null) = (reversal_request is null)),
  check (merged_into is distinct from id),
  check ((error_reason is null) = (error_at is null))
);
create index problems_patient on sineobex.problems (team_id, patient_id, status);
-- The bag check (phases 6-7): coded New and Ongoing problems still on the list.
create index problems_open_code on sineobex.problems (team_id, code)
  where status in ('new', 'ongoing') and merged_into is null and error_reason is null;
create index problems_reversals on sineobex.problems (team_id, reversal_request, created_at)
  where reversal_request = 'open';
create trigger problems_touch before update on sineobex.problems
  for each row execute function sineobex.touch_updated_at();

-- Notes on a problem. Append-only: a wrong note is followed by a correcting note.
create table sineobex.problem_notes (
  id                uuid primary key,
  team_id           uuid not null references sineobex.teams (id),
  problem_id        uuid not null,
  text              text not null check (length(btrim(text)) between 1 and 4000),
  encounter_id      uuid,
  written_at        timestamptz not null,           -- clock-corrected device time
  author_user_id    uuid not null references sineobex.users (id),
  created_device_id uuid references sineobex.devices (id),
  change_id         uuid,
  created_at        timestamptz not null default now(),
  foreign key (team_id, problem_id) references sineobex.problems (team_id, id),
  foreign key (team_id, encounter_id) references sineobex.encounters (team_id, id)
);
create index problem_notes_problem on sineobex.problem_notes (team_id, problem_id, written_at);
create trigger problem_notes_append_only before update or delete on sineobex.problem_notes
  for each row execute function sineobex.forbid_mutation();

-- Row-level security, second line.
do $$
declare t text;
begin
  foreach t in array array['problems', 'problem_notes'] loop
    execute format('alter table sineobex.%I enable row level security', t);
    execute format(
      'create policy %I on sineobex.%I using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope()) '
      'with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope())',
      t || '_team', t);
  end loop;
end $$;

revoke delete on sineobex.problems from sineobex_app;
revoke update, delete on sineobex.problem_notes from sineobex_app;
