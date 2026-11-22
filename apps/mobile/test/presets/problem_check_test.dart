import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/presets/problem_check.dart';

/// When a problem is due a status check (phase 5 design 5.3; PRD main 476) is data:
/// packages/contract/test-vectors/problem-check.json, which packages/presets/test/
/// problem-check.test.ts reads too, so the phone's problem lists mark offline what the chart marks.
/// This reader holds no answer of its own: every case runs and its answer is compared with the one
/// the file expects.
///
/// Written ahead of P2-problem-check, whose code makes it pass.
void main() {
  final cases =
      ((jsonDecode(File('../../packages/contract/test-vectors/problem-check.json').readAsStringSync())
                  as Map<String, Object?>)['cases']!
              as List<Object?>)
          .cast<Map<String, Object?>>();

  ProblemCheck problemOf(Map<String, Object?> c) {
    final p = c['problem']! as Map<String, Object?>;
    final checked = p['statusCheckedAt'] as String?;
    return (
      status: p['status']! as String,
      statusCheckedAt: checked == null ? null : DateTime.parse(checked),
      enteredInError: p['enteredInError']! as bool,
    );
  }

  test('has one name per case, both answers, every status and the shortest, usual and longest windows', () {
    expect(cases.map((c) => c['name']).toSet(), hasLength(cases.length));
    expect(cases.map((c) => c['due']).toSet(), {true, false});
    expect(cases.map((c) => (c['problem']! as Map<String, Object?>)['status']).toSet(), {'new', 'ongoing', 'resolved'});
    for (final days in [7, 90, 365]) {
      expect(cases.any((c) => c['problemCheckDays'] == days), isTrue, reason: '$days');
    }
  });

  for (final c in cases) {
    test('${c['name']}', () {
      final problem = problemOf(c);
      final now = DateTime.parse(c['now']! as String);
      expect(problemCheckDue(problem, now, c['problemCheckDays']! as int), c['due']);
      // An instant, whatever zone it was written in.
      expect(problemCheckDue(problem, now.toLocal(), c['problemCheckDays']! as int), c['due']);
    });
  }

  test('a status this phone does not know is never due: only New and Ongoing are', () {
    // The vectors' note: "true exactly when the problem is New or Ongoing".
    final checked = DateTime.utc(2024);
    for (final status in ['retired', '', 'Ongoing']) {
      expect(
        problemCheckDue((status: status, statusCheckedAt: checked, enteredInError: false), DateTime.utc(2026), 7),
        isFalse,
        reason: status,
      );
    }
    expect(
      problemCheckDue((status: 'ongoing', statusCheckedAt: checked, enteredInError: false), DateTime.utc(2026), 7),
      isTrue,
    );
  });
}
