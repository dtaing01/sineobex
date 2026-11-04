import 'package:flutter/material.dart';

import '../theme.dart';
import '../tokens.dart';

/// The colour family of a chip or badge. State is never colour alone (design 12): every chip has
/// words and an icon.
enum ChipTone { neutral, info, good, warning, critical }

/// Text and background for [tone]; each pair is held to 4.5:1 (7:1 in High contrast) by
/// test/design/contrast_test.dart.
({Color fg, Color bg, Color border}) toneColors(FieldColors c, ChipTone tone) => switch (tone) {
  ChipTone.neutral => (fg: c.ink, bg: c.surfaceSunken, border: c.lineStrong),
  ChipTone.info => (fg: c.info, bg: c.infoSoft, border: c.info),
  ChipTone.good => (fg: c.good, bg: c.goodSoft, border: c.good),
  ChipTone.warning => (fg: c.warning, bg: c.warningSoft, border: c.warning),
  ChipTone.critical => (fg: c.critical, bg: c.criticalSoft, border: c.critical),
};

/// A state in words with an icon ("Possible duplicate", "On this phone only", "Pending"). Not a
/// button; it wraps at large text instead of clipping.
class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.icon, this.tone = ChipTone.neutral, this.spoken});

  final String label;
  final IconData icon;
  final ChipTone tone;

  /// What a screen reader says, when it differs from [label].
  final String? spoken;

  @override
  Widget build(BuildContext context) {
    final t = toneColors(context.field, tone);
    final style = Theme.of(context).textTheme.bodyMedium?.copyWith(color: t.fg, fontWeight: FontWeight.w700);
    return Semantics(
      label: spoken ?? label,
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: FieldSpace.s2, vertical: FieldSpace.s1),
        decoration: BoxDecoration(
          color: t.bg,
          border: Border.all(color: t.border),
          borderRadius: BorderRadius.circular(FieldRadius.sm),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: t.fg),
            const SizedBox(width: FieldSpace.s1),
            Flexible(child: Text(label, style: style)),
          ],
        ),
      ),
    );
  }
}

/// A sentence in a tinted box with an icon: a profile banner, a card state, a notice. Read as one
/// item; [action] (a button) follows it.
class StatusBanner extends StatelessWidget {
  const StatusBanner({
    super.key,
    required this.icon,
    required this.tone,
    required this.text,
    this.detail,
    this.action,
    this.live = false,
  });

  final IconData icon;
  final ChipTone tone;
  final String text;
  final String? detail;
  final Widget? action;

  /// Announced when it appears (a confirmation, a copy).
  final bool live;

  @override
  Widget build(BuildContext context) {
    final t = toneColors(context.field, tone);
    final theme = Theme.of(context).textTheme;
    return Semantics(
      container: true,
      liveRegion: live,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(FieldSpace.s3),
        decoration: BoxDecoration(
          color: t.bg,
          border: Border.all(color: t.border, width: 1.5),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ExcludeSemantics(child: Icon(icon, size: 22, color: t.fg)),
            const SizedBox(width: FieldSpace.s2),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(text, style: theme.bodyLarge?.copyWith(fontWeight: FontWeight.w700, color: t.fg)),
                  if (detail != null) ...[
                    const SizedBox(height: FieldSpace.s1),
                    Text(detail!, style: theme.bodyMedium?.copyWith(color: context.field.ink)),
                  ],
                  if (action != null) ...[const SizedBox(height: FieldSpace.s2), action!],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
