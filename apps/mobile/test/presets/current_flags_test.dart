import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/presets/current_flags.dart';
import 'package:sineobex_field/presets/models.dart';

/// A patient's current flags (phase 5 design 5.3, 4.5; D135) are data:
/// packages/contract/test-vectors/flag-current.json, which packages/presets/test/current-flags.test.ts
/// reads too, so the phone's pills, flags sheet and patient list fold offline what the chart folds.
/// This reader holds no answer of its own: every case runs and its answer is compared with the one
/// the file expects.
///
/// Written ahead of P5-current-dart, whose code makes it pass.
void main() {
  final vectors = jsonDecode(
    File('../../packages/contract/test-vectors/flag-current.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final flags = {
    for (final MapEntry(:key, :value) in (vectors['flags']! as Map<String, Object?>).entries)
      key: _flagOf(value! as Map<String, Object?>),
  };
  final cases = (vectors['cases']! as List<Object?>).cast<Map<String, Object?>>();

  List<FlagChangeRef> changesOf(Map<String, Object?> c) => [
    for (final x in (c['changes']! as List<Object?>).cast<Map<String, Object?>>())
      (
        id: x['id']! as String,
        flagId: x['flagId']! as String,
        action: x['action']! as String,
        effectiveAt: DateTime.parse(x['effectiveAt']! as String),
        enteredInError: x['enteredInError']! as bool,
      ),
  ];

  /// The reader's flag rule for a flag of the team, as the server's flagHidden is (design 6.2).
  bool Function(FlagRef) ruleOf(Map<String, Object?> c) =>
      (flag) => flag.sensitive && !(c['seesSensitive']! as bool);

  /// The answer as the file writes it, so a list is compared by what it holds.
  Map<String, Object?> asJson(CurrentFlags f) => {'primary': f.primary, 'secondary': f.secondary};

  test('has one name per case, both tiers, both acts, both readers, and changes entered in error', () {
    expect(cases.map((c) => c['name']).toSet(), hasLength(cases.length));
    expect(cases.map((c) => c['seesSensitive']).toSet(), {true, false});
    final all = [for (final c in cases) ...changesOf(c)];
    expect(all.map((x) => x.action).toSet(), {'set', 'clear'});
    expect(all.any((x) => x.enteredInError), isTrue);
    expect(all.map((x) => flags[x.flagId]?.tier).whereType<FlagTier>().toSet(), FlagTier.values.toSet());
    expect(all.any((x) => flags[x.flagId]?.state == PresetState.archived), isTrue);
    expect(all.any((x) => flags[x.flagId]?.sensitive ?? false), isTrue);
    expect(all.any((x) => !flags.containsKey(x.flagId)), isTrue);
  });

  for (final c in cases) {
    test('${c['name']}', () {
      final answer = currentFlags(changes: changesOf(c), flags: flags, hidden: ruleOf(c));
      expect(asJson(answer), c['expected']);
    });
  }

  test('answers the same whatever order the changes arrive in', () {
    for (final c in cases) {
      final answer = currentFlags(changes: changesOf(c).reversed, flags: flags, hidden: ruleOf(c));
      expect(asJson(answer), c['expected'], reason: '${c['name']}');
    }
  });

  test('an instant is an instant, whatever zone it is written in', () {
    for (final c in cases) {
      final local = [
        for (final x in changesOf(c))
          (
            id: x.id,
            flagId: x.flagId,
            action: x.action,
            effectiveAt: x.effectiveAt.toLocal(),
            enteredInError: x.enteredInError,
          ),
      ];
      expect(
        asJson(currentFlags(changes: local, flags: flags, hidden: ruleOf(c))),
        c['expected'],
        reason: '${c['name']}',
      );
    }
  });

  test('leaves the changes it is given as they were', () {
    for (final c in cases) {
      final changes = changesOf(c);
      final before = [for (final x in changes) x.id];
      currentFlags(changes: changes, flags: flags, hidden: ruleOf(c));
      expect([for (final x in changes) x.id], before, reason: '${c['name']}');
    }
  });

  test('a rule that hides every flag leaves nothing, and is asked only of the team’s flags', () {
    final asked = <FlagRef>[];
    for (final c in cases) {
      final answer = currentFlags(
        changes: changesOf(c),
        flags: flags,
        hidden: (flag) {
          asked.add(flag);
          return true;
        },
      );
      expect(asJson(answer), {'primary': null, 'secondary': <String>[]}, reason: '${c['name']}');
    }
    expect(asked, isNotEmpty);
    expect(asked.every(flags.values.contains), isTrue);
  });
}

FlagRef _flagOf(Map<String, Object?> f) => (
  tier: FlagTier.values.byName(f['tier']! as String),
  rank: f['rank']! as int,
  name: f['name']! as String,
  sensitive: f['sensitive']! as bool,
  state: PresetState.byCode(f['state']! as String)!,
);
