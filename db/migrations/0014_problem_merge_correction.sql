-- Module 5: merging two problem entries needs a comment (phase 3 design 3.3, 9.4), kept with the
-- other reasons in patient_corrections under its own kind. Only widens the check.

set search_path = sineobex, public, extensions;

alter table sineobex.patient_corrections drop constraint patient_corrections_kind_check;
alter table sineobex.patient_corrections add constraint patient_corrections_kind_check
  check (kind in ('identity', 'amendment_declined', 'problem_reversal', 'reversal_declined', 'review_decision',
                  'merge_undo', 'problem_merge'));
