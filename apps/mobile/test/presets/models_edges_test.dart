import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/presets/models.dart';

/// Where the phone's parser must read a body as zod reads it on the server, and Dart's own reading
/// would differ: JavaScript's white space, lengths in code points, whole numbers that Dart's
/// jsonDecode reads as doubles, zod's UUIDs, a null that is a value and not a field left out, and
/// options told apart as JavaScript's toLowerCase folds them. preset-bodies.json holds none of
/// these; each answer here is the one packages/presets/src/schemas.ts gives (zod 4.6.7), and each
/// belongs in that file, so the server's reader holds it too.
///
/// A body the server accepts and the phone refused would be a preset the phone never holds.
void main() {
  /// Each case: its name, its kind, the body as JSON text (numbers as written) and where it is
  /// refused, or null where it is accepted.
  final cases = <(String, String, String, String?)>[
    // JavaScript's trim takes off its white space and line ends, and not U+0085, which Dart's does.
    ('a name ending in U+0085, which is no white space to JavaScript', 'order_category', _name(r'Demo: A\u0085'), null),
    ('a name starting with U+0085', 'order_category', _name(r'\u0085Demo: A'), null),
    ('a name starting with a no-break space', 'order_category', _name(r'\u00a0Demo: A'), 'name'),
    ('a name ending in a byte order mark', 'order_category', _name(r'Demo: A\ufeff'), 'name'),
    ('a name ending in an ideographic space', 'order_category', _name(r'Demo: A\u3000'), 'name'),
    ('a name ending in a line separator', 'order_category', _name(r'Demo: A\u2028'), 'name'),
    ('a name ending in a vertical tab', 'order_category', _name(r'Demo: A\u000b'), 'name'),
    ('a name ending in U+180E, no longer white space', 'order_category', _name(r'Demo: A\u180e'), null),
    ('a name ending in a zero width space, never white space', 'order_category', _name(r'Demo: A\u200b'), null),
    ('a no-break space inside a name', 'order_category', _name(r'Demo:\u00a0A'), null),
    // A lone surrogate is one code point, as zod counts them.
    ('a name of 80 lone surrogates', 'order_category', _surrogates(80), null),
    ('a name of 81 lone surrogates', 'order_category', _surrogates(81), 'name'),
    // JavaScript reads 3.0 and 1e2 as the whole numbers they are; Dart's jsonDecode reads doubles.
    ('a sort of 3.0', 'order_category', '{"name": "Demo: A", "behaviour": "supply", "sort": 3.0}', null),
    ('a sort of 1e2', 'order_category', '{"name": "Demo: A", "behaviour": "supply", "sort": 1e2}', null),
    ('a sort of 1E6, the highest', 'order_category', '{"name": "Demo: A", "behaviour": "supply", "sort": 1E6}', null),
    ('a sort of -0.0', 'order_category', '{"name": "Demo: A", "behaviour": "supply", "sort": -0.0}', null),
    ('a sort of 10e-1', 'order_category', '{"name": "Demo: A", "behaviour": "supply", "sort": 10e-1}', null),
    ('a sort of 2.5e0', 'order_category', '{"name": "Demo: A", "behaviour": "supply", "sort": 2.5e0}', 'sort'),
    (
      'a sort too big for a double',
      'order_category',
      '{"name": "Demo: A", "behaviour": "supply", "sort": 1e400}',
      'sort',
    ),
    ('a window of 3.65e2', 'settings', _settings('3.65e2'), null),
    ('a window of 365.0000000001', 'settings', _settings('365.0000000001'), 'problemCheckDays'),
    ('a quantity of 99.0', 'field_supply_map', _map('"lines": [{"itemId": "$_id", "qty": 99.0}]'), null),
    (
      'a quantity too big for a double',
      'field_supply_map',
      _map('"lines": [{"itemId": "$_id", "qty": 1e400}]'),
      'lines.0.qty',
    ),
    // Any finite number may be equalled; zod's number() takes no infinity.
    ('equals a negative number', 'field_supply_map', _equals('-3'), null),
    ('equals a small decimal', 'field_supply_map', _equals('1e-7'), null),
    ('equals a number too big for a double', 'field_supply_map', _equals('1e400'), 'when'),
    // zod 4's uuid(): versions 1 to 8, variants 8 to b, in either case, and the nil and max ids.
    ('an id with capitals', 'item', _item('D05E0000-0000-4000-B000-00000000A001'), null),
    ('the nil id', 'item', _item('00000000-0000-0000-0000-000000000000'), null),
    ('the max id', 'item', _item('ffffffff-ffff-ffff-ffff-ffffffffffff'), null),
    ('the max id in capitals', 'item', _item('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'), 'categoryId'),
    ('an id of version 8 and variant b', 'item', _item('00000000-0000-8000-b000-000000000001'), null),
    ('an id of version 0', 'item', _item('00000000-0000-0000-8000-000000000001'), 'categoryId'),
    ('an id of version 9', 'item', _item('00000000-0000-9000-8000-000000000001'), 'categoryId'),
    ('an id of variant c', 'item', _item('00000000-0000-4000-c000-000000000001'), 'categoryId'),
    ('an id of variant 7', 'item', _item('00000000-0000-4000-7000-000000000001'), 'categoryId'),
    ('an id with no hyphens', 'item', _item('00000000000040008000000000000001'), 'categoryId'),
    ('an id in braces', 'item', _item('{00000000-0000-4000-8000-000000000001}'), 'categoryId'),
    ('an id with a line break after it', 'item', _item(r'00000000-0000-4000-8000-000000000001\n'), 'categoryId'),
    (
      'ids that differ only in case name two items',
      'bag',
      _bag(['00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000A001']),
      null,
    ),
    // Null is a value, never a field left out: only a field left out takes its default.
    (
      'criteria of null',
      'flag',
      '{"name": "Demo: F", "tier": "secondary", "criteria": null, "color": "red", "rank": 1, "sensitive": false}',
      'criteria',
    ),
    (
      'a path of null, with a when',
      'field_supply_map',
      _map('"path": null, "when": {"answered": true}, $_line'),
      'path',
    ),
    ('a when of null, with a path', 'field_supply_map', _map('"path": "supplies.count", "when": null, $_line'), 'when'),
    (
      'a result left out, not null',
      'item',
      '{"name": "Demo: I", "categoryId": "$_id", "unit": "each", "medical": false, "captureLot": false}',
      'result',
    ),
    (
      'a quantity read from a path of null',
      'field_supply_map',
      _map('"lines": [{"itemId": "$_id", "qty": {"fromPath": null}}]'),
      'lines.0.qty',
    ),
    // Two options are one when JavaScript's toLowerCase folds them together, and only then.
    ('options in other cases', 'item', _choice(['Positive', 'POSITIVE']), 'result.options.1'),
    ('a dotted capital I is not an i', 'item', _choice([r'\u0130', 'i']), null),
    ('a dotted capital I is an i with a dot above', 'item', _choice([r'\u0130', r'i\u0307']), 'result.options.1'),
    (
      'a capital sigma that ends a word is not a sigma that starts one',
      'item',
      _choice([r'\u0391\u03a3', r'\u03b1\u03c3']),
      null,
    ),
    ('the same Greek option twice', 'item', _choice([r'\u0391\u03a3', r'\u0391\u03a3']), 'result.options.1'),
    ('the Kelvin sign is a k', 'item', _choice([r'\u212a', 'k']), 'result.options.1'),
    ('the Angstrom sign is an A with a ring', 'item', _choice([r'\u00c5', r'\u212b']), 'result.options.1'),
    ('a title case letter folds with its small one', 'item', _choice([r'\u01c5', r'\u01c6']), 'result.options.1'),
    ('a sharp s is not two s', 'item', _choice([r'Stra\u00dfe', 'STRASSE']), null),
  ];

  bool under(String path, String at) => at.isEmpty || path == at || path.startsWith('$at.');

  for (final (name, kind, json, refusedAt) in cases) {
    test(name, () {
      final body = jsonDecode(json);
      if (refusedAt == null) {
        expect(parsePreset(kind, body)!.toJson(), body);
        return;
      }
      Object? refusal;
      try {
        parsePreset(kind, body);
      } on PresetBodyRefused catch (e) {
        refusal = e;
      }
      expect(refusal, isA<PresetBodyRefused>(), reason: 'refused');
      final at = (refusal! as PresetBodyRefused).path;
      expect(under(at, refusedAt), isTrue, reason: 'refused at "$at", not at "$refusedAt"');
    });
  }

  test('read a whole number written with a fraction or an exponent as a whole number', () {
    final body = parsePreset('order_category', jsonDecode('{"name": "Demo: A", "behaviour": "supply", "sort": 1e2}'));
    expect((body! as OrderCategoryBody).sort, isA<int>().having((s) => s, 'sort', 100));
  });
}

