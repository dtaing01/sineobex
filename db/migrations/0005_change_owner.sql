-- Module 9: who holds a change ID. Change IDs are unique across every team (sync_changes and
-- quarantine_items), but a request sees only its own team's rows, so an ID taken in another team
-- looked free until the insert hit the hidden row. This returns only the owner of an ID, never
-- the change itself, so a push or an admin's accept can refuse an ID that is someone else's.

set search_path = sineobex, public, extensions;

create function sineobex.change_owner(p_change uuid)
returns table (team_id uuid, user_id uuid, device_id uuid)
language sql stable security definer
set search_path = sineobex, pg_temp as $$
  select s.team_id, s.user_id, s.device_id from sineobex.sync_changes s where s.change_id = p_change
  union
  select q.team_id, q.user_id, q.device_id from sineobex.quarantine_items q where q.change_id = p_change
$$;
revoke all on function sineobex.change_owner(uuid) from public;
grant execute on function sineobex.change_owner(uuid) to sineobex_app;
