import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/patients/trigram.dart';

/// Hand-checked against `pg_trgm` until trigram.json, generated from Postgres `similarity()` by the
/// matching work, lands. Postgres answers in single precision, so values compare to 1e-6.
void main() {
  test('pads each word with two spaces before and one after', () {
    expect(trigrams('smity'), {'  s', ' sm', 'smi', 'mit', 'ity', 'ty '});
    expect(trigrams('al'), {'  a', ' al', 'al '});
    expect(trigrams('a'), {'  a', ' a '});
    expect(trigrams('del smitty'), containsAll(['  d', 'el ', '  s', 'tty']));
    expect(trigrams(''), isEmpty);
  });

  test('similarity is shared trigrams over all trigrams', () {
    const cases = <(String, String, double)>[
      ('smity', 'smitty', 5 / 8), // the done-when's 0.625
      ('smitty', 'smitty', 1),
      ('jon smith', 'john smith', 8 / 13),
      ('mike', 'michael jones', 2 / 17),
      ('abc', 'xyz', 0),
      ('', 'smitty', 0),
      ('', '', 0),
    ];
    for (final (a, b, expected) in cases) {
      expect(trigramSimilarity(a, b), closeTo(expected, 1e-6), reason: '$a / $b');
      expect(trigramSimilarity(b, a), trigramSimilarity(a, b), reason: 'symmetric: $a / $b');
    }
  });

  test('a repeated word counts once, as a set', () {
    expect(trigramSimilarity('del del', 'del'), 1);
  });
}
