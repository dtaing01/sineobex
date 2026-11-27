import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/rules.dart';

/// The server's rules.ts answers the same vectors: the phone shows what a Complete did before the
/// receipt arrives, and a phone that disagreed would show a note as signed that the server kept
/// unsigned. This reader holds no answer of its own: it calls each rule with a case's input and
/// writes the answer back in the vector's own shape.
void main() {
  final file = File('../../packages/contract/test-vectors/note-lifecycle.json');
  final cases = ((jsonDecode(file.readAsStringSync()) as Map<String, Object?>)['cases']! as Map<String, Object?>).map(
    (rule, list) => MapEntry(rule, (list! as List<Object?>).cast<Map<String, Object?>>()),
  );

  NoteStatus status(Object? wire) => NoteStatus.values.byName(wire! as String);
  Attestation attestation(Object? wire) => Attestation.values.firstWhere((a) => a.code == wire);
  DateTime time(Object? wire) => DateTime.parse(wire! as String);
  Map<String, Object?> fields(Object? input) => input! as Map<String, Object?>;

  final rules = <String, Object? Function(Object? input)>{
    'signoffEffect': (input) {
      final i = fields(input);
      final effect = signoffEffect(
        noteStatus: status(i['noteStatus']),
        medicalNote: i['medicalNote']! as bool,
        act: SignoffAct.values.byName(i['act']! as String),
        actsAsAuthor: i['actsAsAuthor']! as bool,
        canSign: i['canSign']! as bool,
        needsAttestation: i['needsAttestation']! as bool,
        hashMatches: i['hashMatches']! as bool,
        emptyDraft: i['emptyDraft']! as bool,
        finishOk: i['finishOk']! as bool,
        redFlagsDone: i['redFlagsDone']! as bool,
      );
      return switch (effect) {
        SignoffRefused(:final problem) => {'refuse': problem.code},
        SignoffUnchanged(:final reason) => {'effect': 'none', 'reason': reason.code},
        SignoffApplied(:final effect, :final statusAfter, :final attestationAfter) => {
          'effect': effect.code,
          'statusAfter': statusAfter.name,
          'attestationAfter': attestationAfter.code,
        },
      };
    },
    'reopenEffect': (input) {
      final i = fields(input);
      return reopenEffect(
        noteStatus: status(i['noteStatus']),
        everSigned: i['everSigned']! as bool,
        medicalNote: i['medicalNote']! as bool,
        actsAsAuthor: i['actsAsAuthor']! as bool,
      ).code;
    },
    'correctionEffect': (input) {
      final i = fields(input);
      final after = correctionEffect(
        noteStatus: status(i['noteStatus']),
        attestation: attestation(i['attestation']),
        correctorCanSign: i['correctorCanSign']! as bool,
        correctorNeedsAttestation: i['correctorNeedsAttestation']! as bool,
      );
      return {
        'statusAfter': after.statusAfter.name,
        'attestationAfter': after.attestationAfter.code,
        'clearSignoff': after.clearSignoff,
      };
    },
    'cosignEffect': (input) {
      final i = fields(input);
      final effect = cosignEffect(
        noteStatus: status(i['noteStatus']),
        medicalNote: i['medicalNote']! as bool,
        actsAsAuthor: i['actsAsAuthor']! as bool,
        canSign: i['canSign']! as bool,
        needsAttestation: i['needsAttestation']! as bool,
        seesAllThatCounts: i['seesAllThatCounts']! as bool,
        hashMatches: i['hashMatches']! as bool,
      );
      return switch (effect) {
        CosignRefused(:final problem) => {'refuse': problem.code},
        Cosigned(:final attestationAfter) => {'statusAfter': 'signed', 'attestationAfter': attestationAfter.code},
      };
    },
    'attestEffect': (input) {
      final i = fields(input);
      final refusal = attestEffect(
        noteStatus: status(i['noteStatus']),
        attestation: attestation(i['attestation']),
        actsAsAuthor: i['actsAsAuthor']! as bool,
        isSigner: i['isSigner']! as bool,
        canAttest: i['canAttest']! as bool,
        seesAllThatCounts: i['seesAllThatCounts']! as bool,
        hashMatches: i['hashMatches']! as bool,
      );
      return refusal == null ? {'attestationAfter': 'attested'} : {'refuse': refusal.code};
    },
    'mayAssign': (input) {
      final i = fields(input);
      final refusal = mayAssign(
        actingAuthorActive: i['actingAuthorActive']! as bool,
        assigneeActive: i['assigneeActive']! as bool,
        assigneeCanChart: i['assigneeCanChart']! as bool,
        assigneeRank: i['assigneeRank']! as int,
        neededRank: i['neededRank']! as int,
        noteHasHiddenSection: i['noteHasHiddenSection']! as bool,
      );
      return refusal == null ? 'ok' : {'refuse': refusal.code};
    },
    'noteIsEmpty': (input) => noteIsEmpty(fields(input)),
    'encounterStatus': (input) => encounterStatus([
      for (final n in (input! as List<Object?>).cast<Map<String, Object?>>())
        (status: status(n['status']), medical: n['medical']! as bool, empty: n['empty']! as bool),
    ]).name,
    'envelopeLocked': (input) => envelopeLocked((input! as List<Object?>).map(status)),
    'isOverdue': (input) {
      final i = fields(input);
      return isOverdue(
        noteStatus: status(i['noteStatus']),
        startedAt: time(i['startedAt']),
        startedVerified: i['startedVerified']! as bool,
        receivedAt: i['receivedAt'] == null ? null : time(i['receivedAt']),
        now: time(i['now']),
      );
    },
  };

  test('the vectors have cases for each of the ten functions and for nothing else', () {
    expect(cases.keys, unorderedEquals(rules.keys));
  });

  for (final MapEntry(key: rule, value: call) in rules.entries) {
    test('$rule gives every answer the shared vectors give', () {
      final list = cases[rule]!;
      expect(list, hasLength(greaterThan(5)));
      for (final c in list) {
        expect(call(c['input']), c['expected'], reason: '$rule: ${c['name']}');
      }
    });
  }

  test('calls a note incomplete after 24 hours, as the server does', () {
    expect(incompleteAfterHours, 24);
  });
}
