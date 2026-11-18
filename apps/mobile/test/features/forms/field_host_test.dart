import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/action_field.dart';
import 'package:sineobex_field/features/forms/choice_field.dart';
import 'package:sineobex_field/features/forms/date_field.dart';
import 'package:sineobex_field/features/forms/duration_field.dart';
import 'package:sineobex_field/features/forms/field_host.dart';
import 'package:sineobex_field/features/forms/flag_field.dart';
import 'package:sineobex_field/features/forms/grid_field.dart';
import 'package:sineobex_field/features/forms/group_field.dart';
import 'package:sineobex_field/features/forms/info_field.dart';
import 'package:sineobex_field/features/forms/number_field.dart';
import 'package:sineobex_field/features/forms/photo_field.dart';
import 'package:sineobex_field/features/forms/problem_field.dart';
import 'package:sineobex_field/features/forms/region_field.dart';
import 'package:sineobex_field/features/forms/text_field.dart';
import 'package:sineobex_field/features/forms/time_field.dart';
import 'package:sineobex_field/forms/definition.dart';

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
      {
        'id': 'h',
        'kind': 'choice',
        'many': false,
        'label': 'Demo: h',
        'options': [
          {'code': 'yes', 'label': 'Yes'},
        ],
      }: ChoiceField,
      {'id': 'i', 'kind': 'number', 'min': 0, 'max': 10, 'decimals': 0, 'label': 'Demo: i'}: NumberField,
      {
        'id': 'j',
        'kind': 'group',
        'layout': 'stack',
        'label': 'Demo: j',
        'fields': [
          {'id': 'k', 'kind': 'flag', 'label': 'Demo: k'},
        ],
      }: GroupField,
      {
        'id': 'l',
        'kind': 'grid',
        'label': 'Demo: l',
        'rows': [
          {'code': 'one', 'label': 'Demo: one'},
        ],
        'cell': {'id': 'm', 'kind': 'flag', 'label': 'Demo: m'},
      }: GridField,
      {
        'id': 'n',
        'kind': 'region',
        'label': 'Demo: n',
        'options': [
          {'code': 'head', 'label': 'Head'},
        ],
      }: RegionField,
      {'id': 'o', 'kind': 'problem', 'label': 'Demo: o'}: ProblemField,
      {'id': 'p', 'kind': 'action', 'action': 'add_referral', 'label': 'Demo: p'}: ActionField,
    };
    for (final MapEntry(key: json, value: type) in kinds.entries) {
      await pumpField(
        tester,
        FieldHost(field: fieldOf(json), path: 'demo.x', answers: TestAnswers(), actions: (_, _) => () {}),
      );
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

  testWidgets('a choice’s Other text goes beside it, before the side', (tester) async {
    final heard = fieldOf({
      'id': 'heard',
      'kind': 'choice',
      'many': false,
      'sides': true,
      'label': 'Demo: heard',
      'options': [
        {'code': 'clear', 'label': 'Clear'},
        {'code': 'other', 'label': 'Other', 'other': true},
      ],
    });
    final answers = TestAnswers({'lungs.heard.right': 'other', 'lungs.heard_other.right': 'Demo: a whistle'});
    await pumpField(tester, FieldHost(field: heard, path: 'lungs.heard', answers: answers));
    final box = find.byKey(const ValueKey('phi.form.heard_other'));
    expect(tester.widget<TextField>(box).controller!.text, 'Demo: a whistle');
    await tester.enterText(box, 'Demo: a squeak');
    await tester.pump(typingPause);
    expect(answers.changes.single, ('lungs.heard_other.right', 'Demo: a squeak'));
    expect(otherTextPath('lungs.heard', 'lungs.heard'), 'lungs.heard_other');
  });

  group('a choice’s Other text is an answer of its own', () {
    Map<String, Object?> pick({bool sides = false}) => {
      'id': 'pick',
      'kind': 'choice',
      'many': false,
      'sides': sides,
      'label': 'Demo: pick',
      'options': [
        {'code': 'clear', 'label': 'Clear'},
        {'code': 'other', 'label': 'Other', 'other': true},
      ],
    };

    // Waiting to send and the choice of a conflict on the Other text, written as text: its two
    // values side by side, and choosing reaches its own conflict.
    Future<void> expectShown(WidgetTester tester, Widget host, TestAnswers answers, String at) async {
      final chosen = <bool>[];
      answers
        ..pending.add(at)
        ..conflicts[at] = AnswerConflict(
          theirs: 'Demo: a squeak',
          by: ConflictBy.teammate,
          onChoose: (keepMine) async => chosen.add(keepMine),
        );
      await pumpField(tester, host);
      expect(find.text('Waiting to send'), findsOneWidget);
      expect(find.text('This field already had a different value. Choose which one to keep.'), findsOneWidget);
      // In its box, and as this phone's value beside the teammate's.
      expect(find.text('Demo: a whistle'), findsNWidgets(2));
      expect(find.text('Demo: a squeak'), findsOneWidget);
      await tester.ensureVisible(find.text('Keep theirs'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Keep theirs'));
      await tester.pump();
      expect(chosen, [false]);
    }

    testWidgets('shows its Waiting to send and its conflict, in a section', (tester) async {
      final answers = TestAnswers({'sec.pick': 'other', 'sec.pick_other': 'Demo: a whistle'});
      await expectShown(
        tester,
        FieldHost(field: fieldOf(pick()), path: 'sec.pick', answers: answers),
        answers,
        'sec.pick_other',
      );
    });

    testWidgets('shows them on its own side', (tester) async {
      final answers = TestAnswers({'sec.pick.left': 'other', 'sec.pick_other.left': 'Demo: a whistle'});
      await expectShown(
        tester,
        FieldHost(field: fieldOf(pick(sides: true)), path: 'sec.pick', answers: answers),
        answers,
        'sec.pick_other.left',
      );
    });

    testWidgets('shows them in a grid’s cell', (tester) async {
      final grid = fieldOf({
        'id': 'grid',
        'kind': 'grid',
        'label': 'Demo: grid',
        'rows': [
          {'code': 'a', 'label': 'Demo: row a'},
        ],
        'cell': pick(),
      });
      final answers = TestAnswers({'sec.grid.a': 'other', 'sec.grid.a_other': 'Demo: a whistle'});
      await expectShown(
        tester,
        FieldHost(field: grid, path: 'sec.grid', answers: answers),
        answers,
        'sec.grid.a_other',
      );
    });
  });

  testWidgets('a number labels itself, so its label is shown once', (tester) async {
    final temp = fieldOf({
      'id': 'temp',
      'kind': 'number',
      'min': 50,
      'max': 115,
      'decimals': 1,
      'unit': '°F',
      'label': 'Temperature',
    });
    await pumpField(tester, FieldHost(field: temp, path: 'vitals.temp', answers: TestAnswers({'vitals.temp': 98.6})));
    expect(find.text('Temperature'), findsOneWidget);
  });

  testWidgets('a group’s fields are hosted at their own paths, with their labels, cleared by its flag', (tester) async {
    final handle = tester.ensureSemantics();
    final measurements = presetField('wound_care', 'wound.measurements');
    const at = 'wound.e0000001.measurements';
    final answers = TestAnswers({'$at.length': 4.5, '$at.unable': true})..pending.add('$at.unable');
    await pumpField(tester, FieldHost(field: measurements, path: at, answers: answers));
    expect(find.text('Measurements'), findsOneWidget);
    expect(find.text('Waiting to send'), findsOneWidget);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Length')),
      isSemantics(isReadOnly: true, hasEnabledState: true, isEnabled: false),
    );
    await tester.tap(find.text('Unable to measure'));
    await tester.pumpAndSettle();
    expect(answers.changes, [('$at.unable', null)]);
    handle.dispose();
  });

  testWidgets('a collapsed group shows its label once, as its header, and opens when it holds an answer', (
    tester,
  ) async {
    final infection = presetField('wound_care', 'wound.infection');
    await pumpField(tester, FieldHost(field: infection, path: 'wound.e0000001.infection', answers: TestAnswers()));
    expect(find.text('Infection details'), findsOneWidget);
    expect(find.bySemanticsLabel('Infection findings'), findsNothing);
    await pumpField(
      tester,
      FieldHost(
        field: infection,
        path: 'wound.e0000002.infection',
        answers: TestAnswers({
          'wound.e0000002.infection.systemic_other': 'Demo: shivers',
          'wound.e0000002.infection.systemic': ['other'],
        }),
      ),
    );
    expect(find.bySemanticsLabel('Infection findings'), findsOneWidget);
  });

  testWidgets('a grid’s cell goes to the row and side, with its own Waiting to send and conflict', (tester) async {
    final pulses = presetDefinition('general_primary_care').sections
        .firstWhere((s) => s.id == 'cv_perfusion')
        .fields
        .firstWhere((f) => f.id == 'pulses');
    const left = 'cv_perfusion.pulses.radial.left';
    final answers = TestAnswers({left: 'two_plus'})
      ..pending.add(left)
      ..conflicts[left] = const AnswerConflict(theirs: 'one_plus', by: ConflictBy.server);
    await pumpField(tester, FieldHost(field: pulses, path: 'cv_perfusion.pulses', answers: answers));
    expect(find.text('Waiting to send'), findsOneWidget);
    expect(find.text('This field already had a different value. Choose which one to keep.'), findsOneWidget);
    final chip = find
        .descendant(
          of: find
              .descendant(
                of: find.bySemanticsLabel('Posterior tibial (PT)').first,
                matching: find.bySemanticsLabel('Right'),
              )
              .first,
          matching: find.bySemanticsLabel('0'),
        )
        .last;
    await tester.ensureVisible(chip);
    await tester.pumpAndSettle();
    await tester.tap(chip);
    await tester.pumpAndSettle();
    expect(answers.changes, [('cv_perfusion.pulses.posterior_tibial_pt.right', 'zero')]);
  });

  testWidgets('a grid of picked rows draws the rows the form gives it; a group cell’s fields follow the row', (
    tester,
  ) async {
    final general = presetDefinition('general_primary_care');
    final lymphatic = general.sections.firstWhere((s) => s.id == 'lymphatic');
    final grid = lymphatic.fields.firstWhere((f) => f.id == 'node_findings') as GridDef;
    final nodes = lymphatic.fields.firstWhere((f) => f.id == 'nodes') as ChoiceDef;
    final answers = TestAnswers();
    await pumpField(
      tester,
      FieldHost(
        field: grid,
        path: 'lymphatic.node_findings',
        answers: answers,
        rows: gridRows(grid, options: nodes.options, picked: ['inguinal']),
      ),
    );
    expect(find.bySemanticsLabel('Cervical'), findsNothing);
    final chip = find
        .descendant(of: find.bySemanticsLabel('Inguinal').first, matching: find.bySemanticsLabel('Fixed'))
        .last;
    await tester.ensureVisible(chip);
    await tester.pumpAndSettle();
    await tester.tap(chip);
    await tester.pumpAndSettle();
    expect(answers.changes.single.$1, 'lymphatic.node_findings.inguinal.findings');
  });

  testWidgets('a region’s parts go to their own paths, and a conflict on one is written in labels', (tester) async {
    final location = presetField('wound_care', 'wound.location');
    const at = 'wound.e0000001.location';
    final answers = TestAnswers({'$at.side': 'left'})
      ..conflicts['$at.side'] = const AnswerConflict(theirs: 'bilateral', by: ConflictBy.teammate);
    await pumpField(tester, FieldHost(field: location, path: at, answers: answers));
    // The chip, and their value beside the conflict's choice.
    expect(find.text('Bilateral'), findsNWidgets(2));
    expect(find.text('Left'), findsNWidgets(2));
    expect(answerText(location, 'bilateral'), 'Bilateral');
    final chip = find
        .descendant(of: find.bySemanticsLabel('Location').first, matching: find.bySemanticsLabel('Face'))
        .last;
    await tester.ensureVisible(chip);
    await tester.pumpAndSettle();
    await tester.tap(chip);
    await tester.pumpAndSettle();
    expect(answers.changes, [('$at.region', 'face')]);
  });

  group('a diagnosis', () {
    final diagnosis = presetField('general_primary_care', 'problems.diagnosis');
    const at = 'problems.e0000001.diagnosis';

    testWidgets('labels itself, and is written as its code and its label together', (tester) async {
      final answers = TestAnswers();
      await pumpField(tester, FieldHost(field: diagnosis, path: at, answers: answers));
      expect(find.text('Diagnosis or problem'), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('phi.form.diagnosis')), 'scalp laceration');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Laceration without foreign body of scalp, initial encounter (S01.01XA)'));
      await tester.pumpAndSettle();
      expect(answers.changes, [
        ('$at.code', 'S01.01XA'),
        ('$at.label', 'Laceration without foreign body of scalp, initial encounter'),
      ]);
    });

    testWidgets('shows Waiting to send for either part', (tester) async {
      final answers = TestAnswers({'$at.code': 'S01.01XA', '$at.label': 'Demo scalp'})..pending.add('$at.label');
      await pumpField(tester, FieldHost(field: diagnosis, path: at, answers: answers));
      expect(find.text('Waiting to send'), findsOneWidget);
    });

    testWidgets('a conflict on its code and its label is one choice, which keeps both of one side', (tester) async {
      final chosen = <(String, bool)>[];
      final answers = TestAnswers({'$at.code': 'S01.01XA', '$at.label': 'Demo scalp'})
        ..conflicts['$at.code'] = AnswerConflict(
          theirs: 'S00.03XA',
          by: ConflictBy.teammate,
          onChoose: (keepMine) async => chosen.add(('code', keepMine)),
        )
        ..conflicts['$at.label'] = AnswerConflict(
          theirs: 'Demo nose',
          by: ConflictBy.teammate,
          onChoose: (keepMine) async => chosen.add(('label', keepMine)),
        );
      await pumpField(tester, FieldHost(field: diagnosis, path: at, answers: answers));
      expect(find.text('This field already had a different value. Choose which one to keep.'), findsOneWidget);
      expect(find.text('Demo scalp (S01.01XA)'), findsNWidgets(2));
      expect(find.text('Demo nose (S00.03XA)'), findsOneWidget);
      await tester.ensureVisible(find.text('Keep theirs'));
      await tester.tap(find.text('Keep theirs'));
      await tester.pumpAndSettle();
      expect(chosen, [('code', false), ('label', false)]);
    });

    testWidgets('one choice can’t be chosen while either part can’t', (tester) async {
      final answers = TestAnswers({'$at.code': 'S01.01XA', '$at.label': 'Demo scalp'})
        ..conflicts['$at.code'] = AnswerConflict(theirs: 'S00.03XA', by: ConflictBy.teammate, onChoose: (_) async {})
        ..conflicts['$at.label'] = const AnswerConflict(theirs: 'Demo nose', by: ConflictBy.teammate);
      await pumpField(tester, FieldHost(field: diagnosis, path: at, answers: answers));
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Use my value')).onPressed, isNull);
      expect(find.text('You can choose once the phone’s clock is right.'), findsOneWidget);
    });
  });

  group('an action', () {
    final woundCare = presetField('general_primary_care', 'diabetic_foot.wound_care') as ActionDef;

    testWidgets('is offered with what the screen gives it for the field and its path', (tester) async {
      final asked = <(String, String)>[];
      var taps = 0;
      await pumpField(
        tester,
        FieldHost(
          field: woundCare,
          path: 'diabetic_foot.wound_care',
          answers: TestAnswers(),
          actions: (field, path) {
            asked.add((field.noteType!, path));
            return () {
              taps++;
            };
          },
        ),
      );
      expect(asked.last, ('wound_care', 'diabetic_foot.wound_care'));
      // The button carries the label: it is shown once.
      expect(find.text('Chart in Wound care'), findsOneWidget);
      await tester.tap(find.text('Chart in Wound care'));
      await tester.pumpAndSettle();
      expect(taps, 1);
    });

    testWidgets('is not offered where the screen gives it nothing to do, or gives no handler', (tester) async {
      for (final actions in <ActionHandler?>[(_, _) => null, null]) {
        await pumpField(
          tester,
          FieldHost(field: woundCare, path: 'diabetic_foot.wound_care', answers: TestAnswers(), actions: actions),
        );
        expect(find.text('Chart in Wound care'), findsNothing);
      }
    });

    testWidgets('inside a group gets the screen’s handler too', (tester) async {
      final group = fieldOf({
        'id': 'next',
        'kind': 'group',
        'layout': 'stack',
        'label': 'Demo: next',
        'fields': [
          {'id': 'go', 'kind': 'action', 'action': 'show_handoff', 'label': 'Demo: show it'},
        ],
      });
      final asked = <String>[];
      await pumpField(
        tester,
        FieldHost(
          field: group,
          path: 'demo.next',
          answers: TestAnswers(),
          actions: (field, path) {
            asked.add(path);
            return () {};
          },
        ),
      );
      expect(asked.last, 'demo.next.go');
      expect(find.text('Demo: show it'), findsOneWidget);
    });
  });
}
