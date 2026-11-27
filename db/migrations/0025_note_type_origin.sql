-- Module 5 (phase 5 design 4.3, 5.1, 5.2): a note type's head names the platform note type it came
-- from, as a preset's head does (team_presets.origin_key, 0023). A platform version taken as a new
-- note type is a `t_` key, and nothing stored linked it to the platform's key: the platform's later
-- versions were decided, and offered, on the removed old key, and never on the new one. The
-- installer decides a platform key on the head that names it, and a take as new hands the old
-- head's origin to the new one.

set search_path = sineobex, public, extensions;

alter table sineobex.note_types
  add column origin_key text check (origin_key ~ '^[a-z][a-z0-9_]{1,60}$');   -- null for the team's own

comment on column sineobex.note_types.origin_key is
  'The platform note type this one came from, as 0017 names its key: its own key for one the installer '
  'wrote, the old key''s for an update taken as a new one; null for the team''s own.';

-- Filled from what is stored. A key that is not the team's own (`t_` and 12 hex characters, made by
-- the API) was written by an installer from the platform note type of the same key, or is a
-- test-only one installed as one. A `t_` key whose version 1 is a platform version was taken as new
-- from the key its take replaced, which nothing in 0017 or 0023 names: its definition is the
-- platform's, renamed to the new key, and its hash names that renamed definition. Only the take's
-- own audit event says which (note_type.platform_update_taken with `replaces`, written in the take's
-- transaction), so it is read there, and the key it replaced gives its origin up, as a take now
-- does; of two takes from one key, the later one holds it. A `t_` key the team made, blank or a copy,
-- came from no platform note type and has none, as has a `t_` key whose take left no such event,
-- which cannot be told from one the team made (every take audits in its own transaction).
--
-- A head carries the revision its own write took, and this is no write of a person or of an
-- installer: nothing a phone holds changes, so the guard and the touch trigger are off for this one
-- statement, and every other column of a head stays as it was.
alter table sineobex.note_types disable trigger note_types_revision_taken;
alter table sineobex.note_types disable trigger note_types_touch;
with taken as (
  select distinct on (a.team_id, a.details ->> 'replaces')
         a.team_id, a.entity_id as key, a.details ->> 'replaces' as replaced
  from sineobex.audit_events a
  join sineobex.note_types n on n.team_id = a.team_id and n.key = a.entity_id
  where a.action = 'note_type.platform_update_taken' and a.entity = 'note_type'
    and a.entity_id ~ '^t_[0-9a-f]{12}$' and a.details ->> 'replaces' !~ '^t_[0-9a-f]{12}$'
    and exists (select 1 from sineobex.note_types o
                where o.team_id = a.team_id and o.key = a.details ->> 'replaces')
  order by a.team_id, a.details ->> 'replaces', a.id desc
)
update sineobex.note_types h
set origin_key = case
  when h.key ~ '^t_[0-9a-f]{12}$'
    then (select t.replaced from taken t where t.team_id = h.team_id and t.key = h.key)
  when exists (select 1 from taken t where t.team_id = h.team_id and t.replaced = h.key) then null
  else h.key
end;
alter table sineobex.note_types enable trigger note_types_touch;
alter table sineobex.note_types enable trigger note_types_revision_taken;

-- One head per platform note type in a team: the one the installer decides it on.
alter table sineobex.note_types
  add constraint note_types_team_id_origin_key_key unique (team_id, origin_key);
