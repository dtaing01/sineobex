import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/region_field.dart';
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A region (forms 2.2 `region`, 2.3): the body map as a list, until it is drawn (10.1 #3). One
/// region from the eleven of the shared list, then the side from the list the field names, then
/// front or back where the field asks; each stored at its own part, `region`, `side` and `surface`.
void main() {
  final wound = presetDefinition('wound_care');
  final skin = presetDefinition('general_primary_care');
  final woundLocation = presetField('wound_care', 'wound.location') as RegionDef;
  final skinLocation = presetField('general_primary_care', 'skin_findings.location') as RegionDef;
  final sensory = presetField('general_primary_care', 'neuro_motor.sensory_location') as RegionDef;
  final bare = fieldOf({
    'id': 'where',
    'kind': 'region',
    'label': 'Demo: where',
    'options': [
      {'code': 'head', 'label': 'Head'},
      {'code': 'feet', 'label': 'Feet'},
    ],
  }) as RegionDef;

  String pathOf(RegionDef f) => {
    woundLocation: 'wound.e0000001.location',
    skinLocation: 'skin_findings.e0000001.location',
    sensory: 'neuro_motor.sensory_location',
    bare: 'demo.where',
  }[f]!;

  /// Opens [field] with its three parts held as the form holds them, every change drawn again.
  Future<TestAnswers> open(
    WidgetTester tester,
    RegionDef field, {
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
        () => RegionField(
          field: field,
          value: regionAnswer((part) => answers.values['$path.$part']),
          onChanged: (part, code) => answers.change('$path.$part', code),
          enabled: enabled,
        ),
      ),
      run: run,
    );
    return answers;
  }

  Finder chipIn(String group, String label) =>
      find.descendant(of: find.bySemanticsLabel(group).first, matching: find.bySemanticsLabel(label)).last;

  Future<void> tapChip(WidgetTester tester, String group, String label) async {
    await tester.ensureVisible(chipIn(group, label));
    await tester.pumpAndSettle();
    await tester.tap(chipIn(group, label));
    await tester.pumpAndSettle();
  }

  forEachRun('the regions, the side and front or back, each a named group of chips', (tester, run) async {
    for (final field in [woundLocation, skinLocation, sensory]) {
      await open(
        tester,
        field,
        values: {'${pathOf(field)}.region': 'arms', '${pathOf(field)}.side': field.side!.first.code},
        run: run,
      );
      expect(find.bySemanticsLabel(field.label), findsOneWidget);
      expect(find.bySemanticsLabel('Side'), findsOneWidget);
      expect(find.bySemanticsLabel('Front or back'), field.surface == null ? findsNothing : findsOneWidget);
      expect(
        tester.getSemantics(chipIn(field.label, 'Arms')),
        isSemantics(label: 'Arms', isButton: true, hasTapAction: true, hasSelectedState: true, isSelected: true),
      );
      expect(
        tester.getSemantics(chipIn('Side', field.side!.first.label)),
        isSemantics(isButton: true, hasTapAction: true, hasSelectedState: true, isSelected: true),
      );
      await expectFieldOk(tester);
    }
  });

  testWidgets('the eleven regions of the shared list, in its order', (tester) async {
    await open(tester, woundLocation);
    final labels = [for (final o in woundLocation.options) o.label];
    expect(labels, containsAll(['Feet', 'Face', 'Groin']));
    expect(labels, hasLength(11));
    final tops = [for (final l in labels) tester.getRect(chipIn(woundLocation.label, l))];
    for (var i = 1; i < tops.length; i++) {
      // Chips wrap: each is after the one before it, on its line or a later one.
      final before = tops[i - 1];
      expect(tops[i].top > before.top || (tops[i].top == before.top && tops[i].left > before.left), isTrue);
    }
  });

  testWidgets('a region is stored at the field’s path and region, one at a time', (tester) async {
    final answers = await open(tester, woundLocation);
    await tapChip(tester, 'Location', 'Groin');
    await tapChip(tester, 'Location', 'Feet');
    expect(answers.changes, [('wound.e0000001.location.region', 'groin'), ('wound.e0000001.location.region', 'feet')]);
    for (final (path, value) in answers.changes) {
      expect(checkAnswer(wound, path, value), isNull);
    }
    // Tapping the picked region again clears it, as a choose-one does.
    await tapChip(tester, 'Location', 'Feet');
    expect(answers.changes.last, ('wound.e0000001.location.region', null));
  });

  testWidgets('the side is stored at side, from the list the field names', (tester) async {
    final answers = await open(tester, skinLocation);
    expect([for (final o in skinLocation.side!) o.label], ['Right', 'Left', 'Midline']);
    await tapChip(tester, 'Side', 'Midline');
    expect(answers.changes, [('skin_findings.e0000001.location.side', 'midline')]);
    expect(checkAnswer(skin, answers.changes.single.$1, answers.changes.single.$2), isNull);
  });

  testWidgets('front or back is stored at surface', (tester) async {
    final answers = await open(tester, woundLocation);
    await tapChip(tester, 'Front or back', 'Posterior');
    expect(answers.changes, [('wound.e0000001.location.surface', 'posterior')]);
    expect(checkAnswer(wound, answers.changes.single.$1, answers.changes.single.$2), isNull);
  });

  testWidgets('each part is its own answer: picking one leaves the others', (tester) async {
    final answers = await open(
      tester,
      woundLocation,
      values: {'wound.e0000001.location.side': 'left', 'wound.e0000001.location.surface': 'anterior'},
    );
    await tapChip(tester, 'Location', 'Hands');
    expect(answers.changes, [('wound.e0000001.location.region', 'hands')]);
    expect(tester.getSemantics(chipIn('Side', 'Left')), isSemantics(isSelected: true, hasSelectedState: true));
  });

  testWidgets('a field without a side or a surface asks for neither', (tester) async {
    await open(tester, bare);
    expect(find.bySemanticsLabel('Side'), findsNothing);
    expect(find.bySemanticsLabel('Front or back'), findsNothing);
    expect(find.text('Side'), findsNothing);
    await expectFieldOk(tester);
  });

  testWidgets('the side and front or back have headings a sighted reader sees', (tester) async {
    await open(tester, woundLocation);
    expect(find.text('Side'), findsOneWidget);
    expect(find.text('Front or back'), findsOneWidget);
  });

  testWidgets('disabled, it is read-only, says so, and reads as the read view writes it', (tester) async {
    final handle = tester.ensureSemantics();
    final answers = await open(
      tester,
      woundLocation,
      enabled: false,
      values: {
        'wound.e0000001.location.region': 'arms',
        'wound.e0000001.location.side': 'right',
        'wound.e0000001.location.surface': 'anterior',
      },
    );
    expect(
      tester.getSemantics(find.bySemanticsLabel('Location')),
      isSemantics(label: 'Location', value: 'Arms, Right, Anterior', isReadOnly: true, isEnabled: false),
    );
    expect(find.bySemanticsLabel('Side'), findsNothing);
    await tester.tap(find.text('Arms, Right, Anterior'));
    expect(answers.changes, isEmpty);
    await expectFieldOk(tester);
    handle.dispose();
  });

  testWidgets('regionText and regionAnswer', (tester) async {
    expect(regionText(woundLocation, (region: 'feet', side: null, surface: 'posterior')), 'Feet, Posterior');
    expect(regionText(woundLocation, (region: null, side: null, surface: null)), isNull);
    // A code the lists do not hold is shown as stored.
    expect(regionText(woundLocation, (region: 'demo_elbow', side: null, surface: null)), 'demo_elbow');
    final stored = {'region': 'head', 'side': 7, 'surface': null};
    expect(regionAnswer((part) => stored[part]), (region: 'head', side: null, surface: null));
  });
}
