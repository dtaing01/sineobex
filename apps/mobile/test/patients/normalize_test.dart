import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/patients/normalize.dart';

/// Postgres `normalize_name` wrote these vectors; the server's normalize.ts reproduces them too, so
/// a name typed on the phone finds the same people the server would.
void main() {
  Map<String, Object?> read(String path) =>
      jsonDecode(File('../../packages/contract/$path').readAsStringSync()) as Map<String, Object?>;

  test('reproduces every normalized name Postgres gives', () {
    final vectors = (read('test-vectors/normalize.json')['vectors']! as List<Object?>).cast<Map<String, Object?>>();
    expect(vectors, hasLength(greaterThan(20)));
    for (final v in vectors) {
      expect(normalizeName(v['input'] as String?), v['expected'], reason: jsonEncode(v['input']));
    }
  });

  test('holds exactly the accent map generated from Postgres', () {
    final map = (read('data/unaccent-latin.json')['map']! as Map<String, Object?>).map(
      (hex, v) => MapEntry(int.parse(hex, radix: 16), v! as String),
    );
    expect(unaccentLatin, hasLength(map.length));
    map.forEach((code, v) => expect(unaccentLatin[code], v, reason: 'U+${code.toRadixString(16)}'));
  });

  test('a character outside the map separates words, and nothing left is null', () {
    expect(normalizeName('Ana\u{1F600}Ray'), 'ana ray');
    expect(normalizeName('José'), 'jose');
    for (final input in [null, '', '   ', "'-.", 'Дмитрий']) {
      expect(normalizeName(input), isNull, reason: '$input');
    }
  });

  test('splits into tokens and drops weak words unless nothing else is left', () {
    expect(tokensOf('big mike jones'), ['big', 'mike', 'jones']);
    expect(tokensOf(''), isEmpty);
    expect(scoringTokens('big mike'), ['mike']);
    expect(scoringTokens('mr jones jr'), ['jones']);
    expect(scoringTokens('big'), ['big']);
    expect(scoringTokens('the old'), ['the', 'old']);
  });
}
