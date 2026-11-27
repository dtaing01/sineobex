-- Module 2: undoing a merge takes the merged record's values back out of the kept chart's field
-- reviews (phase 3 design 8.5; review finding S1). Field history is append-only, so a value is never
-- detached from its row: the review lists the rows it no longer offers. Additive only.

set search_path = sineobex, public, extensions;

-- What a merge did to field reviews, so its undo can reverse exactly that: the kept_both rows it
-- wrote on the survivor (step 4: the merged record's value, in a review it opened or joined), and
-- the merged records' open reviews it made obsolete (step 6), which its undo opens again.
alter table sineobex.patient_merges
  add column alternate_history_ids bigint[] not null default '{}',
  add column reviews_obsoleted uuid[] not null default '{}';

-- Alternates (kept_both rows carrying this review's ID) the review no longer offers: values a merge
-- undo withdrew because they came from the merged record, by the merge or by an edit sent to that
-- record while it was merged.
alter table sineobex.field_reviews
  add column withdrawn_history_ids bigint[] not null default '{}';

-- Live merges made before this migration. A merge writes in one transaction, so its kept_both rows
-- on the survivor carry the merge's time and no device (a phone's always carry one), and the
-- reviews it made obsolete carry the merge's time as decided_at.
update sineobex.patient_merges m set alternate_history_ids = coalesce((
    select array_agg(h.id order by h.id) from sineobex.field_history h
    where h.team_id = m.team_id and h.entity = 'patient' and h.record_id = m.survivor_id
      and h.kind = 'kept_both' and h.device_id is null and h.recorded_at = m.merged_at
  ), '{}')
where m.undone_at is null;

update sineobex.patient_merges m set reviews_obsoleted = coalesce((
    with recursive sub (id) as (
      select m.merged_id
      union
      select p.id from sineobex.patients p join sub on p.merged_into = sub.id where p.team_id = m.team_id
    )
    select array_agg(r.id order by r.id) from sineobex.field_reviews r
    where r.team_id = m.team_id and r.record_id in (select id from sub) and r.status = 'obsolete'
      and r.decided_at = m.merged_at
  ), '{}')
where m.undone_at is null;
