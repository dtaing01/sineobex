import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/sync/sync_labels.dart';
import 'package:sineobex_field/sync/entities.dart';

/// Needs attention names a change by its kind of record and the unsynced summary by its category:
/// a kind added to the registry without words would show "A record" or a raw key.
void main() {
  test('every kind of record has a heading', () {
    for (final entity in recordEntities) {
      expect(entityLabel(entity), isNot('A record'), reason: entity);
    }
  });

  test('the notices of a note’s life are worded by their kind alone (lifecycle 3.4, 9.13)', () {
    expect(noticeLabel('change_not_applied', null), 'Only the note’s author can do that. Nothing was changed.');
    expect(
      noticeLabel('signoff_not_applied', null),
      'Your Complete of this note wasn’t applied. Open it and complete it again.',
    );
    expect(
      noticeLabel('finished_differently', null),
      'This note was already finished with different content. Open it and read what was finished.',
    );
  });

  test('each problem a worker can fix has the design’s sentence (lifecycle 4.1, 9.13)', () {
    const sentences = {
      'content_changed': 'This note changed after you completed it. Open it, read it and complete it again.',
      'incomplete': 'This is missing something the note needs. Open the note and try again.',
      'red_flags_first': 'Answer the red-flag question first, then complete again.',
      'field_changed': 'Someone corrected this answer first. Open the note and check it.',
      'medical_note_needs_patient': 'A clinical note needs a patient. Choose who this visit is for.',
      'unknown_note_type': 'This note type isn’t on your team’s list. Choose the note type again.',
      'definition_error': 'This couldn’t be checked. Tell a Program Admin.',
      'encounter_note_missing': 'The note this belongs to isn’t on the team’s list.',
      'note_signoff_missing': 'The note this belongs to isn’t on the team’s list.',
      'encounter_other_patient': 'The visit this names belongs to someone else.',
    };
    for (final MapEntry(key: problem, value: sentence) in sentences.entries) {
      expect(problemLabel(problem), sentence, reason: problem);
    }
    // An answer its note type refuses (forms 7.1), whichever rule.
    for (final problem in [
      'unknown_path',
      'wrong_type',
      'unknown_option',
      'out_of_range',
      'too_long',
      'excluded_pair',
      'exclusive_with_others',
    ]) {
      expect(problemLabel(problem), 'This answer doesn’t fit the note’s form. Open the note and change it.');
    }
  });

  test('every notice of a note’s life has a sentence of its own (lifecycle 4.10, 9.13)', () {
    expect(
      noticeLabel('note_saved_unsigned', null),
      'Your credential can’t sign this note type. It was saved unsigned for a co-signer.',
    );
    expect(
      noticeLabel('late_change_kept', null),
      'The note was already finished. Your change was kept in its history. Add an addendum if it matters.',
    );
    expect(noticeLabel('note_corrected', null), 'A note you signed was corrected. It needs your review again.');
    const fallback = 'Something changed after it synced.';
    for (final kind in ['note_cosigned', 'note_attested', 'note_assigned']) {
      expect(noticeLabel(kind, null), isNot(fallback), reason: kind);
    }
  });

  test('every outbox category has a name', () {
    for (final entity in [...recordEntities, entityAudit]) {
      final category = categoryOf(entity);
      expect(categoryLabel(category), isNot(category), reason: entity);
    }
  });
}
