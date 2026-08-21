import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex/core/util/formatting.dart';

void main() {
  group('Fmt.age', () {
    // The prototype computed `new Date().getFullYear() - birthYear`, which is
    // wrong for anyone who hasn't had this year's birthday yet (defect D10).
    test('is one lower before the birthday', () {
      expect(
        Fmt.age(DateTime(1990, 12, 31), asOf: DateTime(2026, 1, 1)),
        35,
      );
    });

    test('ticks over on the birthday itself', () {
      expect(
        Fmt.age(DateTime(1990, 6, 15), asOf: DateTime(2026, 6, 15)),
        36,
      );
    });

    test('is correct after the birthday', () {
      expect(
        Fmt.age(DateTime(1990, 1, 1), asOf: DateTime(2026, 6, 15)),
        36,
      );
    });

    test('never returns a negative age', () {
      expect(Fmt.age(DateTime(2030), asOf: DateTime(2026)), 0);
    });
  });

  group('Fmt formatting', () {
    test('isoDate matches the prototype output format', () {
      expect(Fmt.isoDate(DateTime(2026, 4, 11)), '2026-04-11');
    });

    test('orderStamp matches handleOrder', () {
      expect(
        Fmt.orderStamp(DateTime(2026, 4, 11, 9, 5)),
        '2026-04-11 09:05',
      );
    });

    test('weekday matches Intl weekday:long', () {
      expect(Fmt.weekday(DateTime(2026, 4, 11)), 'Saturday');
    });
  });
}
