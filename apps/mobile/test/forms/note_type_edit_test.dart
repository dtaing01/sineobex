import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/definition.dart';

/// A team's edit of one of its note types (phase 5 design 5.4) makes a new version, which reaches
/// the phone like every other. The phone refuses a whole list that names a version it cannot read
/// (D84), so every result the edit makes must be one NoteTypeDef.fromJson reads: here, every
/// definition of packages/contract/test-vectors/note-type-edit.json, each version a case edits and
/// each it makes, the note types an option operation reached along mapsTo among them. Each is read
/// as it was written: its key, version, sections, fields and options in order, and the marks no
/// operation writes (rule 1) where it had them.
void main() {
  final vectors = jsonDecode(
    File('../../packages/contract/test-vectors/note-type-edit.json').readAsStringSync(),
  ) as Map<String, Object?>;

  /// Every definition the file holds, by where it is.
  final definitions = <String, Map<String, Object?>>{
    for (final MapEntry(:key, :value) in (vectors['definitions']! as Map<String, Object?>).entries)
      'definitions.$key': value! as Map<String, Object?>,
  };
  for (final c in (vectors['cases']! as List<Object?>).cast<Map<String, Object?>>()) {
    final expected = c['expected']! as Map<String, Object?>;
    if (expected['definition'] case final Map<String, Object?> d) definitions['cases: ${c['name']}'] = d;
  }
  for (final c in (vectors['fanout']! as List<Object?>).cast<Map<String, Object?>>()) {
    final expected = c['expected']! as Map<String, Object?>;
    for (final p in (expected['published'] as List<Object?>? ?? const []).cast<Map<String, Object?>>()) {
      definitions['fanout: ${c['name']} (${p['key']})'] = p['definition']! as Map<String, Object?>;
    }
  }

  test('reads a result of every operation', () {
    final made = <String>{
      for (final c in [
        ...(vectors['cases']! as List<Object?>),
        ...(vectors['fanout']! as List<Object?>),
      ].cast<Map<String, Object?>>())
        if ((c['expected']! as Map<String, Object?>).containsKey('definition') ||
            (c['expected']! as Map<String, Object?>).containsKey('published'))
          for (final op in (c['ops']! as List<Object?>).cast<Map<String, Object?>>()) op['op']! as String,
    };
    expect(made, {
      'rename_type',
      'set_hidden',
      'rename_label',
      'add_option',
      'rename_option',
      'retire_option',
      'move_option',
      'add_field',
      'add_section',
      'copy_section',
    });
  });

  /// The ids of a definition's sections, then of each field at every depth, and each option's code.
  List<String> idsOf(Map<String, Object?> json) {
    final ids = <String>[];
    void fields(List<Object?> list, String at) {
      for (final f in list.cast<Map<String, Object?>>()) {
        ids.add('$at.${f['id']}');
        for (final o
            in (f['options'] is List ? f['options']! as List<Object?> : const <Object?>[])
                .cast<Map<String, Object?>>()) {
          ids.add('$at.${f['id']} ${o['code']}');
        }
        if (f['fields'] case final List<Object?> inner) fields(inner, '$at.${f['id']}');
      }
    }

    for (final s in (json['sections']! as List<Object?>).cast<Map<String, Object?>>()) {
      ids.add(s['id']! as String);
      fields(s['fields']! as List<Object?>, s['id']! as String);
    }
    return ids;
  }

  List<String> readIds(NoteTypeDef d) {
    final ids = <String>[];
    void fields(List<FieldDef> list, String at) {
      for (final f in list) {
        ids.add('$at.${f.id}');
        if (f is ChoiceDef) {
          for (final o in f.options) {
            ids.add('$at.${f.id} ${o.code}');
          }
        }
        if (f is GroupDef) fields(f.fields, '$at.${f.id}');
      }
    }

    for (final s in d.sections) {
      ids.add(s.id);
      fields(s.fields, s.id);
    }
    return ids;
  }

  for (final MapEntry(key: where, value: json) in definitions.entries) {
    test('reads $where', () {
      final d = NoteTypeDef.fromJson(json);
      expect([d.key, d.version, d.title], [json['key'], json['version'], json['title']]);
      expect([for (final k in d.kinds) k.code], json['kinds']);
      expect(
        [d.group, d.sensitivity.name, d.quick, d.auto],
        [json['group'], json['sensitivity'], json['quick'] ?? false, json['auto']],
      );
      expect(readIds(d), idsOf(json));
      final sections = (json['sections']! as List<Object?>).cast<Map<String, Object?>>();
      for (final (i, s) in d.sections.indexed) {
        final written = sections[i];
        expect(
          [s.sensitiveExam, s.treatmentRecord, s.needs, s.normal, s.repeat?.max, s.showWhen != null],
          [
            written['sensitiveExam'] ?? false,
            written['treatmentRecord'] ?? false,
            written['needs'],
            written['normal'] ?? false,
            (written['repeat'] as Map<String, Object?>?)?['max'],
            written['showWhen'] != null,
          ],
          reason: '$where: ${s.id}',
        );
      }
    });
  }
}
