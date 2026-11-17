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

  test('every outbox category has a name', () {
    for (final entity in [...recordEntities, entityAudit]) {
      final category = categoryOf(entity);
      expect(categoryLabel(category), isNot(category), reason: entity);
    }
  });
}
