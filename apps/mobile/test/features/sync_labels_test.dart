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

  test('every outbox category has a name', () {
    for (final entity in [...recordEntities, entityAudit]) {
      final category = categoryOf(entity);
      expect(categoryLabel(category), isNot(category), reason: entity);
    }
  });
}
