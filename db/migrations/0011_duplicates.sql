-- Module 2: the duplicate merge queue. A likely pair is never merged automatically; a person
-- decides each one with a comment (Oct 12). A merge moves no child row: it rewrites canonical_id on
-- patient rows only, and undo recomputes it (phase 3 design, sections 8.4 and 8.5).

set search_path = sineobex, public, extensions;

-- A likely pair (patient_a < patient_b).
create table sineobex.duplicate_pairs (
  id                       uuid primary key default gen_random_uuid(),
  team_id                  uuid not null references sineobex.teams (id),
  patient_a                uuid not null,
  patient_b                uuid not null,
  score                    numeric(4, 3) not null check (score between 0 and 1),
  reasons                  text[] not null default '{}',       -- MatchReason values, never names
  sources                  text[] not null,                    -- 'sync', 'edit', 'merge_rematch', 'correction', 'staff_report'
  creator_dismissed        boolean not null default false,     -- the creator saw this match and said "Not them"
  status                   text not null default 'open'
                             check (status in ('open', 'not_sure', 'keep_separate', 'merged', 'superseded')),
  note                     text check (note is null or length(btrim(note)) between 3 and 200), -- the latest Not sure comment, shown to field staff
  superseded_by_merge      uuid,
  status_before_superseded text,
  first_flagged_at         timestamptz not null default now(),
  last_flagged_at          timestamptz not null default now(),
  decided_at               timestamptz,
  decided_by               uuid references sineobex.users (id),
  check (patient_a < patient_b),
  unique (team_id, patient_a, patient_b),
  foreign key (team_id, patient_a) references sineobex.patients (team_id, id),
  foreign key (team_id, patient_b) references sineobex.patients (team_id, id)
);
create index duplicate_pairs_queue on sineobex.duplicate_pairs (team_id, status, last_flagged_at, id);
create index duplicate_pairs_a on sineobex.duplicate_pairs (team_id, patient_a);
create index duplicate_pairs_b on sineobex.duplicate_pairs (team_id, patient_b);

-- Every decision with its required comment (Oct 12), who and when. Append-only.
create table sineobex.duplicate_decisions (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references sineobex.teams (id),
  pair_id     uuid not null references sineobex.duplicate_pairs (id),
  decision    text not null check (decision in ('merge', 'keep_separate', 'not_sure', 'undo_merge', 'flagged_by_staff')),
  comment     text not null check (length(btrim(comment)) between 3 and 500),
  survivor_id uuid,
  merge_id    uuid,
  decided_by  uuid not null references sineobex.users (id),
  decided_at  timestamptz not null default now()
);
create index duplicate_decisions_pair on sineobex.duplicate_decisions (team_id, pair_id, decided_at);
create trigger duplicate_decisions_append_only before update or delete on sineobex.duplicate_decisions
  for each row execute function sineobex.forbid_mutation();

create table sineobex.patient_merges (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references sineobex.teams (id),
  pair_id           uuid not null references sineobex.duplicate_pairs (id),
  survivor_id       uuid not null,
  merged_id         uuid not null,
  filled_fields     jsonb not null default '{}',   -- {field: version} written as merge_fill or cleared_by_allergy
  reviews_opened    uuid[] not null default '{}',
  -- A merge retires no ID link (D39). Undo fills this with the links it gave back.
  restored_link_ids uuid[] not null default '{}',
  decision_id       uuid not null references sineobex.duplicate_decisions (id),
  merged_by         uuid not null references sineobex.users (id),
  merged_at         timestamptz not null default now(),
  undone_at         timestamptz,
  undone_by         uuid references sineobex.users (id),
  undo_decision_id  uuid references sineobex.duplicate_decisions (id),
  check (survivor_id <> merged_id),
  check ((undone_at is null) = (undone_by is null)),
  foreign key (team_id, survivor_id) references sineobex.patients (team_id, id),
  foreign key (team_id, merged_id) references sineobex.patients (team_id, id)
);
create unique index patient_merges_one_live on sineobex.patient_merges (team_id, merged_id) where undone_at is null;
create index patient_merges_survivor on sineobex.patient_merges (team_id, survivor_id, merged_at);
create index patient_merges_list on sineobex.patient_merges (team_id, merged_at, id);

-- The index shows the duplicate hint, so a pair's status moves the team index version.
create trigger duplicate_pairs_index_insert after insert on sineobex.duplicate_pairs
  referencing new table as changed for each statement execute function sineobex.bump_team_index();
create trigger duplicate_pairs_index_update after update on sineobex.duplicate_pairs
  referencing new table as changed for each statement execute function sineobex.bump_team_index();

-- Row-level security, second line.
do $$
declare t text;
begin
  foreach t in array array['duplicate_pairs', 'duplicate_decisions', 'patient_merges'] loop
    execute format('alter table sineobex.%I enable row level security', t);
    execute format(
      'create policy %I on sineobex.%I using (team_id = sineobex.current_team_id() or sineobex.is_platform_scope()) '
      'with check (team_id = sineobex.current_team_id() or sineobex.is_platform_scope())',
      t || '_team', t);
  end loop;
end $$;

revoke delete on sineobex.duplicate_pairs, sineobex.duplicate_decisions, sineobex.patient_merges from sineobex_app;
revoke update on sineobex.duplicate_decisions from sineobex_app;
