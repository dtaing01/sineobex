/// A note laid out for reading (phase 4 design, forms 7.1; lifecycle 5.1 and 9.7): its sections,
/// labels and values, with each corrected answer marked and the old value kept, so the portal and
/// the phone draw one thing. A finished note never changes; a correction writes the new value and
/// keeps the old one, shown struck through with who changed it, when and why (lifecycle 3.6, PRD
/// main 460). packages/forms/src/interp/read-model.ts gives the same model, held together by the
/// conformance vectors.
library;

import 'check_answer.dart';
import 'conditions.dart';
import 'definition.dart';
import 'effective.dart';
import 'field_at.dart';
import 'layout.dart';

/// One change of a correction: [field] is `data.<path>` for an answer.
class CorrectionChange {
  const CorrectionChange({required this.field, required this.oldValue, required this.newValue});
  final String field;
  final Object? oldValue;
  final Object? newValue;
}

/// A `note_corrections` row (lifecycle 2.3). [outcome] is its wire value: `corrected`, `declined`,
/// `no_change`, `draft_edit` or `not_author`.
class NoteCorrection {
  const NoteCorrection({
    required this.outcome,
    required this.reason,
    required this.correctorName,
    required this.correctorCredential,
    required this.correctedAt,
    required this.changes,
  });

  /// Reads a row as the API writes it: `changes` a list of `{ field, oldValue, newValue }`.
  factory NoteCorrection.fromJson(Map<String, Object?> json) => NoteCorrection(
    outcome: json['outcome']! as String,
    reason: json['reason']! as String,
    correctorName: json['correctorName']! as String,
    correctorCredential: json['correctorCredential']! as String,
    correctedAt: json['correctedAt']! as String,
    changes: [
      for (final change in (json['changes']! as List<Object?>).cast<Map<String, Object?>>())
        CorrectionChange(field: change['field']! as String, oldValue: change['oldValue'], newValue: change['newValue']),
    ],
  );

  final String outcome;
  final String reason;
  final String correctorName;
  final String correctorCredential;
  final String correctedAt;
  final List<CorrectionChange> changes;
}

/// An old value of an answer, kept under the new one.
class ReadCorrection {
  const ReadCorrection({
    required this.path,
    required this.old,
    required this.by,
    required this.credential,
    required this.at,
    required this.reason,
  });

  /// The answer it changed.
  final String path;

  /// The old value written out as the answer would be; null when there was none.
  final String? old;
  final String by;

  /// The credential's code, which the renderer words.
  final String credential;
  final String at;
  final String reason;

  Map<String, Object?> toJson() => {
    'path': path,
    'old': old,
    'by': by,
    'credential': credential,
    'at': at,
    'reason': reason,
  };
}

/// [value] is null for an answer a correction took away: only its old value is shown, struck through.
class ReadItem {
  ReadItem({required this.path, required this.labels, required this.value});
  final String path;
  final List<String> labels;
  final String? value;
  final List<ReadCorrection> corrections = [];

  Map<String, Object?> toJson() => {
    'path': path,
    'labels': labels,
    'value': value,
    'corrections': [for (final c in corrections) c.toJson()],
  };
}

class ReadEntry {
  const ReadEntry({required this.id, required this.title, required this.items});
  final String id;
  final String title;
  final List<ReadItem> items;

  Map<String, Object?> toJson() => {
    'id': id,
    'title': title,
    'items': [for (final item in items) item.toJson()],
  };
}

/// A section that does not repeat has [items]; a repeating one has [entries] and no items.
class ReadSection {
  const ReadSection({required this.id, required this.title, required this.items, required this.entries});
  final String id;
  final String title;
  final List<ReadItem> items;
  final List<ReadEntry>? entries;

  Map<String, Object?> toJson() => {
    'id': id,
    'title': title,
    if (entries case final entries?)
      'entries': [for (final entry in entries) entry.toJson()]
    else
      'items': [for (final item in items) item.toJson()],
  };
}

class ReadModel {
  const ReadModel(this.sections);
  final List<ReadSection> sections;

