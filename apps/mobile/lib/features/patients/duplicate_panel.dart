import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/generated/api.dart' show MatchBand;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/allergy_badge.dart';
import '../../design/widgets/status_chip.dart';
import '../../patients/display.dart';
import '../../patients/patient_search.dart';
import 'patient_labels.dart';
import 'patient_row.dart';

/// Possible matches as the intake is typed (design 8.1): an inline panel under the name fields,
/// never a dialog, one card per candidate at or above "possible", likely ones first. Announced
/// politely; focus stays where the worker is typing. Never a legal name (D40).
class DuplicatePanel extends StatelessWidget {
  const DuplicatePanel({
    super.key,
    required this.run,
    required this.dismissed,
    required this.today,
    required this.now,
    required this.onThisIsThem,
    required this.onNotThem,
    required this.onUndo,
  });

  final MatchRun run;
  final Set<String> dismissed;
  final DateTime today;
  final DateTime now;
  final ValueChanged<FoundPatient> onThisIsThem;
  final ValueChanged<FoundPatient> onNotThem;
  final ValueChanged<FoundPatient> onUndo;

  @override
  Widget build(BuildContext context) {
    final candidates = run.candidates;
    if (candidates.isEmpty) return const SizedBox.shrink();
    final text = Theme.of(context).textTheme;
    final c = context.field;
    final at = run.listUpdatedAt;
    final open = candidates.where((p) => !dismissed.contains(p.patientId)).length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          liveRegion: true,
          child: Text(
            open == 0
                ? 'No possible matches left to check'
                : (open == 1 ? '1 possible match' : '$open possible matches'),
            style: text.titleMedium,
          ),
        ),
        if (run.source == ListSource.phone) ...[
          const SizedBox(height: FieldSpace.s1),
          Text(
            'Checked against the patient list on this phone'
            '${at == null ? '' : ' (updated ${ago(at, now)})'}. The server checks again when this syncs.',
            style: text.bodyMedium?.copyWith(color: c.inkMuted),
          ),
        ],
        const SizedBox(height: FieldSpace.s2),
        for (final p in candidates) ...[
          if (dismissed.contains(p.patientId))
            _Folded(patient: p, onUndo: () => onUndo(p))
          else
            _Candidate(patient: p, today: today, onThisIsThem: () => onThisIsThem(p), onNotThem: () => onNotThem(p)),
          const SizedBox(height: FieldSpace.s2),
        ],
      ],
    );
  }
}

class _Candidate extends StatelessWidget {
  const _Candidate({required this.patient, required this.today, required this.onThisIsThem, required this.onNotThem});
  final FoundPatient patient;
  final DateTime today;
  final VoidCallback onThisIsThem;
  final VoidCallback onNotThem;

  @override
  Widget build(BuildContext context) {
    final p = patient;
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final likely = p.band == MatchBand.likely;
    final name = listName(p);
    final why = matchReasonTexts(p.reasons);
    final seen = isoDay(p.lastSeenOn);
    final birth = p.birth == null ? null : birthLabel(p.birth!, today);
    // Read row by row: what matched, then what the record holds.
    final summary = [
      likely ? 'Likely the same person' : 'Possibly the same person',
      name,
      if (p.aliases.where((a) => a != name).isNotEmpty) 'also known as ${p.aliases.where((a) => a != name).join(', ')}',
      if (birth != null) birth.spoken,
      if (p.usualArea != null) 'usually found ${p.usualArea}',
      if (p.visualDescriptor != null && p.visualDescriptor != name) 'looks like ${p.visualDescriptor}',
      if (seen != null) 'last seen ${longDate(seen)}',
      if (why.isNotEmpty) 'Why: ${why.join('; ')}',
    ].join('. ');
    return Semantics(
      container: true,
      child: Container(
        padding: const EdgeInsets.all(FieldSpace.s3),
        decoration: BoxDecoration(
          color: likely ? c.warningSoft : c.surface,
          border: Border.all(color: likely ? c.warning : c.lineStrong, width: 1.5),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              label: summary,
              excludeSemantics: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  StatusChip(
                    label: likely ? 'Likely the same person' : 'Possibly the same person',
                    icon: LucideIcons.users,
                    tone: likely ? ChipTone.warning : ChipTone.neutral,
                  ),
                  const SizedBox(height: FieldSpace.s2),
                  Text(name, style: text.titleMedium),
                  if (p.aliases.where((a) => a != name).isNotEmpty)
                    Text('aka ${p.aliases.where((a) => a != name).join(', ')}', style: text.bodyLarge),
                  if (birth != null) Text(birth.text, style: text.bodyLarge),
                  if (p.usualArea != null) Text('Usually: ${p.usualArea}', style: text.bodyMedium),
                  if (p.visualDescriptor != null && p.visualDescriptor != name)
                    Text(p.visualDescriptor!, style: text.bodyMedium),
                  if (seen != null) Text('Last seen ${shortDate(seen, today)}', style: text.bodyMedium),
                  if (why.isNotEmpty) ...[
                    const SizedBox(height: FieldSpace.s1),
                    Text(why.join(' · '), style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                  ],
                  if (p.badge case final badge?) ...[
                    const SizedBox(height: FieldSpace.s2),
                    AllergyBadgeView(badge: badge, compact: true),
                  ],
                ],
              ),
            ),
            const SizedBox(height: FieldSpace.s3),
            Wrap(
              spacing: FieldSpace.s2,
              runSpacing: FieldSpace.s2,
              children: [
                FilledButton(onPressed: onThisIsThem, child: const Text('This is them')),
                OutlinedButton(onPressed: onNotThem, child: const Text('Not them')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// A dismissed card, folded to one line: "Not Del · Undo".
class _Folded extends StatelessWidget {
  const _Folded({required this.patient, required this.onUndo});
  final FoundPatient patient;
  final VoidCallback onUndo;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(child: Text('Not ${listName(patient)}', style: Theme.of(context).textTheme.bodyLarge)),
      TextButton(
        onPressed: onUndo,
        child: Semantics(
          label: 'Undo: ${listName(patient)} might be them',
          excludeSemantics: true,
          child: const Text('Undo'),
        ),
      ),
    ],
  );
}
