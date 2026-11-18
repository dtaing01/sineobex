import 'package:flutter/material.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../encounters/credentials.dart' show credentialText;
import '../../forms/read_model.dart';
import '../patients/patient_labels.dart' show longDate;
import '../sync/sync_labels.dart' show timeOfDay;

/// A finished note as it is read (phase 4 design, forms 8.1; lifecycle 9.7): the sections of its
/// read model, an entry of a repeating section under its title, and each answer as its labels then
/// its value. A corrected answer shows the new value and under it each old one, struck through,
/// with who changed it, when and why (PRD main 460), in the order the corrections were made. An
/// answer a correction took away shows no value, only its old one.
///
/// It draws the model and nothing else: what the reader may see was settled when the model was
/// made (visibleAnswers), and it knows nothing of kinds. It does not scroll; the visit screen
/// places it among the note's recap, sign-offs and addenda.
class NoteReadView extends StatelessWidget {
  const NoteReadView({super.key, required this.model, this.itemAction});

  final ReadModel model;

  /// What the screen offers under an answer (Correct, for the acting author: lifecycle 9.7), or
  /// null for nothing.
  final Widget? Function(ReadItem item)? itemAction;

  /// Shown for a note with no answer that counts.
  static const nothing = 'Nothing was recorded in this note.';

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    if (model.sections.isEmpty) return Text(nothing, style: text.bodyLarge);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, section) in model.sections.indexed) ...[
          if (i > 0) const SizedBox(height: FieldSpace.s5),
          Semantics(header: true, child: Text(section.title, style: text.titleLarge)),
          const SizedBox(height: FieldSpace.s2),
          if (section.entries case final entries?)
            for (final entry in entries) ...[
              const SizedBox(height: FieldSpace.s2),
              Semantics(header: true, child: Text(entry.title, style: text.titleMedium)),
              const SizedBox(height: FieldSpace.s1),
              _Items(items: entry.items, action: itemAction),
            ]
          else
            _Items(items: section.items, action: itemAction),
        ],
      ],
    );
  }
}

class _Items extends StatelessWidget {
  const _Items({required this.items, required this.action});
  final List<ReadItem> items;
  final Widget? Function(ReadItem item)? action;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final item in items)
          Container(
            padding: const EdgeInsets.symmetric(vertical: FieldSpace.s2),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: c.line)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Semantics(
                  key: ValueKey('read.${item.path}'),
                  container: true,
                  readOnly: true,
                  label: item.labels.join(', '),
                  // Said rather than shown: on screen the struck old value under it is the answer.
                  value: item.value ?? 'No answer now',
                  excludeSemantics: true,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(item.labels.join(', '), style: text.labelLarge?.copyWith(color: c.inkMuted)),
                      if (item.value case final value?) ...[
                        const SizedBox(height: FieldSpace.s1),
                        Text(value, style: text.bodyLarge),
                      ],
                    ],
                  ),
                ),
                for (final (i, correction) in item.corrections.indexed)
                  _Correction(key: ValueKey('read.${item.path}.correction.$i'), correction: correction),
                if (action?.call(item) case final widget?) ...[const SizedBox(height: FieldSpace.s1), widget],
              ],
            ),
          ),
      ],
    );
  }
}

/// One old value: struck through on screen, read as what it replaced, with who, when and why.
class _Correction extends StatelessWidget {
  const _Correction({super.key, required this.correction});
  final ReadCorrection correction;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final ReadCorrection(:old, :by, :credential, :at, :reason) = correction;
    final who = [by, ?credentialText(credential), _when(context, at)].join(', ');
    return Semantics(
      container: true,
      child: Container(
        margin: const EdgeInsets.only(top: FieldSpace.s2),
        padding: const EdgeInsets.only(left: FieldSpace.s3),
        decoration: BoxDecoration(
          border: Border(left: BorderSide(color: c.lineStrong, width: 2)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              label: 'Replaced: ${old ?? 'blank'}',
              excludeSemantics: true,
              child: Text(
                old ?? '(blank)',
                style: text.bodyLarge?.copyWith(decoration: TextDecoration.lineThrough, decorationColor: c.ink),
              ),
            ),
            Text('Changed by $who', style: text.bodyMedium?.copyWith(color: c.inkMuted)),
            Text('Reason: $reason', style: text.bodyMedium?.copyWith(color: c.inkMuted)),
          ],
        ),
      ),
    );
  }
}

/// A correction's time on this phone's clock ("November 2, 2026 at 10:00 AM"); as it came when it
/// isn't one.
String _when(BuildContext context, String at) {
  final t = DateTime.tryParse(at);
  return t == null ? at : '${longDate(t)} at ${timeOfDay(context, t)}';
}
