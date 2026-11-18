import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/visibility.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/field_at.dart' show definitionModel;
import 'package:sineobex_field/forms/visible.dart';

import '../sync/fake_server.dart';
import '../sync/test_note_types.dart';

/// What hangs off a note, as one reader may see it on the phone (lifecycle 5.1, 6.4 rules 2 and 6):
/// the server's rule, copied. answerHidden is held to the phone's test server's copy, which its
/// parity cases hold to the API; hiddenCorrections to the cases of the API's own tests.
void main() {
  NoteTypeDef type(TestNoteType t) =>
      NoteTypeDef.fromJson(restrictedNoteTypes.firstWhere((d) => d['key'] == t.key && d['version'] == t.version));

  NoteReader reader(String credential, Set<String> permissions, {bool author = false}) =>
      EncounterUser(userId: 'u', credential: credential, permissions: permissions).reader(actsAsAuthor: author);

  const staff = FakeSyncServer.healthcareStaff;
  final readers = <String, NoteReader>{
    'whoever acts as the author': reader('none', const {}, author: true),
    'an attending with the staff role': reader('attending', staff),
    'staff with no credential': reader('none', staff),
    'a student': reader('student', staff),
    'an admin who reads sensitive exams': reader('attending', {...staff, 'patients.view_sensitive_exams'}),
    'a role that charts and reads nothing sensitive': reader('none', const {'patients.view', 'encounters.chart'}),
    'the community health worker preset': reader('chw', FakeSyncServer.chw),
  };

  const e1 = 'e0000001';
  const at = '2026-10-20T14:50:00Z';

  test('an answer is hidden from a reader exactly when the server would hide it', () {
    final cases = <(TestNoteType, Map<String, Object?>, List<(String, Object?)>)>[
      (
        testRestricted,
        const {
          'general.notes': 'Demo: walked over',
          'exam.findings': 'Demo: no lesions seen',
          'moud.dose': 'Demo: 8 mg',
          'systems.seen': ['heart', 'gu'],
          'dx.$e1.entryAt': at,
          'dx.$e1.diagnosis.code': 'F11.20',
          'dx.$e1.diagnosis.label': 'Demo: opioid use',
          'dx.$e1.note': 'Demo: talk again next week',
        },
        [
          ('general.notes', 'Demo: back at the shelter'),
          ('exam.findings', 'Demo: a small rash'),
          ('moud.dose', 'Demo: 12 mg'),
          ('meds.given', 'Demo: one tablet'),
          ('systems.seen', ['heart']),
          ('systems.seen', ['heart', 'gu']),
          ('dx.$e1.note', 'Demo: rest and fluids'),
          ('dx.$e1.diagnosis.code', 'J02.9'),
          ('dx.$e1.entryRemoved', true),
          ('general.notes', null),
        ],
      ),
      (
        testRestricted,
        const {'general.notes': 'Demo: walked over', 'dx.$e1.entryAt': at, 'dx.$e1.diagnosis.code': 'J02.9'},
        [
          ('dx.$e1.note', 'Demo: rest and fluids'),
          ('dx.$e1.diagnosis.code', 'F11.20'),
          ('systems.seen', ['lungs']),
        ],
      ),
      (
        testAssess,
        const {
          'assess.diagnosis.code': 'F32.9',
          'assess.none': true,
          'assess.seen': ['gu'],
        },
        [
          ('assess.detail', 'Demo: low mood'),
          ('assess.seen', ['gu']),
          ('assess.seen', ['heart']),
          ('assess.none', null),
        ],
      ),
      (testSensitive, const {'talk.notes': 'Demo: talked about sleep'}, [('talk.notes', 'Demo: talked about work')]),
    ];
    var hidden = 0;
    for (final (t, answers, values) in cases) {
      final definition = type(t);
      for (final MapEntry(key: who, value: r) in readers.entries) {
        for (final (path, value) in values) {
          final expected = FakeSyncServer.answerHidden(definition, answers, path, value, r);
          if (expected) hidden++;
          expect(answerHidden(definition, answers, path, value, r), expected, reason: '${t.key} $path=$value, $who');
        }
      }
    }
    // The cases reach both answers.
    expect(hidden, inInclusiveRange(20, 200));
  });

  group('an answer that could hold what the reader may not see (lifecycle 4.4, 6.4 rule 5, 9.5)', () {
    /// Every path a note on [definition] can have an answer at, and every field's own path (a group
    /// or a grid stores nothing there), each repeating section's in one entry with its own answers,
    /// and one that names nothing.
    List<String> pathsOf(NoteTypeDef definition) => [
      for (final node in definitionModel(definition).nodes)
        for (final parts in [?node.base, for (final leaf in node.leaves) leaf.parts])
          node.section.section.repeat == null ? parts.join('.') : [parts.first, e1, ...parts.skip(1)].join('.'),
      for (final section in definition.sections)
        if (section.repeat != null) ...['${section.id}.$e1.entryAt', '${section.id}.$e1.entryRemoved'],
      'nowhere.at.all',
    ];

    test('is the server’s rule, for every path of every test note type and every reader', () {
      var held = 0, total = 0;
      for (final json in [...testNoteTypes, redFlagsNoteType, ...restrictedNoteTypes]) {
        final definition = NoteTypeDef.fromJson(json);
        for (final path in pathsOf(definition)) {
          for (final MapEntry(key: who, value: r) in readers.entries) {
            final expected = FakeSyncServer.mayHoldHidden(definition, path, r);
            total++;
            if (expected) held++;
            expect(mayHoldHidden(definition, path, r), expected, reason: '${definition.key} $path, $who');
          }
        }
      }
      // The cases reach both answers.
      expect([held, total - held], everyElement(greaterThan(40)));
    });

    // services/api/test/sync-reads.test.ts, 'every place a sensitive exam’s mark can sit is held
    // without the key, whatever the note holds: an option, its Other text, a region, a grid’s rows,
    // an entry around one'; and fake_parity_test.dart's case of that name.
    test('a sensitive exam’s mark is read-only wherever it can sit, for staff without the exam key', () {
      final marked = type(testMarked);
      const w = 'e0000003';
      final ben = readers['an attending with the staff role']!;
      final cases = <(String, bool)>[
        ('look.systems', true),
        ('look.systems_other', true),
        ('look.skin.region', true),
        ('look.rows.head', true),
        ('look.rows.rectal', true),
        ('wounds.$w.where', true),
        ('wounds.$w.entryAt', true),
        ('wounds.$w.size', false),
        ('look.notes', false),
      ];
      for (final (path, expected) in cases) {
        expect(mayHoldHidden(marked, path, ben), expected, reason: path);
        // With the key, each is the draft rule's.
        expect(mayHoldHidden(marked, path, readers['an admin who reads sensitive exams']!), isFalse, reason: path);
      }
      // Whoever acts as the author is never held by it.
      expect(
        mayHoldHidden(
          marked,
          'look.systems',
          reader('none', const {'patients.view', 'encounters.chart'}, author: true),
        ),
        isFalse,
      );
      expect(
        mayHoldHidden(marked, 'look.systems', reader('none', const {'patients.view', 'encounters.chart'})),
        isTrue,
      );
    });

    // sync-reads.test.ts, 'a set of an answer the sender may not see is held for review'.
    test(
      'a diagnosis takes its section with it without the sensitive key; a note one may not read is read-only whole',
      () {
        final restricted = type(testRestricted);
        final plain = readers['a role that charts and reads nothing sensitive']!;
        expect(
          {
            for (final path in ['general.notes', 'dx.$e1.note', 'dx.$e1.diagnosis.code', 'moud.dose', 'exam.findings'])
              path: mayHoldHidden(restricted, path, plain),
          },
          {
            'general.notes': false,
            'dx.$e1.note': true,
            'dx.$e1.diagnosis.code': true,
            'moud.dose': true,
            'exam.findings': true,
          },
        );
        // A treatment record needs a credential that charts Medical beside the key.
        expect(mayHoldHidden(restricted, 'moud.dose', readers['staff with no credential']!), isTrue);
        expect(mayHoldHidden(restricted, 'moud.dose', readers['a student']!), isFalse);
        expect(mayHoldHidden(type(testSensitive), 'talk.notes', plain), isTrue);
        expect(mayHoldHidden(type(testSensitive), 'talk.notes', readers['staff with no credential']!), isFalse);
      },
    );
  });

  group('a correction is hidden whole when a value it names is hidden from the reader', () {
    final restricted = type(testRestricted);

    StoredCorrection correction(String id, List<(String, Object?, Object?)> changes, {String? outcome}) =>
        StoredCorrection(
          id: id,
          outcome: outcome,
          changes: [for (final (path, old, value) in changes) (field: 'data.$path', oldValue: old, newValue: value)],
        );

    // services/api/test/encounters-read.test.ts, 'a correction made while its entry held a sensitive
    // diagnosis' (review finding LRD-1), as the parity case of the same name sends it.
    test('one made while its entry held a sensitive diagnosis stays hidden once the code is corrected away', () {
      const now = {
        'general.notes': 'Demo: walked over',
        'dx.$e1.entryAt': at,
        'dx.$e1.diagnosis.code': 'J02.9',
        'dx.$e1.diagnosis.label': 'Demo: sore throat',
        'dx.$e1.note': 'Demo: throat swab',
      };
      final corrections = [
        correction('first', [
          ('dx.$e1.note', 'Demo: started buprenorphine', 'Demo: buprenorphine 8 mg'),
        ], outcome: 'corrected'),
        correction('second', [
          ('dx.$e1.diagnosis.code', 'F11.20', 'J02.9'),
          ('dx.$e1.diagnosis.label', 'Demo: opioid use', 'Demo: sore throat'),
          ('dx.$e1.note', 'Demo: buprenorphine 8 mg', 'Demo: throat swab'),
        ], outcome: 'corrected'),
      ];
      expect(
        hiddenCorrections(restricted, now, readers['a role that charts and reads nothing sensitive']!, corrections),
        {'first', 'second'},
      );
      expect(hiddenCorrections(restricted, now, readers['whoever acts as the author']!, corrections), isEmpty);
      expect(hiddenCorrections(restricted, now, readers['staff with no credential']!, corrections), isEmpty);
    });

    test('one that took a sensitive exam’s option away, or changed an exam’s findings, needs the exam key', () {
      const now = {
        'general.notes': 'Demo: walked over',
        'systems.seen': ['heart'],
        'exam.findings': 'Demo: clear',
      };
      final corrections = [
        correction('picker', [
          ('systems.seen', ['heart', 'gu'], ['heart']),
        ], outcome: 'corrected'),
        correction('findings', [('exam.findings', 'Demo: a small rash', 'Demo: clear')], outcome: 'corrected'),
        correction('notes', [('general.notes', 'Demo: walked', 'Demo: walked over')], outcome: 'corrected'),
      ];
      expect(hiddenCorrections(restricted, now, readers['an attending with the staff role']!, corrections), {
        'picker',
        'findings',
      });
      expect(hiddenCorrections(restricted, now, readers['an admin who reads sensitive exams']!, corrections), isEmpty);
    });

    test('one made here, which carries no old value yet, is judged by its new one', () {
      const now = {'general.notes': 'Demo: walked over', 'exam.findings': 'Demo: clear'};
      final corrections = [
        correction('exam', [('exam.findings', null, 'Demo: a small rash')]),
        correction('notes', [('general.notes', null, 'Demo: walked over from the park')]),
      ];
      expect(hiddenCorrections(restricted, now, readers['an attending with the staff role']!, corrections), {'exam'});
    });

    test('a note the reader may not read hides every correction of it', () {
      final sensitive = type(testSensitive);
      final corrections = [
        correction('talk', [
          ('talk.notes', 'Demo: talked about sleep', 'Demo: talked about work'),
        ], outcome: 'corrected'),
      ];
      const now = {'talk.notes': 'Demo: talked about work'};
      expect(
        hiddenCorrections(sensitive, now, readers['a role that charts and reads nothing sensitive']!, corrections),
        {'talk'},
      );
      expect(hiddenCorrections(sensitive, now, readers['staff with no credential']!, corrections), isEmpty);
    });
  });
}
