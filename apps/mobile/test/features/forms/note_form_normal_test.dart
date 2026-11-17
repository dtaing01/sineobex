import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/conditions.dart' show Answers;
import 'package:sineobex_field/forms/normal.dart';

import 'forms_test_helpers.dart';

/// One-tap Normal (forms 6.3, 7.1, 10.3 #7): a section that offers it has a Normal that writes what
/// normalAnswers gives, one answer at a time through the form's callback, and a repeating one has
/// a Normal in each entry. A system whose exam is split over sections (Cardiac, HEENT, MSK,
/// Neuro) also has one Normal for the whole system, which runs normalAnswers on each of its
/// sections and each entry of a repeating one, so the person sees the PRD's one tap.
void main() {
  final general = presetDefinition('general_primary_care');
  const e1 = 'e0000001';
  const e2 = 'e0000002';

  /// What Normal writes for these sections (an entry where one is named), one after another, each
  /// seeing the answers written before it.
  List<(String, Object?)> expected(Answers values, List<(String, String?)> targets) {
    final working = {...values};
    final out = <(String, Object?)>[];
    for (final (section, entry) in targets) {
      for (final MapEntry(:key, :value) in normalAnswers(general, section, working, entry).entries) {
        out.add((key, value));
        working[key] = value;
      }
    }
    return out;
  }

  /// Changes as lists, so a choose-many's codes are compared by what they hold.
  List<List<Object?>> plain(List<(String, Object?)> changes) => [
    for (final (path, value) in changes) [path, value],
  ];

  Future<void> tapNamed(WidgetTester tester, String label) async {
    final found = find.bySemanticsLabel(label);
    await tester.ensureVisible(found);
    await tester.pumpAndSettle();
    await tester.tap(found);
    await tester.pumpAndSettle();
  }

  List<String> liveLines(WidgetTester tester) => [
    for (final node in find.semantics.byPredicate((n) => n.getSemanticsData().flagsCollection.isLiveRegion).evaluate())
      node.label,
  ];

  final cardiac = <String, Object?>{
    'exam.systems': ['cardiovascular'],
  };

  forEachRun('a section that offers Normal has it, labelled, and so has a system over sections', (tester, run) async {
    final handle = tester.ensureSemantics();
    await pumpForm(tester, general, run: run, values: cardiac, openSection: 'heart');
    for (final label in ['All normal, Heart rate, rhythm and sounds', 'All normal, Cardiac']) {
      expect(controlNamed(tester, label), isSemantics(isButton: true, hasTapAction: true), reason: label);
    }
    await expectFieldOk(tester);
    await tapNamed(tester, 'All normal, Cardiac');
    await expectFieldOk(tester);
    handle.dispose();
  });

  testWidgets('Normal writes what normalAnswers gives the section, one answer at a time', (tester) async {
    final handle = tester.ensureSemantics();
    final values = {...cardiac, 'heart.rate': 'tachycardic'};
    final answers = await pumpForm(tester, general, values: values, openSection: 'heart');
    final want = expected(values, [('heart', null)]);
    expect(want, isNotEmpty);
    await tapNamed(tester, 'All normal, Heart rate, rhythm and sounds');
    expect(plain(answers.changes), plain(want));
    // What was charted stays.
    expect(answers.values['heart.rate'], 'tachycardic');
    expect(find.text('${want.length} answers filled as normal.'), findsOneWidget);
    // Again: nothing is left to fill, and nothing is written.
    await tapNamed(tester, 'All normal, Heart rate, rhythm and sounds');
    expect(plain(answers.changes), plain(want));
    expect(find.text('Nothing left for Normal to fill.'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('a section that does not offer Normal has none', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpForm(
      tester,
      general,
      values: {
        'exam.systems': ['skin'],
        'skin_findings.$e1.entryAt': '2026-11-17T10:00:00Z',
      },
      openSection: 'skin_findings',
    );
    expect(find.text('All normal'), findsNothing);
    await toggleSection(tester, 'exam');
    expect(find.text('All normal'), findsNothing);
    // Skin is one section: its own Normal is the system's.
    await toggleSection(tester, 'skin');
    expect(find.bySemanticsLabel('All normal, Skin'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('a repeating section has a Normal in each entry, for that entry', (tester) async {
    final handle = tester.ensureSemantics();
    final values = <String, Object?>{
      'exam.systems': ['msk'],
      'msk.$e1.entryAt': '2026-11-17T10:00:00Z',
      'msk.$e1.region': 'knee',
      'msk.$e1.side': 'right',
      'msk.$e2.entryAt': '2026-11-17T10:05:00Z',
      'msk.$e2.region': 'back',
    };
    final answers = await pumpForm(tester, general, values: values, openSection: 'msk');
    expect(find.bySemanticsLabel('All normal, Musculoskeletal'), findsNothing);
    await tapNamed(tester, 'All normal, Region 2');
    final want = expected(values, [('msk', e2)]);
    expect(want, isNotEmpty);
    expect(want.map((c) => c.$1), everyElement(startsWith('msk.$e2.')));
    expect(plain(answers.changes), plain(want));
    handle.dispose();
  });

  testWidgets('a system’s Normal runs on each of its sections', (tester) async {
    final handle = tester.ensureSemantics();
    final answers = await pumpForm(tester, general, values: cardiac, openSection: 'reason');
    await tapNamed(tester, 'All normal, Cardiac');
    final want = expected(cardiac, [('heart', null), ('cv_perfusion', null)]);
    expect({for (final c in want) c.$1.split('.').first}, {'heart', 'cv_perfusion'});
    expect(plain(answers.changes), plain(want));
    expect(find.text('${want.length} answers filled as normal.'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('HEENT’s Normal runs on its four sections', (tester) async {
    final handle = tester.ensureSemantics();
    final heent = <String, Object?>{
      'exam.systems': ['heent'],
    };
    final answers = await pumpForm(tester, general, values: heent);
    await tapNamed(tester, 'All normal, HEENT');
    final want = expected(heent, [('eyes', null), ('ears', null), ('nose', null), ('mouth', null)]);
    expect({for (final c in want) c.$1.split('.').first}, {'eyes', 'ears', 'nose', 'mouth'});
    expect(plain(answers.changes), plain(want));
    handle.dispose();
  });

  testWidgets('MSK’s Normal runs on each region’s entry and on gait', (tester) async {
    final handle = tester.ensureSemantics();
    final values = <String, Object?>{
      'exam.systems': ['msk'],
      'msk.$e1.entryAt': '2026-11-17T10:00:00Z',
      'msk.$e1.region': 'knee',
      'msk.$e1.side': 'right',
      'msk.$e2.entryAt': '2026-11-17T10:05:00Z',
      'msk.$e2.region': 'back',
    };
    final answers = await pumpForm(tester, general, values: values);
    await tapNamed(tester, 'All normal, MSK');
    final want = expected(values, [('msk', e1), ('msk', e2), ('msk_gait', null)]);
    expect(want.where((c) => c.$1.startsWith('msk.$e1.')), isNotEmpty);
    expect(want.where((c) => c.$1.startsWith('msk.$e2.')), isNotEmpty);
    expect(want.where((c) => c.$1.startsWith('msk_gait.')), isNotEmpty);
    expect(plain(answers.changes), plain(want));
    handle.dispose();
  });

  group('on a made-up exam', () {
    Map<String, Object?> choice(String id, String label, {Map<String, Object?>? showWhen}) => {
      'id': id,
      'kind': 'choice',
      'label': label,
      'many': false,
      'options': [
        {'code': 'ok', 'label': 'Demo: fine', 'normal': true},
        {'code': 'off', 'label': 'Demo: not fine'},
      ],
      'showWhen': ?showWhen,
    };
    final exam = definitionOf([
      {
        'id': 'pick',
        'title': 'Demo: examined',
        'fields': [
          {
            'id': 'systems',
            'kind': 'choice',
            'label': 'Demo: what was examined',
            'many': true,
            'options': [
              {'code': 'limbs', 'label': 'Demo limbs'},
            ],
          },
        ],
      },
      {
        'id': 'arms',
        'title': 'Demo: arms',
        'normal': true,
        'showWhen': {'field': 'pick.systems', 'is': 'limbs'},
        'fields': [choice('look', 'Demo: look')],
      },
      {
        'id': 'legs',
        'title': 'Demo: legs',
        'normal': true,
        'needs': 'orderMedications',
        'showWhen': {'field': 'pick.systems', 'is': 'limbs'},
        'fields': [
          // Asked only once the arms are fine: Normal on the system fills it, having filled the arms.
          choice('walk', 'Demo: walk', showWhen: {'field': 'arms.look', 'is': 'ok'}),
        ],
      },
    ]);
    final picked = <String, Object?>{
      'pick.systems': ['limbs'],
    };

    testWidgets('each section sees what Normal wrote in the ones before it', (tester) async {
      final handle = tester.ensureSemantics();
      final answers = await pumpForm(tester, exam, values: picked, capabilities: {'orderMedications'});
      await tapNamed(tester, 'All normal, Demo limbs');
      expect(answers.changes, [('arms.look', 'ok'), ('legs.walk', 'ok')]);
      handle.dispose();
    });

    testWidgets('a system with one section drawn has no Normal of its own', (tester) async {
      final handle = tester.ensureSemantics();
      await pumpForm(tester, exam, values: picked, openSection: 'arms');
      expect(find.bySemanticsLabel('All normal, Demo limbs'), findsNothing);
      expect(find.bySemanticsLabel('All normal, Demo: arms'), findsOneWidget);
      handle.dispose();
    });
  });

  testWidgets('a system’s Normal skips what is not drawn', (tester) async {
    final handle = tester.ensureSemantics();
    // Cardiac is not picked: its sections don't show, so neither does its Normal.
    await pumpForm(
      tester,
      general,
      values: {
        'exam.systems': ['heent'],
      },
    );
    expect(find.bySemanticsLabel('All normal, Cardiac'), findsNothing);
    handle.dispose();
  });

  testWidgets('where live regions are read (Android), what Normal did is a live line', (tester) async {
    tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(supportsAnnounce: false);
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    final handle = tester.ensureSemantics();
    await pumpForm(tester, general, values: cardiac, openSection: 'heart');
    expect(liveLines(tester), isEmpty);
    await tapNamed(tester, 'All normal, Heart rate, rhythm and sounds');
    expect(liveLines(tester), [matches(RegExp(r'^\d+ answers filled as normal\.$'))]);
    expect(tester.takeAnnouncements(), isEmpty);
    handle.dispose();
  });

  testWidgets('where the platform takes announcements (iOS), what Normal did is said', (tester) async {
    tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(supportsAnnounce: true);
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    final handle = tester.ensureSemantics();
    await pumpForm(tester, general, values: cardiac, openSection: 'heart');
    tester.takeAnnouncements();
    await tapNamed(tester, 'All normal, Heart rate, rhythm and sounds');
    expect(tester.takeAnnouncements().map((a) => a.message), [matches(RegExp(r'^\d+ answers filled as normal\.$'))]);
    // Not a live region as well, or it would be said twice.
    expect(liveLines(tester), isEmpty);
    handle.dispose();
  });

  testWidgets('a read-only form offers no Normal', (tester) async {
    await pumpForm(tester, general, values: cardiac, openSection: 'heart', enabled: false);
    expect(find.text('All normal'), findsNothing);
  });
}
