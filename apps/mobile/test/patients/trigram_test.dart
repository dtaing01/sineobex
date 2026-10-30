import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/patients/trigram.dart';

/// Postgres `pg_trgm` wrote these vectors in single precision, so they compare to the file's
/// tolerance; the server's trigram.ts reads the same file.
void main() {
  final file =
      jsonDecode(File('../../packages/contract/test-vectors/trigram.json').readAsStringSync()) as Map<String, Object?>;
  final tolerance = (file['tolerance']! as num).toDouble();
  final vectors = (file['vectors']! as List<Object?>).cast<Map<String, Object?>>();

  test('reproduces every similarity Postgres gives', () {
    expect(vectors, hasLength(greaterThan(10)));
    for (final v in vectors) {
      final a = v['a']! as String;
      final b = v['b']! as String;
      final expected = (v['similarity']! as num).toDouble();
      expect(trigramSimilarity(a, b), closeTo(expected, tolerance), reason: '$a / $b');
      expect(trigramSimilarity(b, a), trigramSimilarity(a, b), reason: 'symmetric: $a / $b');
    }
  });

  test('pads each word with two spaces before and one after', () {
    expect(trigrams('smity'), {'  s', ' sm', 'smi', 'mit', 'ity', 'ty '});
    expect(trigrams('a'), {'  a', ' a '});
    expect(trigrams(''), isEmpty);
    expect(trigramSimilarity('', 'smitty'), 0);
    expect(trigramSimilarity('del del', 'del'), 1);
  });
}
