import 'package:flutter/material.dart';

import '../core/theme/tokens.dart';

/// The tinted callout card used on the map layers and the insights screen:
/// a coloured icon tile, a bold title, and a body paragraph.
///
/// The body renders `**emphasis**` as bold. The prototype passed these strings
/// straight into JSX, so the asterisks rendered literally — visible `**` in
/// five separate cards (plan defect D3).
class InsightCard extends StatelessWidget {
  const InsightCard({
    super.key,
    required this.title,
    required this.body,
    required this.icon,
    required this.accent,
    required this.background,
    required this.borderColor,
    required this.titleColor,
    required this.bodyColor,
  });

  /// Blue — clinical insight.
  const InsightCard.blue({
    super.key,
    required this.title,
    required this.body,
    required this.icon,
  }) : accent = AppColors.blue600,
       background = AppColors.blue50,
       borderColor = AppColors.blue100,
       titleColor = AppColors.blue900,
       bodyColor = AppColors.blue700;

  /// Green — resource insight.
  const InsightCard.green({
    super.key,
    required this.title,
    required this.body,
    required this.icon,
  }) : accent = AppColors.green600,
       background = AppColors.green50,
       borderColor = AppColors.green100,
       titleColor = AppColors.green900,
       bodyColor = AppColors.green700;

  /// Orange — strategic insight.
  const InsightCard.orange({
    super.key,
    required this.title,
    required this.body,
    required this.icon,
  }) : accent = AppColors.orange600,
       background = AppColors.orange50,
       borderColor = AppColors.orange100,
       titleColor = AppColors.orange900,
       bodyColor = AppColors.orange700;

  /// Purple — inventory insight.
  const InsightCard.purple({
    super.key,
    required this.title,
    required this.body,
    required this.icon,
  }) : accent = AppColors.purple600,
       background = AppColors.purple50,
       borderColor = AppColors.purple100,
       titleColor = AppColors.purple900,
       bodyColor = AppColors.purple700;

  final String title;
  final String body;
  final IconData icon;
  final Color accent;
  final Color background;
  final Color borderColor;
  final Color titleColor;
  final Color bodyColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpace.x4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: borderColor),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(AppSpace.x2),
            decoration: BoxDecoration(
              color: accent,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Icon(icon, size: 16, color: AppColors.white),
          ),
          const SizedBox(width: AppSpace.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: AppText.xs,
                    fontWeight: AppText.bold,
                    color: titleColor,
                  ),
                ),
                const SizedBox(height: 2),
                RichText(
                  text: TextSpan(
                    style: TextStyle(
                      fontSize: AppText.micro,
                      color: bodyColor,
                      height: 1.6,
                      fontFamily: AppText.family,
                    ),
                    children: emphasisSpans(body),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Splits a string on `**…**` into normal and bold spans.
  static List<TextSpan> emphasisSpans(String source) {
    final spans = <TextSpan>[];
    final pattern = RegExp(r'\*\*(.+?)\*\*');
    var cursor = 0;

    for (final match in pattern.allMatches(source)) {
      if (match.start > cursor) {
        spans.add(TextSpan(text: source.substring(cursor, match.start)));
      }
      spans.add(
        TextSpan(
          text: match.group(1),
          style: const TextStyle(fontWeight: AppText.bold),
        ),
      );
      cursor = match.end;
    }

    if (cursor < source.length) {
      spans.add(TextSpan(text: source.substring(cursor)));
    }
    return spans;
  }
}

/// The full-width coloured banner with an icon tile, a title/subtitle pair,
/// and a trailing action — "Patient Outreach Route", "Restock Route", etc.
class ActionBanner extends StatelessWidget {
  const ActionBanner({
    super.key,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.background,
    required this.actionLabel,
    this.onAction,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final Color background;
  final String actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpace.x4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AppRadius.xl),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(AppSpace.x2),
            decoration: BoxDecoration(
              color: AppColors.white.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Icon(icon, size: 20, color: AppColors.white),
          ),
          const SizedBox(width: AppSpace.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: AppText.xs,
                    fontWeight: AppText.bold,
                    color: AppColors.white,
                  ),
                ),
                Text(
                  subtitle,
                  style: TextStyle(
                    fontSize: AppText.micro,
                    color: AppColors.white.withValues(alpha: 0.8),
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: onAction,
            style: TextButton.styleFrom(
              foregroundColor: AppColors.white,
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.x2),
              minimumSize: const Size(0, 32),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(
              actionLabel.toUpperCase(),
              style: const TextStyle(
                fontSize: AppText.micro,
                fontWeight: AppText.bold,
                letterSpacing: 0.6,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The compact "label / value / caption" tile used in stat rows.
class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.label,
    required this.value,
    required this.caption,
    this.captionColor = AppColors.slate400,
    this.background = AppColors.slate50,
    this.borderColor = AppColors.slate100,
  });

  final String label;
  final String value;
  final String caption;
  final Color captionColor;
  final Color background;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpace.x2),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              fontSize: AppText.xxs,
              fontWeight: AppText.bold,
              color: AppColors.slate400,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: const TextStyle(
              fontSize: AppText.sm,
              fontWeight: AppText.bold,
              color: AppColors.slate900,
            ),
          ),
          Text(
            caption,
            style: TextStyle(
              fontSize: AppText.xxxs,
              fontWeight: AppText.bold,
              color: captionColor,
              letterSpacing: AppText.tighter,
            ),
          ),
        ],
      ),
    );
  }
}
