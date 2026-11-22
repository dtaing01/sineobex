import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/presets/models.dart';

/// The body of each preset kind (phase 5 design 4.4, 5.3) is data: packages/contract/test-vectors/
/// preset-bodies.json, which packages/presets/test/schemas.test.ts reads too, against the schemas
/// the server checks every body with. This reader holds no answer of its own: a valid body reads as
/// itself with its defaults filled in, a body the schemas refuse is refused at the field at fault,
/// a field this phone does not know is ignored and a kind it does not know is skipped (13.3), so a
/// later server never breaks an older phone.
///
/// Written ahead of P2-models, whose code makes it pass.
void main() {
  final vectors = jsonDecode(
    File('../../packages/contract/test-vectors/preset-bodies.json').readAsStringSync(),
  ) as Map<String, Object?>;
  List<Map<String, Object?>> cases(String key) => (vectors[key]! as List<Object?>).cast<Map<String, Object?>>();
  final kinds = (vectors['kinds']! as List<Object?>).cast<String>();

  // The class each kind's body reads as.
  final classes = <String, Matcher>{
    'order_category': isA<OrderCategoryBody>(),
    'item': isA<ItemBody>(),
    'bundle': isA<BundleBody>(),
    'flag': isA<FlagBody>(),
    'field_supply_map': isA<FieldSupplyMapBody>(),
    'condition_supply_map': isA<ConditionSupplyMapBody>(),
    'bag': isA<BagBody>(),
    'settings': isA<SettingsBody>(),
  };

  Map<String, Object?> filledIn(Map<String, Object?> c, String key) => {
    ...c[key]! as Map<String, Object?>,
    ...?c['filled'] as Map<String, Object?>?,
  };

  /// Whether a refusal at [path] lies at or under [at], '' being the body itself.
  bool under(String path, String at) => at.isEmpty || path == at || path.startsWith('$at.');

  /// Every text a body holds that a person typed (the vectors' free texts start "Demo").
  Iterable<String> typed(Object? json) sync* {
    if (json is String && json.trim().startsWith('Demo')) yield json;
    if (json is List<Object?>) {
      for (final v in json) {
        yield* typed(v);
      }
    }
    if (json is Map<String, Object?>) {
      for (final v in json.values) {
        yield* typed(v);
      }
    }
  }

  test('are the eight kinds, in the order the pages list them, each read by its own class', () {
    expect([for (final k in PresetKind.values) k.code], kinds);
    for (final k in PresetKind.values) {
      expect(PresetKind.byCode(k.code), k);
    }
    expect(classes.keys, unorderedEquals(kinds));
  });

  test('give a flag the eight named colours, in the palette’s order', () {
    expect([
      for (final c in FlagColor.values) {'color': c.code, 'name': c.colorName},
    ], vectors['colors']);
    for (final c in FlagColor.values) {
      expect(FlagColor.byCode(c.code), c);
    }
    // A pill's name is no key, and no other colour is one.
    expect([FlagColor.byCode('Red'), FlagColor.byCode('#d32f2f'), FlagColor.byCode('pink')], [null, null, null]);
  });

  test('know the two states a preset can be in', () {
    expect(PresetState.byCode('active'), PresetState.active);
    expect(PresetState.byCode('archived'), PresetState.archived);
    expect(PresetState.byCode('draft'), isNull);
  });

  test('read a vector file with every kind and one name per case', () {
    for (final kind in kinds) {
      expect(cases('valid').any((c) => c['kind'] == kind), isTrue, reason: kind);
      expect(cases('invalid').any((c) => c['kind'] == kind), isTrue, reason: kind);
    }
    final names = [
      for (final key in ['valid', 'invalid', 'unknownFields', 'unknownKinds'])
        for (final c in cases(key)) c['name'],
    ];
    expect(names.toSet(), hasLength(names.length));
  });

  group('a valid body reads as itself, its defaults filled in:', () {
    for (final c in cases('valid')) {
      test('${c['kind']}: ${c['name']}', () {
        final kind = c['kind']! as String;
        final before = jsonEncode(c['body']);
        final body = parsePreset(kind, c['body']);
        expect(body, classes[kind]);
        expect(body!.toJson(), filledIn(c, 'body'));
        expect(body.name, (c['body']! as Map<String, Object?>)['name']);
        expect(jsonEncode(c['body']), before, reason: 'the body it was given is left as it was');
      });
    }
  });

  group('a body the schemas refuse is refused, at the field at fault:', () {
    for (final c in cases('invalid')) {
      test('${c['kind']}: ${c['name']}', () {
        final paths = (c['paths']! as List<Object?>).cast<String>();
        Object? refusal;
        try {
          parsePreset(c['kind']! as String, c['body']);
        } on PresetBodyRefused catch (e) {
          refusal = e;
        }
        expect(refusal, isA<PresetBodyRefused>(), reason: 'refused');
        final at = (refusal! as PresetBodyRefused).path;
        expect(paths.any((p) => under(at, p)), isTrue, reason: 'refused at "$at", outside $paths');
        // What it says names where, never what an admin typed (12.1, risk 7).
        for (final text in typed(c['body'])) {
          expect(refusal.toString(), isNot(contains(text.trim())));
        }
      });
    }
  });

  group('a field this phone does not know is ignored:', () {
    for (final c in cases('unknownFields')) {
      test('${c['kind']}: ${c['name']}', () {
        final kind = c['kind']! as String;
        expect(parsePreset(kind, c['body'])!.toJson(), filledIn(c, 'known'));
        expect(parsePreset(kind, c['known'])!.toJson(), filledIn(c, 'known'));
      });
    }
  });

  test('a kind this phone does not know is skipped, whatever its body', () {
    for (final c in cases('unknownKinds')) {
      final kind = c['kind']! as String;
      expect(PresetKind.byCode(kind), isNull, reason: kind);
      expect(parsePreset(kind, c['body']), isNull, reason: kind);
      expect(parsePreset(kind, null), isNull, reason: kind);
    }
    expect(parsePreset('', const <String, Object?>{}), isNull);
  });

  group('each field reads as its own type:', () {
    const id = '00000000-0000-4000-8000-00000000a001';
    const category = '00000000-0000-4000-8000-00000000c001';

    test('an order category', () {
      final body =
          parsePreset('order_category', {'name': 'Demo: Labs', 'behaviour': 'lab', 'sort': 30})! as OrderCategoryBody;
      expect([body.name, body.behaviour, body.sort], ['Demo: Labs', CategoryBehaviour.lab, 30]);
    });

    test('an item, with no result, a choice or a number', () {
      Map<String, Object?> item(Object? result) => {
        'name': 'Demo: Test',
        'categoryId': category,
        'unit': 'test',
        'medical': true,
        'captureLot': true,
        'result': result,
      };
      final none = parsePreset('item', item(null))! as ItemBody;
      expect(
        [none.categoryId, none.unit, none.medical, none.captureLot, none.result],
        [category, 'test', true, true, null],
      );
      final choice =
          (parsePreset(
                    'item',
                    item({
                      'type': 'choice',
                      'options': ['Positive', 'Negative'],
                    }),
                  )!
                  as ItemBody)
              .result;
      expect(choice, isA<ChoiceResult>());
      expect((choice! as ChoiceResult).options, ['Positive', 'Negative']);
      final number = (parsePreset('item', item({'type': 'number', 'unit': 'mg/dL'}))! as ItemBody).result;
      expect(number, isA<NumberResult>());
      expect((number! as NumberResult).unit, 'mg/dL');
    });

    test('a bundle with its lines, its prompt left out', () {
      final body =
          parsePreset('bundle', {
                'name': 'Demo: Foot check',
                'medical': false,
                'lines': [
                  {'itemId': id, 'qty': 2, 'core': true},
                  {'itemId': category, 'qty': 1, 'core': false},
                ],
              })!
              as BundleBody;
      expect([body.medical, body.prompt], [false, '']);
      expect([for (final l in body.lines) (l.itemId, l.qty, l.core)], [(id, 2, true), (category, 1, false)]);
    });

    test('a flag, its criteria left out', () {
      final body =
          parsePreset('flag', {
                'name': 'Demo: Frost risk',
                'tier': 'secondary',
                'color': 'blue',
                'rank': 20,
                'sensitive': true,
              })!
              as FlagBody;
      expect(
        [body.tier, body.criteria, body.color, body.rank, body.sensitive],
        [FlagTier.secondary, '', FlagColor.blue, 20, true],
      );
    });

    test('a field supply map: each test, a count of its own and one read from the note', () {
      FieldSupplyMapBody map(Map<String, Object?> when, Object qty) =>
          parsePreset('field_supply_map', {
                'name': 'Demo: Map',
                'noteTypeKey': 'demo_supplies',
                'path': 'supplies.given',
                'when': when,
                'lines': [
                  {'itemId': id, 'qty': qty},
                ],
              })!
              as FieldSupplyMapBody;
      final equals = map({'equals': 2.5}, 3);
      expect([equals.noteTypeKey, equals.path], ['demo_supplies', 'supplies.given']);
      expect(equals.when, isA<WhenEquals>().having((w) => w.value, 'value', 2.5));
      expect(equals.lines.single.itemId, id);
      expect(equals.lines.single.qty, isA<FixedQty>().having((q) => q.count, 'count', 3));
      expect(map({'equals': true}, 1).when, isA<WhenEquals>().having((w) => w.value, 'value', true));
      expect(map({'equals': 'water'}, 1).when, isA<WhenEquals>().having((w) => w.value, 'value', 'water'));
      expect(map({'includes': 'socks'}, 1).when, isA<WhenIncludes>().having((w) => w.code, 'code', 'socks'));
      expect(map({'answered': true}, 1).when, isA<WhenAnswered>());
      expect(
        map({'answered': true}, {'fromPath': 'supplies.count'}).lines.single.qty,
        isA<QtyFromPath>().having((q) => q.path, 'path', 'supplies.count'),
      );
      final everyNote =
          parsePreset('field_supply_map', {
                'name': 'Demo: Every note',
                'noteTypeKey': 'demo_supplies',
                'lines': [
                  {'itemId': id, 'qty': 1},
                ],
              })!
              as FieldSupplyMapBody;
      expect([everyNote.path, everyNote.when], [null, null]);
    });

    test('a condition supply map, a bag and the team’s settings', () {
      final condition =
          parsePreset('condition_supply_map', {
                'name': 'Demo: Rash',
                'codes': ['R21', 'L30.9'],
                'lines': [
                  {'itemId': id, 'qtyPerPatient': 2},
                ],
              })!
              as ConditionSupplyMapBody;
      expect(condition.codes, ['R21', 'L30.9']);
      expect([condition.lines.single.itemId, condition.lines.single.qtyPerPatient], [id, 2]);
      final bag =
          parsePreset('bag', {
                'name': 'Demo: Day bag',
                'minimums': [
                  {'itemId': id, 'min': 4},
                ],
              })!
              as BagBody;
      expect([bag.minimums.single.itemId, bag.minimums.single.min], [id, 4]);
      final settings =
          parsePreset('settings', {
                'name': 'Team settings',
                'bagMinimumsOn': true,
                'newBagMinimums': [
                  {'itemId': id, 'min': 1},
                ],
                'problemCheckDays': 30,
              })!
              as SettingsBody;
      expect([settings.name, settings.bagMinimumsOn, settings.problemCheckDays], ['Team settings', true, 30]);
      expect(settings.newBagMinimums.single.min, 1);
    });
  });
}
