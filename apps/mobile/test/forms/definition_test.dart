import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/field_at.dart';

/// A definition reaches the phone from the server or the bundled presets, checked by the validator
/// on the way. A shape it would never pass is refused here by name, never as a cast error deep in
/// a screen.
void main() {
  final vectors = jsonDecode(
    File('../../packages/contract/test-vectors/forms-conformance.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final definitions = vectors['definitions']! as Map<String, Object?>;

  Map<String, Object?> withField(Map<String, Object?> field) => {
    'key': 'demo_shape',
    'version': 1,
    'title': 'Demo shape',
    'kinds': ['medical'],
    'group': 'clinical',
    'sensitivity': 'none',
    'sections': [
      {
        'id': 'main',
        'title': 'Demo main',
        'fields': [field],
      },
    ],
  };

  Matcher refusedAt(String place) =>
      throwsA(isA<FormatException>().having((e) => e.message, 'message', startsWith(place)));

  test('reads every definition of the shared vectors', () {
    for (final MapEntry(:key, :value) in definitions.entries) {
      final definition = NoteTypeDef.fromJson(value! as Map<String, Object?>);
      expect(definition.sections, isNotEmpty, reason: key);
    }
  });

  test('reads what the format leaves out as its default', () {
    final definition = NoteTypeDef.fromJson(withField({'id': 'seen', 'kind': 'flag', 'label': 'Demo seen'}));
    final field = definition.sections.single.fields.single as FlagDef;
    expect(
      [field.required, field.sides, field.noNormal, field.handoff, field.recap, field.clears],
      [false, false, false, false, true, isEmpty],
    );
    expect(definition.quick, isFalse);
    expect(definition.sections.single.repeat, isNull);
  });

  test('reads a condition on one code as a condition on a list of one', () {
    final definition = NoteTypeDef.fromJson(
      withField({
        'id': 'seen',
        'kind': 'flag',
        'label': 'Demo seen',
        'showWhen': {'field': 'main.other', 'is': 'yes'},
      }),
    );
    final condition = definition.sections.single.fields.single.showWhen! as IsCondition;
    expect(condition.codes, ['yes']);
  });

  test('reads a grid of fixed rows and a grid of picked rows', () {
    final outreach = NoteTypeDef.fromJson(definitions['outreach']! as Map<String, Object?>);
    final grids = outreach.sections.single.fields.whereType<GridDef>().toList();
    expect(grids.map((g) => (g.rows?.length, g.pickedIn)), [(null, 'supplies.vaccines'), (2, null)]);
  });

  test('refuses an unknown kind, a missing label and a wrong type, naming the place', () {
    expect(
      () => NoteTypeDef.fromJson(withField({'id': 'x', 'kind': 'slider', 'label': 'Demo x'})),
      refusedAt(r'$.sections[0].fields[0].kind'),
    );
    expect(
      () => NoteTypeDef.fromJson(withField({'id': 'x', 'kind': 'time'})),
      refusedAt(r'$.sections[0].fields[0].label'),
    );
    expect(
      () => NoteTypeDef.fromJson(
        withField({'id': 'x', 'kind': 'choice', 'label': 'Demo x', 'many': 'yes', 'options': <Object?>[]}),
      ),
      refusedAt(r'$.sections[0].fields[0].many'),
    );
    expect(
      () => NoteTypeDef.fromJson(
        withField({
          'id': 'x',
          'kind': 'choice',
          'label': 'Demo x',
          'many': true,
          'options': <Object?>[],
          'excludes': [
            ['a'],
          ],
        }),
      ),
      refusedAt(r'$.sections[0].fields[0].excludes[0]'),
    );
    expect(() => NoteTypeDef.fromJson({...withField({}), 'sensitivity': 'secret'}), refusedAt(r'$.sensitivity'));
  });

  test('builds the paths of a definition once, and points into that one model', () {
    final visit = NoteTypeDef.fromJson(definitions['visit']! as Map<String, Object?>);
    final model = definitionModel(visit);
    expect(identical(definitionModel(visit), model), isTrue);
    expect(identical(fieldAt(visit, 'vitals.pulse')!.leaf, model.leaves['vitals.pulse']), isTrue);
  });
}
