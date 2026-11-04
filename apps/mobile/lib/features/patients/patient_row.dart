import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/allergy_badge.dart';
import '../../design/widgets/status_chip.dart';
import '../../patients/patient_search.dart';
import 'patient_labels.dart';

/// The name a list shows for someone: what they go by, else a street name, else what they look
/// like. Never a legal name (D40).
String listName(FoundPatient p) =>
    p.preferredName ?? (p.aliases.isEmpty ? null : p.aliases.first) ?? p.visualDescriptor ?? 'No name recorded';

/// Everything a result row shows, as one sentence for a screen reader (design 12.1): "Del, also
/// known as Smitty, born 1946, age 80, usually found by the Elm St underpass, last seen October 3.
/// Allergy: penicillin, severe. Matched: close to a street name."
String rowLabel(FoundPatient p, DateTime today) {
  final name = listName(p);
  final aka = [
    for (final a in p.aliases)
      if (a != name) a,
  ];
  final parts = <String>[
    name,
    if (aka.isNotEmpty) 'also known as ${aka.join(', ')}',
    if (p.birth != null) birthRowLabel(p.birth!, today).spoken,
    if (p.usualArea != null) 'usually found ${p.usualArea}',
    if (isoDay(p.lastSeenOn) case final seen?) 'last seen ${longDate(seen).replaceFirst(', ${today.year}', '')}',
    if (p.visualDescriptor != null && p.visualDescriptor != name) 'looks like ${p.visualDescriptor}',
  ];
  final allergies = p.badge?.spoken ?? _countText(p);
  final why = matchReasonTexts(p.reasons);
  return [
    parts.join(', '),
    allergies,
    if (p.possibleDuplicate) 'Possible duplicate',
    if (p.notSynced) 'On this phone only',
    if (why.isNotEmpty) 'Matched: ${why.join(', ').toLowerCase()}',
  ].join('. ');
}

String _countText(FoundPatient p) => p.allergyCount == 0
    ? 'No allergies listed'
    : '${p.allergyCount == 1 ? '1 allergy' : '${p.allergyCount} allergies'}${p.severeAllergy ? ', one severe' : ''}';

/// One person in a result list: one button whose label reads the whole row.
class PatientRow extends StatelessWidget {
  const PatientRow({super.key, required this.patient, required this.today, required this.onTap, this.trailing});
  final FoundPatient patient;
  final DateTime today;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final p = patient;
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final muted = text.bodyMedium?.copyWith(color: c.inkMuted);
    final name = listName(p);
    final aka = [
      for (final a in p.aliases)
        if (a != name) a,
    ];
    final why = matchReasonTexts(p.reasons);
    final seen = isoDay(p.lastSeenOn);
    return Semantics(
      button: true,
      label: rowLabel(p, today),
      excludeSemantics: true,
      child: Material(
        color: c.surface,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: c.line),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(FieldRadius.md),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: FieldTap.large),
            child: Padding(
              padding: const EdgeInsets.all(FieldSpace.s3),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name, style: text.titleMedium),
                        if (aka.isNotEmpty) Text('aka ${aka.join(', ')}', style: text.bodyLarge),
                        Wrap(
                          spacing: FieldSpace.s3,
                          children: [
                            if (p.birth != null) Text(birthRowLabel(p.birth!, today).text, style: text.bodyMedium),
                            if (seen != null) Text('last seen ${shortDate(seen, today)}', style: muted),
                          ],
                        ),
                        if (p.usualArea != null) Text(p.usualArea!, style: text.bodyMedium),
                        if (p.visualDescriptor != null && p.visualDescriptor != name)
                          Text(p.visualDescriptor!, style: muted),
                        const SizedBox(height: FieldSpace.s2),
                        Wrap(
                          spacing: FieldSpace.s2,
                          runSpacing: FieldSpace.s1,
                          children: [
                            if (p.badge case final badge?)
                              AllergyBadgeView(badge: badge, compact: true)
                            else
                              AllergyCountBadge(count: p.allergyCount, severe: p.severeAllergy),
                            if (p.possibleDuplicate)
                              const StatusChip(
                                label: 'Possible duplicate',
                                icon: LucideIcons.users,
                                tone: ChipTone.warning,
                              ),
                            if (p.notSynced)
                              const StatusChip(
                                label: 'On this phone only',
                                icon: LucideIcons.smartphone,
                                tone: ChipTone.info,
                              ),
                          ],
                        ),
                        if (why.isNotEmpty) ...[
                          const SizedBox(height: FieldSpace.s1),
                          Text(why.join(' · '), style: muted),
                        ],
                      ],
                    ),
                  ),
                  ?trailing,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