  /// The plain data read-model.ts returns.
  Map<String, Object?> toJson() => {
    'sections': [for (final section in sections) section.toJson()],
  };
}

/// The sections with an answer that counts, in the definition's order, and in a repeating section
/// its entries that have one, titled by `itemTitle` with {n} their number among the entries that
/// are there. An item is an answer that counts (a region, a problem, and a choice with its Other
/// text are one item each), with the labels along its path and its value written out
/// (layout.dart). Nothing is left out for any reader here: the caller passes the answers the reader
/// may see (visibleAnswers).
///
/// An item's corrections are the changes of the `corrected` corrections, in the order given, to an
/// answer the item shows; the other outcomes left the note as it was. A change to an answer that
/// does not count now (the correction cleared it, or it is in a field the correction hid) whose old
/// value was an answer is an item all the same, at its place in the definition, with value null, so
/// the old value stays visible struck through (lifecycle 3.6 and 9.7, PRD main 460). Its section,
/// or its entry when that entry is still there, is listed for it.
///
/// PLAN-OPEN: what the visit read shows of an answer a correction took away (forms.md 10.1 #13).
/// The default built: an answer the correction cleared, or hid while changing it, is marked as
/// above. An entry a correction removed, and an answer it hid without changing it, mark nothing:
/// this sees only the answers that count now, so marking them would need the note's stored answers,
/// or the visit read laying them out from the corrections themselves.
///
/// The corrections, like the answers, are those the reader may see: the caller leaves out a
/// correction whose old or new value holds what visibleAnswers hides from them (lifecycle 5.1).
ReadModel readModel(NoteTypeDef definition, Answers answers, List<NoteCorrection> corrections) {
  final byPath = <String, ReadItem>{};
  List<ReadItem> toRead(List<Item> items) {
    final read = <ReadItem>[];
    for (final Item(:path, :labels, :value, :covers) in items) {
      final item = ReadItem(path: path, labels: labels, value: value);
      for (final covered in covers) {
        byPath[covered] = item;
      }
      read.add(item);
    }
    return read;
  }

  final counted = effectiveAnswers(definition, answers);
  final changed = _changes(corrections);
  // The answers a correction took away that had a value: laid out with none, under their old one.
  final struck = {
    for (final (:path, :oldValue, correction: _) in changed)
      if (!counted.containsKey(path) && _oldValue(definition, path, oldValue) != null) path,
  };
  final sections = [
    for (final LaidOutSection(:section, :items, :entries) in layOut(definition, counted, struck: struck))
      ReadSection(
        id: section.id,
        title: section.title,
        items: entries == null ? toRead(items) : const [],
        entries: entries == null
            ? null
            : [for (final e in entries) ReadEntry(id: e.id, title: e.title, items: toRead(e.items))],
      ),
  ];
  for (final (:path, :oldValue, :correction) in changed) {
    byPath[path]?.corrections.add(
      ReadCorrection(
        path: path,
        old: _oldValue(definition, path, oldValue),
        by: correction.correctorName,
        credential: correction.correctorCredential,
        at: correction.correctedAt,
        reason: correction.reason,
      ),
    );
  }
  return ReadModel(sections);
}

const _data = 'data.';

/// The changes to answers of the corrections that changed the note, in the order given.
List<({String path, Object? oldValue, NoteCorrection correction})> _changes(List<NoteCorrection> corrections) => [
  for (final correction in corrections)
    if (correction.outcome == 'corrected')
      for (final change in correction.changes)
        if (change.field.startsWith(_data))
          (path: change.field.substring(_data.length), oldValue: change.oldValue, correction: correction),
];

/// An old value written out as that answer alone would be; null for a blank, or a value it cannot hold.
String? _oldValue(NoteTypeDef definition, String path, Object? value) {
  // An entry's own answers have no leaf; no item shows them.
  final target = fieldAt(definition, path);
  final leaf = target?.leaf;
  if (leaf == null) return null;
  if (isBlank(value) || checkAnswer(definition, path, value) != null) return null;
  return displayValue(leaf.holds, value, target!.field);
}
