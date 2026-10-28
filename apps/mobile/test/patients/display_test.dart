import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/patients/display.dart';
import 'package:sineobex_field/patients/dob.dart';

void main() {
  final doneWhen = jsonDecode(
    File('../../packages/contract/test-vectors/done-when.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final today = DateTime.parse(doneWhen['today']! as String);

  group('allergy badge', () {
    test('the done-when patient shows his severe penicillin allergy', () {
      final p1 = doneWhen['p1']! as Map<String, Object?>;
      final allergies = [
        for (final a in (p1['allergies']! as List<Object?>).cast<Map<String, Object?>>())
          (substance: a['substance']! as String, severity: a['severity'] as String?),
      ];
      final badge = allergyBadge(allergies, screen: p1['allergyScreen'] as String?);
      expect(badge.kind, AllergyBadgeKind.allergies);
      expect(badge.text, 'Allergy: penicillin (severe)');
      expect(badge.spoken, 'Allergy: penicillin, severe');
    });

    test('an active allergy wins over "No known allergies", whichever arrived first', () {
      final badge = allergyBadge([(substance: 'peanuts', severity: 'moderate')], screen: 'none_known');
      expect(badge.kind, AllergyBadgeKind.allergies);
      expect(badge.text, 'Allergy: peanuts');
    });

    test('severe allergies come first, and nothing is merged by text', () {
      final badge = allergyBadge([
        (substance: 'peanuts', severity: 'moderate'),
        (substance: 'PCN', severity: null),
        (substance: 'penicillin', severity: 'severe'),
      ], screen: 'not_asked');
      expect(badge.text, 'Allergies: penicillin (severe), peanuts, PCN');
      expect(badge.spoken, 'Allergies: penicillin, severe; peanuts; PCN');
      expect(badge.allergies.map((a) => a.substance), ['penicillin', 'peanuts', 'PCN']);
    });

    test('with no active allergy the screen answer shows, and nothing recorded reads as not asked', () {
      expect(allergyBadge(const [], screen: 'none_known').text, 'No known allergies');
      expect(allergyBadge(const [], screen: 'not_asked').text, 'Allergies not asked yet');
      expect(allergyBadge(const [], screen: null).kind, AllergyBadgeKind.notAsked);
      expect(allergyBadge(const [], screen: 'none_known').spoken, 'No known allergies');
    });
  });

  group('birth as recorded', () {
    test('a date gives the age and the date, a year only the year, an estimate only the age', () {
      expect(birthLabel(const BirthDate(1946, 3, 7), today), (
        text: '80 · born Mar 7, 1946',
        spoken: 'age 80, born March 7, 1946',
      ));
      expect(birthLabel(const BirthYear(1946), today), (text: 'born 1946', spoken: 'born 1946'));
      expect(birthLabel(const BirthEstimate(1980), today), (text: 'about 46', spoken: 'about 46 years old'));
    });

    test('the age turns on the birthday', () {
      expect(birthLabel(const BirthDate(1946, 10, 23), today).text, '79 · born Oct 23, 1946');
      expect(birthLabel(const BirthDate(1946, 10, 22), today).text, '80 · born Oct 22, 1946');
    });
  });
}
