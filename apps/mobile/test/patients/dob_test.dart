import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/patients/dob.dart';

/// The portal's dob.ts gives the same answers: a birth typed on the phone and corrected on the
/// portal must be understood the same way.
void main() {
  final file = File('../../packages/contract/test-vectors/dob.json');
  final vectors = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
  final today = DateTime.parse(vectors['today']! as String);
  final cases = (vectors['cases']! as List<Object?>).cast<Map<String, Object?>>();

  BirthMode mode(Map<String, Object?> c) => BirthMode.values.byName(c['mode']! as String);

  test('gives every answer the shared vectors give', () {
    expect(cases, hasLength(greaterThan(20)));
    for (final c in cases) {
      final why = '${c['mode']} "${c['input']}"';
      final result = parseBirth(c['input']! as String, mode(c), today);
      if (c.containsKey('error')) {
        expect(result, isA<BirthError>(), reason: why);
        final error = result as BirthError;
        expect(error.problem.code, c['error'], reason: why);
        if (c.containsKey('message')) expect(error.message, c['message'], reason: why);
        expect(error.message, isNot(contains(c['input']! as String)), reason: '$why: never echoes the input');
      } else {
        expect(result, isA<ParsedBirth>(), reason: why);
        final parsed = result as ParsedBirth;
        expect(parsed.birth.toJson(), c['birth'], reason: why);
        expect(parsed.readBack, c['readBack'], reason: why);
        expect(parsed.needsConfirmation, c['needsConfirmation'], reason: why);
      }
    }
  });

  test('knows every error code the vectors name', () {
    expect([for (final p in BirthProblem.values) p.code], unorderedEquals(vectors['errors']! as List<Object?>));
  });

  test('reads spaces, dots and stray whitespace as separators', () {
    for (final input in ['3.7.46', '3 7 46', ' 3 / 7 / 46 ', '03/07/1946']) {
      final result = parseBirth(input, BirthMode.date, today);
      expect(result, isA<ParsedBirth>(), reason: input);
      expect((result as ParsedBirth).birth, const BirthDate(1946, 3, 7), reason: input);
    }
    for (final input in ['', '3/7', '3//7/46', '003/7/46', '37146', '3/1946', '46 years']) {
      expect(
        parseBirth(input, BirthMode.date, today),
        isA<BirthError>().having((e) => e.problem, 'problem', BirthProblem.unreadable),
        reason: input,
      );
    }
    expect(
      parseBirth('4', BirthMode.date, today),
      isA<BirthError>().having((e) => e.problem, 'problem', BirthProblem.badYear),
    );
  });

  test('checks the day against the month and the leap year it lands in', () {
    String? message(String input) => switch (parseBirth(input, BirthMode.date, today)) {
      BirthError(:final message) => message,
      ParsedBirth() => null,
    };
    expect(message('4/31/1980'), 'April has 30 days.');
    expect(message('2/29/1981'), '1981 isn’t a leap year, so February has 28 days.');
    expect(message('2/29/1980'), isNull);
    // 2/29/00 is 2000, a leap year (1900 was not).
    expect(message('2/29/00'), isNull);
    expect(message('1/0/1980'), 'There is no day 0.');
  });

  test('a two-digit year is never in the future, whatever the day', () {
    final jan1 = DateTime(2027);
    expect((parseBirth('1/1/27', BirthMode.date, jan1) as ParsedBirth).birth, const BirthDate(2027, 1, 1));
    expect((parseBirth('1/2/27', BirthMode.date, jan1) as ParsedBirth).birth, const BirthDate(1927, 1, 2));
    expect((parseBirth('27', BirthMode.date, jan1) as ParsedBirth).birth, const BirthYear(1927));
    expect((parseBirth('26', BirthMode.date, jan1) as ParsedBirth).birth, const BirthYear(2026));
  });

  test('a stored birth round-trips through its sync value', () {
    for (final b in const [BirthDate(1946, 3, 7), BirthYear(1946), BirthEstimate(1980)]) {
      expect(Birth.fromJson(b.toJson()), b);
    }
    expect(Birth.fromJson(null), isNull);
    expect(Birth.fromJson({'precision': 'decade', 'year': 1940}), isNull);
    expect(Birth.fromJson({'precision': 'day', 'date': '1946-3-7'}), isNull);
    expect(const BirthDate(1946, 3, 7).iso, '1946-03-07');
  });

  test('works out an age to the day', () {
    expect(ageOn(const BirthDate(1946, 10, 22), today), 80);
    expect(ageOn(const BirthDate(1946, 10, 23), today), 79);
    expect(ageOn(const BirthYear(1946), today), 80);
    expect(ageOn(const BirthEstimate(1980), today), 46);
  });
}
