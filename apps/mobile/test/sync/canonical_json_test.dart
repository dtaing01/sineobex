import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/sync/canonical_json.dart';

/// The server's implementation wrote these vectors; matching them is what lets a receipt
/// confirm a value at all.
void main() {
  final file = File('../../packages/contract/test-vectors/canonical-json.json');
  final vectors = ((jsonDecode(file.readAsStringSync()) as Map<String, Object?>)['vectors']! as List<Object?>)
      .cast<Map<String, Object?>>();

  test('reproduces every canonical string and hash the server produces', () {
    expect(vectors, hasLength(greaterThan(30)));
    for (final v in vectors) {
      final input = v['input'];
      expect(canonicalJson(input), v['canonical'], reason: 'canonical form of ${jsonEncode(input)}');
      expect(valueHash(input), v['sha256'], reason: 'hash of ${jsonEncode(input)}');
    }
  });

  test('prints Dart doubles the way JavaScript prints numbers', () {
    expect(canonicalJson(38.0), '38');
    expect(canonicalJson(-0.0), '0');
    expect(canonicalJson(1e20), '100000000000000000000');
    expect(canonicalJson(1e21), '1e+21');
    expect(canonicalJson(0.1 + 0.2), '0.30000000000000004');
    expect(canonicalJson({'t': 38.0}), canonicalJson({'t': 38}));
  });

  test('a value the server can’t store exactly is caught before it enters the outbox', () {
    expect(storableProblem({'temp_c': 38.2, 'notes': 'fine'}), isNull);
    expect(storableProblem(maxSafeInteger), isNull);
    expect(storableProblem(maxSafeInteger + 2), isNotNull);
    expect(storableProblem(double.nan), isNotNull);
    expect(storableProblem('a\u0000b'), isNotNull);
    expect(storableProblem('broken \ud800'), isNotNull);
    expect(storableProblem('pair 🩺'), isNull);
    expect(storableProblem({1: 'x'}), isNotNull);
    expect(storableProblem(DateTime(2026)), isNotNull);
    expect(storableProblem('x' * (maxValueBytes + 1)), isNotNull);
    var deep = <Object?>[];
    for (var i = 0; i < 12; i++) {
      deep = [deep];
    }
    expect(storableProblem(deep), isNotNull);
  });
}
