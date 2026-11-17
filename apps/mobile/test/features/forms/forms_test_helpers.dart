import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/design/theme.dart';
import 'package:sineobex_field/design/tokens.dart';
import 'package:sineobex_field/features/forms/choice_field.dart';
import 'package:sineobex_field/features/forms/field_host.dart';
import 'package:sineobex_field/features/forms/flag_field.dart';
import 'package:sineobex_field/features/forms/number_field.dart';
import 'package:sineobex_field/features/forms/text_field.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/patients/patient_providers.dart' show problemCodesProvider;
import 'package:sineobex_field/patients/problems.dart' show ProblemCodes;

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

/// The latest bundled version of the note type [key].
NoteTypeDef presetDefinition(String key) => _presets.lastWhere((d) => d.key == key);

/// The field at [path] (section, then field IDs, entry part left out) of the bundled note type [key].
FieldDef presetField(String key, String path) {
  final parts = path.split('.');
  final definition = presetDefinition(key);
  var fields = definition.sections.firstWhere((s) => s.id == parts.first).fields;
  late FieldDef found;
  for (final part in parts.skip(1)) {
    found = fields.firstWhere((f) => f.id == part);
    fields = found is GroupDef ? found.fields : const [];
  }
  return found;
}

/// The answers a form hands its fields, in memory; [changes] records every change a widget made.
/// It tells its listeners of each change, so a test can draw a field again with what it stored,
/// as the form does.
class TestAnswers with ChangeNotifier implements FormAnswers {
  TestAnswers([Map<String, Object?>? values]) : values = {...?values};
  final Map<String, Object?> values;
  final Set<String> pending = {};
  final Map<String, AnswerConflict> conflicts = {};
  final List<(String, Object?)> changes = [];

  @override
  AnswerState at(String path) =>
      AnswerState(value: values[path], pending: pending.contains(path), conflict: conflicts[path]);

  @override
  void change(String path, Object? value) {
    changes.add((path, value));
    values[path] = value;
    notifyListeners();
  }
}

/// [build] drawn again each time [answers] changes, as the form draws a field with what it stored.
Widget answering(TestAnswers answers, Widget Function() build) =>
    ListenableBuilder(listenable: answers, builder: (_, _) => build());

/// The widget of a choice, number, text or tick at [path], bare, as a group or a grid draws one
/// inside it: what the field host will give them, without its label, its "Waiting to send" or its
/// conflict choice. Its changes go to [answers].
Widget kindWidget(FieldDef field, String path, TestAnswers answers, {bool enabled = true}) {
  final value = answers.values[path];
  final key = ValueKey('form.$path');
  void change(Object? v) => answers.change(path, v);
  return switch (field) {
    final ChoiceDef f => ChoiceField(
      key: key,
      field: f,
      value: value,
      onChanged: change,
      other: answers.values['${path}_other'] as String?,
      onOtherChanged: (v) => answers.change('${path}_other', v),
      enabled: enabled,
    ),
    final NumberDef f => NumberField(
      key: key,
      field: f,
      value: value is num ? value : null,
      onChanged: change,
      enabled: enabled,
    ),
    final TextDef f => NoteTextField(
      key: key,
      field: f,
      value: value is String ? value : null,
      onChanged: change,
      enabled: enabled,
    ),
    final FlagDef f => FlagField(key: key, field: f, value: value == true, onChanged: change, enabled: enabled),
    _ => throw ArgumentError('kindWidget draws a choice, number, text or tick, not a ${field.kind}'),
  };
}

/// The phone's problem code list, read straight from its file: an asset bundle decodes a file this
/// size on another isolate, which a widget test's fake clock never waits for (as the app harness).
final bundledProblemCodes = ProblemCodes.parse(File('assets/problem_codes.json').readAsStringSync());

/// Puts [child] on a screen of a 390 × 844 phone (320 × 640 when [run] is narrow), in [run]'s
/// theme and text size, in a scrolling list as the note form lays fields out. [size] puts it on a
/// screen of that many logical pixels instead (a tablet's, say). The bundled problem code list is
/// there, as on the phone.
Future<void> pumpField(WidgetTester tester, Widget child, {Run? run, Size? size}) async {
  final r = run ?? runs.first;
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = size != null ? size * 3 : (r.narrow ? const Size(960, 1920) : const Size(1170, 2532));
  addTearDown(tester.view.reset);
  if (r.scale != 1) {
    tester.platformDispatcher.textScaleFactorTestValue = r.scale;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  }
  await tester.pumpWidget(
    ProviderScope(
      overrides: [problemCodesProvider.overrideWith((ref) async => bundledProblemCodes)],
      child: MaterialApp(
        theme: buildFieldTheme(r.theme),
        debugShowCheckedModeBanner: false,
        home: Scaffold(
          appBar: AppBar(title: const Text('Demo form')),
          body: ListView(padding: const EdgeInsets.all(FieldSpace.s4), children: [child]),
        ),
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
