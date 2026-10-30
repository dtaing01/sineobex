-- Module 9: the hand-over cap counts a person's held changes across all their phones, and the
-- review queue can be filtered to one person a page at a time, so held changes are looked up by
-- person.

set search_path = sineobex, public, extensions;

create index quarantine_items_person on sineobex.quarantine_items (team_id, user_id, status, received_at, id);
