-- Module 9: the quarantine queue finds the patient of a held note or edit through the record's
-- create, which may itself be held for review, so held changes are looked up by record.

set search_path = sineobex, public, extensions;

create index quarantine_items_record on sineobex.quarantine_items (record_id);
