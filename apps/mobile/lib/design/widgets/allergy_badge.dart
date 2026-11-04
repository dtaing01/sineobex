import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../patients/display.dart';
import '../theme.dart';
import '../tokens.dart';
import 'status_chip.dart';

/// The allergy badge (design 12.1): "Allergies: penicillin (severe), peanuts", "No known
/// allergies" or "Allergies not asked yet", each with its own icon, so the state never rests on
/// colour. The words come from `allergyBadge()` (lib/patients/display.dart), one rule for the
/// profile header, the index row and search results.
class AllergyBadgeView extends StatelessWidget {
  const AllergyBadgeView({super.key, required this.badge, this.compact = false});

  final AllergyBadge badge;

  /// A result row's smaller form.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final (icon, tone) = switch (badge.kind) {
      AllergyBadgeKind.allergies => (LucideIcons.triangleAlert, ChipTone.critical),
      AllergyBadgeKind.noneKnown => (LucideIcons.circleCheck, ChipTone.good),
      AllergyBadgeKind.notAsked => (LucideIcons.circleHelp, ChipTone.warning),
    };
    return _Badge(icon: icon, tone: tone, text: badge.text, spoken: badge.spoken, compact: compact);
  }
}

/// A result the server found and this phone holds no allergies for: only how many, and whether
/// one is severe.
class AllergyCountBadge extends StatelessWidget {
  const AllergyCountBadge({super.key, required this.count, required this.severe});
  final int count;
  final bool severe;

  @override
  Widget build(BuildContext context) {
    final text = count == 0
        ? 'No allergies listed'
        : '${count == 1 ? '1 allergy' : '$count allergies'}${severe ? ', one severe' : ''}';
    return _Badge(
      icon: count == 0 ? LucideIcons.circleHelp : LucideIcons.triangleAlert,
      tone: count == 0 ? ChipTone.warning : ChipTone.critical,
      text: text,
      spoken: text,
      compact: true,
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.icon, required this.tone, required this.text, required this.spoken, required this.compact});
  final IconData icon;
  final ChipTone tone;
  final String text;
  final String spoken;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final t = toneColors(context.field, tone);
    final theme = Theme.of(context).textTheme;
    final style = (compact ? theme.bodyMedium : theme.bodyLarge)?.copyWith(color: t.fg, fontWeight: FontWeight.w700);
    return Semantics(
      label: spoken,
      excludeSemantics: true,
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: compact ? FieldSpace.s2 : FieldSpace.s3,
          vertical: compact ? FieldSpace.s1 : FieldSpace.s2,
        ),
        decoration: BoxDecoration(
          color: t.bg,
          border: Border.all(color: t.border, width: compact ? 1 : 1.5),
          borderRadius: BorderRadius.circular(FieldRadius.sm),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(icon, size: compact ? 16 : 20, color: t.fg),
            ),
            const SizedBox(width: FieldSpace.s1),
            Flexible(child: Text(text, style: style)),
          ],
        ),
      ),
    );
  }
}
