-- Module 9: a change to a record whose create is held for review (or a note on such an encounter)
-- is held with it, for the same review, instead of being refused as a reference to a record that
-- doesn't exist. Its reason says so.

set search_path = sineobex, public, extensions;

alter table sineobex.quarantine_items drop constraint quarantine_items_reason_check;
alter table sineobex.quarantine_items add constraint quarantine_items_reason_check
  check (reason in ('access_removed', 'permission', 'awaiting_review'));
