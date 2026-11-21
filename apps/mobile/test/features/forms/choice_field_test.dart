import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/choice_field.dart';
import 'package:sineobex_field/features/forms/text_field.dart' show typingPause;
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A choice (forms 2.2 `choice`, 8.2): chips that wrap, each a button with its label and its
/// selected state; choose-one stores a code, choose-many a list in the definition's order; an
/// exclusive option clears the others and is cleared by another; a blocked pair is refused with one
/// line, said once; an Other option opens a private box for its text.
void main() {
  final disposition = presetField('red_flags_disposition', 'disposition.disposition') as ChoiceDef;
  final pupils = presetField('general_primary_care', 'eyes.pupils') as ChoiceDef;
  final reasons = presetField('general_primary_care', 'reason.reasons') as ChoiceDef;
  final eom = presetField('general_primary_care', 'neuro.cranial_nerves.cn_iii_iv_vi') as ChoiceDef;
  final noTransport = presetField('red_flags_disposition', 'red_flags.no_transport_reason') as ChoiceDef;
  final dispositionDef = presetDefinition('red_flags_disposition');
  final eyesDef = presetDefinition('general_primary_care');

  /// The path the form would give each field: its section and its ID.
  String pathOf(ChoiceDef f) => {
    disposition: 'disposition.disposition',
    pupils: 'eyes.pupils',
    reasons: 'reason.reasons',
    eom: 'neuro.cranial_nerves.cn_iii_iv_vi',
    noTransport: 'red_flags.no_transport_reason',
  }[f]!;

  /// Opens [field] with [answers] held as the form holds them: each change is drawn again.
  Future<TestAnswers> open(
    WidgetTester tester,
    ChoiceDef field, {
    Map<String, Object?>? values,
    bool enabled = true,
    Run? run,
  }) async {
    final answers = TestAnswers(values);
    final path = pathOf(field);
    await pumpField(
      tester,
      answering(
        answers,
        () => ChoiceField(
          field: field,
          value: answers.values[path],
          onChanged: (v) => answers.change(path, v),
          other: answers.values['${path}_other'] as String?,
          onOtherChanged: (v) => answers.change('${path}_other', v),
          enabled: enabled,
        ),
      ),
      run: run,
    );
    return answers;
  }

  /// Each change as `[path, value]`, so lists compare by what they hold.
  List<List<Object?>> changed(TestAnswers answers) => [
    for (final (path, value) in answers.changes) [path, value],
  ];

  Finder chip(String label) => find.bySemanticsLabel(label).last;

  Future<void> tapChip(WidgetTester tester, String label) async {
    await tester.ensureVisible(chip(label));
    await tester.pumpAndSettle();
    await tester.tap(chip(label));
    await tester.pumpAndSettle();
  }

  /// The labels of every live region on screen: what a screen reader would read out as it changes.
  List<String> liveLabels(WidgetTester tester) => [
    for (final node in find.semantics.byPredicate((n) => n.getSemanticsData().flagsCollection.isLiveRegion).evaluate())
      node.label,
  ];

  forEachRun('chips that wrap, at least 48 high, each a button with its label and its state', (tester, run) async {
    for (final field in [reasons, eom]) {
      final picked = field.options.first.code;
      await open(
        tester,
        field,
        values: {
          pathOf(field): field.many ? [picked] : picked,
        },
        run: run,
      );
      final width = tester.view.physicalSize.width / tester.view.devicePixelRatio;
      final tops = <double>{};
      for (final o in field.options) {
        final rect = tester.getRect(chip(o.label));
        expect(rect.height, greaterThanOrEqualTo(48), reason: o.label);
        expect(rect.right, lessThanOrEqualTo(width), reason: '${o.label} runs off the screen');
        tops.add(rect.top);
      }
      expect(tops.length, greaterThan(1), reason: 'the chips of ${field.label} are on one line');
      final first = field.options.first.label;
      expect(
        tester.getSemantics(chip(first)),
        isSemantics(
          label: first,
          isButton: true,
          hasTapAction: true,
          hasSelectedState: true,
          isSelected: true,
          hasEnabledState: true,
          isEnabled: true,
        ),
      );
      final second = field.options[1].label;
      expect(
        tester.getSemantics(chip(second)),
        isSemantics(label: second, isButton: true, hasTapAction: true, hasSelectedState: true, isSelected: false),
      );
      // The group is named by the field, so a screen reader says what the chips answer.
      expect(find.bySemanticsLabel(field.label), findsOneWidget);
      await expectFieldOk(tester);
    }
  });

  group('choose-one', () {
    testWidgets('stores the code, another replaces it, and tapping it again clears it', (tester) async {
      final answers = await open(tester, noTransport);
      final [a, b, ...] = noTransport.options;
      await tapChip(tester, a.label);
      await tapChip(tester, b.label);
      await tapChip(tester, b.label);
      expect(answers.changes.map((c) => c.$2), [a.code, b.code, null]);
    });

    testWidgets('the chips are a group of which one is picked', (tester) async {
      await open(tester, noTransport, values: {pathOf(noTransport): noTransport.options[1].code});
      final [a, b, ...] = noTransport.options;
      expect(
        tester.getSemantics(chip(a.label)),
        isSemantics(isInMutuallyExclusiveGroup: true, hasSelectedState: true, isSelected: false),
      );
      expect(
        tester.getSemantics(chip(b.label)),
        isSemantics(isInMutuallyExclusiveGroup: true, hasSelectedState: true, isSelected: true),
      );
    });
  });

  group('the picked choose-one chip says that tapping it clears it', () {
    Future<void> openPicked(WidgetTester tester, {required bool announces}) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue = FakeAccessibilityFeatures(supportsAnnounce: announces);
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await open(tester, noTransport, values: {pathOf(noTransport): noTransport.options[1].code});
    }

    testWidgets('as the tap’s hint where the reader says one (Android)', (tester) async {
      final handle = tester.ensureSemantics();
      await openPicked(tester, announces: false);
      final [a, b, ...] = noTransport.options;
      expect(tester.getSemantics(chip(b.label)), isSemantics(isSelected: true, onTapHint: 'clear', hint: ''));
      expect(tester.getSemantics(chip(a.label)).hintOverrides, isNull);
      handle.dispose();
    });

    testWidgets('as its hint elsewhere (iOS)', (tester) async {
      final handle = tester.ensureSemantics();
      await openPicked(tester, announces: true);
      final [a, b, ...] = noTransport.options;
      expect(tester.getSemantics(chip(b.label)).getSemanticsData().hint, 'Double-tap to clear.');
      expect(tester.getSemantics(chip(a.label)).getSemanticsData().hint, isEmpty);
      handle.dispose();
    });

    testWidgets('but not a choose-many chip, which unpicks as a tick does', (tester) async {
      final handle = tester.ensureSemantics();
      await open(
        tester,
        reasons,
        values: {
          pathOf(reasons): [reasons.options.first.code],
        },
      );
      final node = tester.getSemantics(chip(reasons.options.first.label));
      expect(node, isSemantics(isSelected: true, hint: ''));
      expect(node.hintOverrides, isNull);
      handle.dispose();
    });
  });

  group('choose-many', () {
    testWidgets('stores the codes in the definition’s order, whatever order they were tapped in', (tester) async {
      final answers = await open(tester, disposition);
      await tapChip(tester, 'ED');
      await tapChip(tester, 'Follow-up');
      expect(answers.changes.map((c) => c.$2), [
        ['ed'],
        ['follow_up', 'ed'],
      ]);
      for (final (_, v) in answers.changes) {
        expect(checkAnswer(dispositionDef, 'disposition.disposition', v), isNull);
      }
    });

    testWidgets('untapping the last clears the answer with null, never an empty list', (tester) async {
      final answers = await open(
        tester,
        disposition,
        values: {
          'disposition.disposition': ['ed'],
        },
      );
      await tapChip(tester, 'ED');
      expect(changed(answers), [
        ['disposition.disposition', null],
      ]);
    });

    testWidgets('each chip says whether it is selected, and is not in a group of one', (tester) async {
      await open(
        tester,
        disposition,
        values: {
          'disposition.disposition': ['ed'],
        },
      );
      expect(
        tester.getSemantics(chip('ED')),
        isSemantics(isButton: true, hasSelectedState: true, isSelected: true, isInMutuallyExclusiveGroup: false),
      );
      expect(tester.getSemantics(chip('PCP')), isSemantics(hasSelectedState: true, isSelected: false));
    });

    testWidgets('a chip acts from a screen reader’s tap as from a finger', (tester) async {
      final handle = tester.ensureSemantics();
      final answers = await open(tester, disposition);
      tester.semantics.tap(find.semantics.byLabel('PCP'));
      await tester.pumpAndSettle();
      expect(changed(answers), [
        [
          'disposition.disposition',
          ['pcp'],
        ],
      ]);
      handle.dispose();
    });

    testWidgets('two taps before the form draws again both count', (tester) async {
      final changes = <Object?>[];
      await pumpField(tester, ChoiceField(field: disposition, value: null, onChanged: changes.add));
      await tester.tap(chip('PCP'));
      await tester.tap(chip('Specialty'));
      await tester.pump();
      expect(changes, [
        ['pcp'],
        ['pcp', 'specialty'],
      ]);
    });

    testWidgets('a value changed elsewhere is shown', (tester) async {
      final answers = await open(
        tester,
        disposition,
        values: {
          'disposition.disposition': ['pcp'],
        },
      );
      answers.change('disposition.disposition', ['specialty']);
      await tester.pumpAndSettle();
      expect(tester.getSemantics(chip('PCP')), isSemantics(isSelected: false, hasSelectedState: true));
      expect(tester.getSemantics(chip('Specialty')), isSemantics(isSelected: true, hasSelectedState: true));
    });
  });

  group('an exclusive option', () {
    testWidgets('clears the others when picked', (tester) async {
      final answers = await open(
        tester,
        disposition,
        values: {
          'disposition.disposition': ['pcp', 'ed'],
        },
      );
      await tapChip(tester, 'None');
      expect(changed(answers), [
        [
          'disposition.disposition',
          ['none'],
        ],
      ]);
      expect(checkAnswer(dispositionDef, 'disposition.disposition', ['none']), isNull);
    });

    testWidgets('is cleared when another is picked', (tester) async {
      final answers = await open(
        tester,
        disposition,
        values: {
          'disposition.disposition': ['none'],
        },
      );
      await tapChip(tester, 'PCP');
      expect(changed(answers), [
        [
          'disposition.disposition',
          ['pcp'],
        ],
      ]);
    });

    testWidgets('every answer it leaves is one the server takes', (tester) async {
      final answers = await open(tester, pupils);
      final exclusive = pupils.options.firstWhere((o) => o.exclusive);
      final others = pupils.options.where((o) => !o.exclusive && !o.other).take(2).toList();
      for (final o in [others[0], exclusive, others[1], exclusive, others[0], others[1]]) {
        await tapChip(tester, o.label);
      }
      for (final (path, v) in answers.changes) {
        expect(checkAnswer(eyesDef, path, v), isNull, reason: '$v');
      }
      expect(answers.values['eyes.pupils'], [
        for (final o in pupils.options)
          if (others.contains(o)) o.code,
      ]);
    });
  });

  group('a blocked pair', () {
    const line = 'ED can’t be picked with Declined.';

    forEachRun('is not picked, and one line under the field says why', (tester, run) async {
      final answers = await open(
        tester,
        disposition,
        values: {
          'disposition.disposition': ['declined'],
        },
        run: run,
      );
      await tapChip(tester, 'ED');
      expect(answers.changes, isEmpty);
      expect(tester.getSemantics(chip('ED')), isSemantics(isSelected: false, hasSelectedState: true));
      expect(find.text(line), findsOneWidget);
      // Under the chips.
      expect(tester.getRect(find.text(line)).top, greaterThan(tester.getRect(chip('Declined')).top));
      await expectFieldOk(tester);
    });

    testWidgets('either way round', (tester) async {
      final answers = await open(
        tester,
        disposition,
        values: {
          'disposition.disposition': ['ed', 'ems'],
        },
      );
      await tapChip(tester, 'Declined');
      expect(answers.changes, isEmpty);
      // The first held option it can't go with.
      expect(find.text('Declined can’t be picked with ED.'), findsOneWidget);
    });

    testWidgets('where live regions are read (Android), the line is one, and says nothing new on a second tap', (
      tester,
    ) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(
        supportsAnnounce: false,
      );
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      final handle = tester.ensureSemantics();
      await open(
        tester,
        disposition,
        values: {
          'disposition.disposition': ['declined'],
        },
      );
      expect(liveLabels(tester), isEmpty);
      await tapChip(tester, 'ED');
      expect(liveLabels(tester), [line]);
      await tapChip(tester, 'ED');
      expect(liveLabels(tester), [line]);
      expect(tester.takeAnnouncements(), isEmpty);
      handle.dispose();
    });

    testWidgets('where the platform takes announcements (iOS), it is said once', (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(
        supportsAnnounce: true,
      );
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      final handle = tester.ensureSemantics();
      await open(
        tester,
        disposition,
        values: {
          'disposition.disposition': ['declined'],
        },
      );
      tester.takeAnnouncements();
      await tapChip(tester, 'ED');
      await tapChip(tester, 'ED');
      expect(tester.takeAnnouncements().map((a) => a.message), [line]);
      // Not a live region as well, or it would be said twice.
      expect(liveLabels(tester), isEmpty);
      // Another refusal is said: its words are new.
      await tapChip(tester, 'EMS');
      expect(tester.takeAnnouncements().map((a) => a.message), ['EMS can’t be picked with Declined.']);
      handle.dispose();
    });

    testWidgets('the line goes once something is picked or cleared', (tester) async {
      final answers = await open(
        tester,
        disposition,
        values: {
          'disposition.disposition': ['declined'],
        },
      );
      await tapChip(tester, 'ED');
      expect(find.text(line), findsOneWidget);
      await tapChip(tester, 'PCP');
      expect(find.text(line), findsNothing);
      expect(changed(answers), [
        [
          'disposition.disposition',
          ['pcp', 'declined'],
        ],
      ]);
    });
  });

  group('an Other option', () {
    final otherBox = find.byKey(const ValueKey('phi.form.no_transport_reason_other'));

    forEachRun('opens a private box for its text when picked', (tester, run) async {
      await open(tester, noTransport, run: run);
      final other = noTransport.options.firstWhere((o) => o.other);
      expect(otherBox, findsNothing);
      await tapChip(tester, other.label);
      expect(otherBox, findsOneWidget);
      expect(
        tester.getSemantics(find.bySemanticsLabel('Say what “${other.label}” is')),
        isSemantics(label: 'Say what “${other.label}” is', isTextField: true, hasTapAction: true),
      );
      // The chip says where the box is.
      expect(find.bySemanticsLabel('${other.label}, text box below'), findsOneWidget);
      final box = tester.widget<TextField>(otherBox);
      expect(box.autocorrect, isFalse);
      expect(box.enableSuggestions, isFalse);
      await expectFieldOk(tester);
    });

    testWidgets('its text is saved beside the answer, trimmed, as typing pauses', (tester) async {
      final answers = await open(tester, noTransport);
      final other = noTransport.options.firstWhere((o) => o.other);
      await tapChip(tester, other.label);
      await tester.enterText(otherBox, '  Demo: wanted to rest first  ');
      await tester.pump(typingPause);
      expect(changed(answers), [
        ['red_flags.no_transport_reason', other.code],
        ['red_flags.no_transport_reason_other', 'Demo: wanted to rest first'],
      ]);
      expect(checkAnswer(dispositionDef, 'red_flags.no_transport_reason_other', 'Demo: wanted to rest first'), isNull);
    });

    testWidgets('its text is at most 200 characters, counted as code points', (tester) async {
      final answers = await open(tester, noTransport, values: {'red_flags.no_transport_reason': 'other'});
      await tester.enterText(otherBox, '😀' * 205);
      await tester.pump(typingPause);
      final saved = answers.values['red_flags.no_transport_reason_other']! as String;
      expect(saved.runes.length, 200);
      expect(checkAnswer(dispositionDef, 'red_flags.no_transport_reason_other', saved), isNull);
    });

    testWidgets('unpicking it hides the box and keeps the text, which no longer counts', (tester) async {
      final answers = await open(
        tester,
        noTransport,
        values: {'red_flags.no_transport_reason': 'other', 'red_flags.no_transport_reason_other': 'Demo: later'},
      );
      expect(tester.widget<TextField>(otherBox).controller!.text, 'Demo: later');
      await tapChip(tester, noTransport.options.firstWhere((o) => !o.other).label);
      expect(otherBox, findsNothing);
      expect(answers.changes.map((c) => c.$1), ['red_flags.no_transport_reason']);
    });
  });

  forEachRun('disabled, it is read-only, says so, and shows what was picked', (tester, run) async {
    final answers = await open(
      tester,
      noTransport,
      values: {'red_flags.no_transport_reason': 'other', 'red_flags.no_transport_reason_other': 'Demo: later'},
      enabled: false,
      run: run,
    );
    final other = noTransport.options.firstWhere((o) => o.other);
    expect(
      tester.getSemantics(find.bySemanticsLabel(noTransport.label)),
      isSemantics(isReadOnly: true, hasEnabledState: true, isEnabled: false, value: '${other.label}: Demo: later'),
    );
    expect(find.byType(TextField), findsNothing);
    expect(find.bySemanticsLabel(other.label), findsNothing);
    expect(answers.changes, isEmpty);
    await expectFieldOk(tester);
  });

  testWidgets('disabled with nothing picked, it says it is blank', (tester) async {
    final handle = tester.ensureSemantics();
    await open(tester, disposition, enabled: false);
    expect(
      tester.getSemantics(find.bySemanticsLabel(disposition.label)),
      isSemantics(isReadOnly: true, value: 'Blank'),
    );
    handle.dispose();
  });

  testWidgets('choose-many with several picked is written in the definition’s order', (tester) async {
    final handle = tester.ensureSemantics();
    await open(
      tester,
      disposition,
      values: {
        'disposition.disposition': ['pcp', 'ed'],
      },
      enabled: false,
    );
    expect(tester.getSemantics(find.bySemanticsLabel(disposition.label)), isSemantics(value: 'PCP, ED'));
    handle.dispose();
  });

  test('pickedCodes reads what is stored, and nothing else', () {
    expect(pickedCodes(null), isEmpty);
    expect(pickedCodes('ed'), ['ed']);
    expect(pickedCodes(['pcp', 'ed']), ['pcp', 'ed']);
    expect(pickedCodes(3), isEmpty);
    expect(pickedCodes(['pcp', 3]), ['pcp']);
  });
}
