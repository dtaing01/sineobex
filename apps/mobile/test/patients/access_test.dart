import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/patients/access.dart';

/// The server's permissions.ts answers the same vectors; a phone that disagreed would download an
/// index the server refuses, or hide a problem list the role may see.
void main() {
  final file = File('../../packages/contract/test-vectors/access.json');
  final cases = ((jsonDecode(file.readAsStringSync()) as Map<String, Object?>)['cases']! as List<Object?>)
      .cast<Map<String, Object?>>();

  test('gives every answer the shared vectors give', () {
    expect(cases, hasLength(greaterThan(10)));
    for (final c in cases) {
      final permissions = (c['permissions']! as List<Object?>).cast<String>();
      expect(hasFieldAccess(permissions), c['hasFieldAccess'], reason: '${c['name']}: hasFieldAccess');
      expect(mayHoldTeamIndex(permissions), c['mayHoldTeamIndex'], reason: '${c['name']}: mayHoldTeamIndex');
      expect(mayViewProblems(permissions), c['mayViewProblems'], reason: '${c['name']}: mayViewProblems');
    }
  });

  test('reads a set as well as the cached list', () {
    expect(mayHoldTeamIndex({'patients.view', 'checkins.create'}), isTrue);
    expect(mayViewProblems(const <String>{}), isFalse);
  });
}
