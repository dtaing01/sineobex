import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/date_field.dart';
import 'package:sineobex_field/features/forms/duration_field.dart';
import 'package:sineobex_field/features/forms/field_host.dart';
import 'package:sineobex_field/features/forms/flag_field.dart';
import 'package:sineobex_field/features/forms/info_field.dart';
import 'package:sineobex_field/features/forms/photo_field.dart';
import 'package:sineobex_field/features/forms/text_field.dart';
import 'package:sineobex_field/features/forms/time_field.dart';

import 'forms_test_helpers.dart';

/// The field host (forms 8.1): the widget for a field's kind, its label and help, "Waiting to send"
/// for an answer the server hasn't confirmed, and phase 2's choice when two people changed it.
void main() {
  final followUp = fieldOf({
    'id': 'follow_up',
    'kind': 'date',
    'range': 'future',
    'label': 'Follow-up date',
    'help': 'Demo: when they agreed to meet again.',
  });
  final consented = fieldOf({'id': 'consented', 'kind': 'flag', 'label': 'Patient consented'});

  forEachRun('a field shows its label, its help, Waiting to send and the choice of a conflict', (tester, run) async {
    final answers = TestAnswers({'plan.follow_up': '2026-10-27'})
      ..pending.add('plan.follow_up')
      ..conflicts['plan.follow_up'] = AnswerConflict(
        theirs: '2026-11-03',
        by: ConflictBy.teammate,
        at: DateTime.utc(2026, 10, 20, 14, 5),
        onChoose: (_) async {},
      );
    await pumpField(
      tester,
      FieldHost(field: followUp, path: 'plan.follow_up', answers: answers),
      run: run,
    );
    expect(find.text('Follow-up date'), findsOneWidget);
    expect(find.text('Demo: when they agreed to meet again.'), findsOneWidget);
    expect(find.text('Waiting to send'), findsOneWidget);
    expect(find.text('This field already had a different value. Choose which one to keep.'), findsOneWidget);
    // Both values side by side, written out.
    expect(find.text('October 27, 2026'), findsNWidgets(2));
    expect(find.text('November 3, 2026'), findsOneWidget);
    expect(find.textContaining('A teammate at '), findsOneWidget);
    await expectFieldOk(tester);
  });

  testWidgets('each kind of this card gets its own widget', (tester) async {
    final kinds = <Map<String, Object?>, Type>{
      {'id': 'a', 'kind': 'text', 'lines': 'one', 'maxLength': 200, 'label': 'Demo: a'}: NoteTextField,
      {'id': 'b', 'kind': 'flag', 'label': 'Demo: b'}: FlagField,
      {'id': 'c', 'kind': 'date', 'range': 'any', 'label': 'Demo: c'}: DateField,
      {'id': 'd', 'kind': 'time', 'label': 'Demo: d'}: TimeField,
      {'id': 'e', 'kind': 'duration', 'label': 'Demo: e'}: DurationField,
      {'id': 'f', 'kind': 'photo', 'max': 5, 'label': 'Demo: f'}: PhotoField,
      {'id': 'g', 'kind': 'info', 'label': 'Demo: g'}: InfoField,
    };
    for (final MapEntry(key: json, value: type) in kinds.entries) {
      await pumpField(tester, FieldHost(field: fieldOf(json), path: 'demo.x', answers: TestAnswers()));
      expect(find.byType(type), findsOneWidget, reason: '${json['kind']}');
    }
  });

  testWidgets('a change goes to the field’s own path', (tester) async {
    final answers = TestAnswers();
    await pumpField(tester, FieldHost(field: consented, path: 'gu.consented', answers: answers));
    await tester.tap(find.text('Patient consented'));
    await tester.pump();
    expect(answers.changes, [('gu.consented', true)]);
  });

  testWidgets('Waiting to send shows only for an answer the server hasn’t confirmed', (tester) async {
    final answers = TestAnswers({'gu.consented': true});
    await pumpField(tester, FieldHost(field: consented, path: 'gu.consented', answers: answers));
    expect(find.text('Waiting to send'), findsNothing);
    answers.pending.add('gu.consented');
    await pumpField(tester, FieldHost(field: consented, path: 'gu.consented', answers: answers));
    expect(find.text('Waiting to send'), findsOneWidget);
  });

  group('the choice of a conflict', () {
    Future<List<bool>> open(WidgetTester tester, {ConflictBy by = ConflictBy.teammate, bool paused = false}) async {
      final chosen = <bool>[];
      final answers = TestAnswers({'gu.consented': true})
        ..conflicts['gu.consented'] = AnswerConflict(
          theirs: null,
          by: by,
          onChoose: paused ? null : (keepMine) async => chosen.add(keepMine),
        );
      await pumpField(tester, FieldHost(field: consented, path: 'gu.consented', answers: answers));
      return chosen;
    }

    testWidgets('shows both values, and each button chooses, by a tap or a screen reader', (tester) async {
      final handle = tester.ensureSemantics();
      final chosen = await open(tester);
      expect(find.text('Your value'), findsOneWidget);
      expect(find.text('Yes'), findsOneWidget);
      expect(find.text('A teammate'), findsOneWidget);
      expect(find.text('(blank)'), findsOneWidget);
      for (final label in ['Use my value', 'Keep theirs']) {
        expect(
          tester.getSemantics(find.text(label)),
          isSemantics(isButton: true, hasTapAction: true, isEnabled: true, hasEnabledState: true),
        );
      }
      await tester.tap(find.text('Use my value'));
      tester.semantics.tap(find.semantics.byLabel('Keep theirs'));
      await tester.pump();
      expect(chosen, [true, false]);
      expect(find.text('Both values stay in the note’s history either way.'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('words the server’s value as phase 2 does', (tester) async {
      await open(tester, by: ConflictBy.server);
      expect(find.text('On the server'), findsOneWidget);
      expect(find.text('Keep the server’s'), findsOneWidget);
      await open(tester, by: ConflictBy.youElsewhere);
      expect(find.text('You, from another phone'), findsOneWidget);
    });

    testWidgets('can’t be chosen while charting waits for the clock, and says why', (tester) async {
      final handle = tester.ensureSemantics();
      final chosen = await open(tester, paused: true);
      expect(find.text('You can choose once the phone’s clock is right.'), findsOneWidget);
      expect(
        tester.getSemantics(find.text('Use my value')),
        isSemantics(isButton: true, isEnabled: false, hasEnabledState: true),
      );
      await tester.tap(find.text('Use my value'));
      expect(chosen, isEmpty);
      handle.dispose();
    });
  });

  forEachRun('a field with sides is answered for the right and for the left', (tester, run) async {
    final pupils = fieldOf({'id': 'reactive', 'kind': 'flag', 'label': 'Demo: reacts to light', 'sides': true});
    final answers = TestAnswers({'eyes.reactive.left': true})..pending.add('eyes.reactive.left');
    await pumpField(
      tester,
      FieldHost(field: pupils, path: 'eyes.reactive', answers: answers),
      run: run,
    );
    expect(find.text('Right'), findsOneWidget);
    expect(find.text('Left'), findsOneWidget);
    expect(find.text('Waiting to send'), findsOneWidget);
    expect(find.bySemanticsLabel('Right'), findsOneWidget);
    await tester.tap(find.text('Demo: reacts to light').first);
    await tester.pump();
    expect(answers.changes, [('eyes.reactive.right', true)]);
    await expectFieldOk(tester);
  });

  testWidgets('a disabled field is read-only, and a screen reader hears it', (tester) async {
    final handle = tester.ensureSemantics();
    final answers = TestAnswers({'plan.follow_up': '2026-10-27'})
      ..conflicts['plan.follow_up'] = AnswerConflict(theirs: null, by: ConflictBy.teammate, onChoose: (_) async {});
    await pumpField(tester, FieldHost(field: followUp, path: 'plan.follow_up', answers: answers, enabled: false));
    expect(
      tester.getSemantics(find.bySemanticsLabel('Follow-up date')),
      isSemantics(isReadOnly: true, isEnabled: false, hasEnabledState: true, value: 'October 27, 2026'),
    );
    // No choice on a field that can't change.
    expect(tester.getSemantics(find.text('Use my value')), isSemantics(isEnabled: false, hasEnabledState: true));
    expect(find.text('You can choose once the phone’s clock is right.'), findsNothing);
    await expectFieldOk(tester);
    handle.dispose();
  });

  test('an answer is written out as the read view writes it', () {
    expect(answerText(followUp, '2026-10-27'), 'October 27, 2026');
    expect(answerText(consented, true), 'Yes');
    expect(answerText(consented, null), '(blank)');
    expect(
      answerText(fieldOf({'id': 'g', 'kind': 'duration', 'max': 315, 'label': 'Demo: g'}), 268),
      '38 weeks 2 days',
    );
    expect(answerText(fieldOf({'id': 't', 'kind': 'time', 'label': 'Demo: t'}), '14:05'), '14:05');
    // A value of the wrong type is shown as it is stored, never thrown on.
    expect(answerText(fieldOf({'id': 'g', 'kind': 'duration', 'label': 'Demo: g'}), 'Demo: x'), 'Demo: x');
  });
}
