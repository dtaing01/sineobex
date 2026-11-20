import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/design/theme.dart';
import 'package:sineobex_field/design/tokens.dart';
import 'package:sineobex_field/features/forms/action_field.dart' show ActionHandler;
import 'package:sineobex_field/features/forms/choice_field.dart';
import 'package:sineobex_field/features/forms/field_host.dart';
import 'package:sineobex_field/features/forms/flag_field.dart';
import 'package:sineobex_field/features/forms/note_form.dart';
import 'package:sineobex_field/features/forms/number_field.dart';
import 'package:sineobex_field/features/forms/text_field.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/patients/patient_providers.dart' show problemCodesProvider;
import 'package:sineobex_field/patients/problems.dart' show ProblemCodes;

import '../patients/patient_kit.dart' show Run, expectPrivateFields, runName, runs;
import '../../helpers/app_harness.dart' show expectGuidelines;

export '../patients/patient_kit.dart' show Run, expectPrivateFields, runName, runs;
export '../../helpers/app_harness.dart' show expectGuidelines;

/// What the tests of the form's widgets share (forms 8.3): a field from a made-up definition or
/// from a bundled note type, one widget on a screen in each run (three themes, 200% text, 320
/// wide), the answers a form would hand a field, and the checks every widget must pass.

/// A made-up note type with these sections, each read from its JSON.
NoteTypeDef definitionOf(List<Map<String, Object?>> sections) => NoteTypeDef.fromJson({
  'key': 'demo_form',
  'version': 1,
  'title': 'Demo form',
  'kinds': ['medical'],
  'group': 'clinical',
  'sensitivity': 'none',
  'sections': sections,
});

/// A field read from its JSON, as a definition's only field.
FieldDef fieldOf(Map<String, Object?> json) => definitionOf([
  {
    'id': 'demo',
    'title': 'Demo',
    'fields': [json],
  },
]).sections.single.fields.single;

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
  expectReadOnlyReadable(tester);
}

/// The words of what can't be changed, measured directly: the text contrast guideline skips a node
/// that is not enabled, which a read-only answer and a disabled tick are, and every answer on a
/// finished note is one (accessibility: 4.5:1, 7:1 in High contrast). A read-only answer is
/// measured on its sunken box; a tick on the surface and the ground a form may draw it on.
void expectReadOnlyReadable(WidgetTester tester) {
  void measure(Finder within, List<Color> Function(FieldColors c) backgrounds) {
    for (final e in within.evaluate()) {
      final palette = Theme.of(e).extension<FieldPalette>()!;
      final c = palette.colors;
      final minimum = palette.theme == FieldTheme.contrast ? 7.0 : 4.5;
      final words = find.descendant(of: find.byWidget(e.widget), matching: find.byType(RichText));
      for (final paragraph in tester.renderObjectList<RenderParagraph>(words)) {
        final colors = <Color>[];
        paragraph.text.visitChildren((span) {
          if (span is TextSpan && (span.text?.trim().isNotEmpty ?? false)) {
            if (span.style?.color case final color?) colors.add(color);
          }
          return true;
        });
        // A span without its own colour takes its paragraph's.
        colors.addAll([?paragraph.text.style?.color]);
        for (final color in colors) {
          for (final background in backgrounds(c)) {
            final ratio = _contrast(Color.alphaBlend(color, background), background);
            expect(
              ratio,
              greaterThanOrEqualTo(minimum),
              reason: '"${paragraph.text.toPlainText()}" is ${ratio.toStringAsFixed(2)}:1',
            );
          }
        }
      }
    }
  }

  measure(find.byType(ReadOnlyAnswer), (c) => [c.surfaceSunken]);
  measure(find.byType(FlagField), (c) => [c.surface, c.ground]);
}

/// WCAG 2.x contrast ratio, as test/design/contrast_test.dart works it out.
double _contrast(Color a, Color b) {
  double luminance(Color c) {
    double channel(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }

  final (la, lb) = (luminance(a), luminance(b));
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

/// Opens a note form on [definition] holding [values], every change drawn again as the screen
/// draws the form with the answers it now holds.
Future<TestAnswers> pumpForm(
  WidgetTester tester,
  NoteTypeDef definition, {
  Map<String, Object?>? values,
  Run? run,
  bool enabled = true,
  Set<String> capabilities = const {},
  ActionHandler? actions,
  String? openSection,
  String Function()? newEntryId,
  DateTime Function()? clock,
  bool Function(String path)? readOnly,
}) async {
  final answers = TestAnswers(values);
  await pumpField(
    tester,
    answering(
      answers,
      () => NoteForm(
        definition: definition,
        answers: answers.values,
        pending: answers.pending,
        conflicts: answers.conflicts,
        onChanged: answers.change,
        enabled: enabled,
        readOnly: readOnly,
        capabilities: capabilities,
        actions: actions,
        openSection: openSection,
        newEntryId: newEntryId ?? makeEntryId,
        clock: clock ?? DateTime.now,
      ),
    ),
    run: run,
  );
  return answers;
}

/// The IDs of the sections a note form draws, in order.
List<String> formSections() => [
  for (final e in find.byWidgetPredicate((w) => w.key is ValueKey<String>).evaluate())
    if ((e.widget.key! as ValueKey<String>).value case final k when k.startsWith('form.section.'))
      k.substring('form.section.'.length),
];

/// A section's header in a note form.
Finder sectionHeader(String id) => find.byKey(ValueKey('form.section.$id'));

/// The field host at [path] in a note form.
Finder fieldHost(String path) => find.byKey(ValueKey('host.$path'));

/// Opens a section of a note form, or closes it when open.
Future<void> toggleSection(WidgetTester tester, String id) async {
  await tester.ensureVisible(sectionHeader(id));
  await tester.pumpAndSettle();
  await tester.tap(sectionHeader(id));
  await tester.pumpAndSettle();
}

/// The semantics node of the control a screen reader names [label], exactly.
SemanticsNode controlNamed(WidgetTester tester, Pattern label) =>
    tester.getSemantics(find.bySemanticsLabel(label).last);

/// Phase 3's runs, and 200% text on a 320-wide phone in Day and Night: the form's worst cases for
/// layout, where the smoke test, a picker and a dialog are drawn.
final formRuns = <Run>[
  ...runs,
  for (final theme in [FieldTheme.day, FieldTheme.night]) (theme: theme, scale: 2.0, narrow: true),
];

/// Runs [body] once for each run ([over], or [runs]), as one test each.
void forEachRun(String description, Future<void> Function(WidgetTester tester, Run run) body, {List<Run>? over}) {
  for (final run in over ?? runs) {
    testWidgets('$description (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      await body(tester, run);
      handle.dispose();
    });
  }
}