const _id = '00000000-0000-4000-8000-00000000a001';
const _line = '"lines": [{"itemId": "$_id", "qty": 1}]';

String _name(String name) => '{"name": "$name", "behaviour": "supply", "sort": 0}';
String _surrogates(int count) => _name(List.filled(count, r'\ud83d').join());
String _settings(String days) =>
    '{"name": "Team settings", "bagMinimumsOn": false, "newBagMinimums": [], "problemCheckDays": $days}';
String _map(String rest) => '{"name": "Demo: M", "noteTypeKey": "demo_supplies", $rest}';
String _equals(String value) => _map('"path": "supplies.count", "when": {"equals": $value}, $_line');
String _item(String categoryId) =>
    '{"name": "Demo: I", "categoryId": "$categoryId", "unit": "each", "medical": false, "captureLot": false, "result": null}';
String _bag(List<String> ids) =>
    '{"name": "Demo: Bag", "minimums": [${[for (final id in ids) '{"itemId": "$id", "min": 1}'].join(', ')}]}';
String _choice(List<String> options) =>
    '{"name": "Demo: L", "categoryId": "$_id", "unit": "test", "medical": true, "captureLot": false, '
    '"result": {"type": "choice", "options": [${options.map((o) => '"$o"').join(', ')}]}}';
