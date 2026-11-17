import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/design/theme.dart';
import 'package:sineobex_field/design/tokens.dart';
import 'package:sineobex_field/forms/definition.dart';

import '../patients/patient_kit.dart' show Run, expectPrivateFields, runName, runs;
import '../../helpers/app_harness.dart' show expectGuidelines;

export '../patients/patient_kit.dart' show Run, expectPrivateFields, runName, runs;

/// What the tests of the form's widgets share (forms 8.3): a field from a made-up definition or
/// from a bundled note type, one widget on a screen in each run (three themes, 200% text, 320
/// wide), the answers a form would hand a field, and the checks every widget must pass.

/// A field read from its JSON, as a definition's only field.
FieldDef fieldOf(Map<String, Object?> json) => NoteTypeDef.fromJson({
  'key': 'demo_form',
  'version': 1,
  'title': 'Demo form',
  'kinds': ['medical'],
  'group': 'clinical',
  'sensitivity': 'none',
  'sections': [
    {
      'id': 'demo',
      'title': 'Demo',
      'fields': [json],
    },
  ],
}).sections.single.fields.single;

final _presets = [
  for (final p in jsonDecode(File('assets/forms/presets.json').readAsStringSync()) as List<Object?>)
    NoteTypeDef.fromJson((p! as Map<String, Object?>)['definition']! as Map<String, Object?>),
];

/// The field at [path] (section, then field IDs, entry part left out) of the bundled note type [key].
FieldDef presetField(String key, String path) {
  final parts = path.split('.');
  final definition = _presets.lastWhere((d) => d.key == key);
  var fields = definition.sections.firstWhere((s) => s.id == parts.first).fields;
  late FieldDef found;
  for (final part in parts.skip(1)) {
    found = fields.firstWhere((f) => f.id == part);
    fields = found is GroupDef ? found.fields : const [];
  }
  return found;
}

/// Puts [child] on a screen of a 390 × 844 phone (320 × 640 when [run] is narrow), in [run]'s
/// theme and text size, in a scrolling list as the note form lays fields out.
Future<void> pumpField(WidgetTester tester, Widget child, {Run? run}) async {
  final r = run ?? runs.first;
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = r.narrow ? const Size(960, 1920) : const Size(1170, 2532);
  addTearDown(tester.view.reset);
  if (r.scale != 1) {
    tester.platformDispatcher.textScaleFactorTestValue = r.scale;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  }
  await tester.pumpWidget(
    MaterialApp(
      theme: buildFieldTheme(r.theme),
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        appBar: AppBar(title: const Text('Demo form')),
        body: ListView(padding: const EdgeInsets.all(FieldSpace.s4), children: [child]),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// The checks every field widget passes in every run (forms 8.2, 8.3): tap targets, labels and
/// text contrast; private text fields; nothing that scrolls sideways; no overflow.
Future<void> expectFieldOk(WidgetTester tester) async {
  expect(tester.takeException(), isNull);
  await expectGuidelines(tester);
  expectPrivateFields(tester);
  // A box of one line scrolls its own text sideways, as every text box does: that is not the page.
  final inBoxes = find.descendant(of: find.byType(EditableText), matching: find.byType(Scrollable)).evaluate().toSet();
  for (final e in find.byType(Scrollable).evaluate()) {
    if (inBoxes.contains(e)) continue;
    final axis = axisDirectionToAxis((e.widget as Scrollable).axisDirection);
    expect(axis, Axis.vertical, reason: 'a field scrolls sideways');
  }
  for (final r in tester.allRenderObjects.whereType<RenderFlex>()) {
    expect(r.toStringShort(), isNot(contains('OVERFLOWING')));
  }
}

/// The semantics node of the control a screen reader names [label], exactly.
SemanticsNode controlNamed(WidgetTester tester, Pattern label) =>
    tester.getSemantics(find.bySemanticsLabel(label).last);

/// Runs [body] once for each run, as one test each.
void forEachRun(String description, Future<void> Function(WidgetTester tester, Run run) body) {
  for (final run in runs) {
    testWidgets('$description (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      await body(tester, run);
      handle.dispose();
    });
  }
}
