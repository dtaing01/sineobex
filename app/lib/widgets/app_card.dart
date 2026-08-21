import 'package:flutter/material.dart';

import '../core/theme/tokens.dart';

/// The prototype's `<Card>` — a white rounded surface with a slate border and
/// an optional coloured left rail (`border-l-4 border-l-red-500`).
class AppCard extends StatefulWidget {
  const AppCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(AppSpace.x4),
    this.background = AppColors.white,
    this.borderColor = AppColors.slate200,
    this.leftRailColor,
    this.radius = AppRadius.xl,
    this.shadows,
    this.clip = false,
    this.opacity = 1.0,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final Color background;
  final Color? borderColor;

  /// `border-l-4 border-l-{color}`
  final Color? leftRailColor;

  final double radius;
  final List<BoxShadow>? shadows;

  /// `overflow-hidden` — required when a map or chart bleeds to the edge.
  final bool clip;

  final double opacity;

  @override
  State<AppCard> createState() => _AppCardState();
}

class _AppCardState extends State<AppCard> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(widget.radius);

    Widget card = AnimatedScale(
      // `active:scale-[0.98]`
      scale: _pressed ? 0.98 : 1.0,
      duration: const Duration(milliseconds: 80),
      child: Container(
        decoration: BoxDecoration(
          color: widget.background,
          borderRadius: radius,
          border: widget.borderColor == null
              ? null
              : Border.all(color: widget.borderColor!),
          boxShadow: widget.shadows,
        ),
        clipBehavior: widget.clip ? Clip.antiAlias : Clip.none,
        child: widget.leftRailColor == null
            ? Padding(padding: widget.padding, child: widget.child)
            : Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(width: 4, color: widget.leftRailColor),
                  Expanded(
                    child: Padding(
                      padding: widget.padding,
                      child: widget.child,
                    ),
                  ),
                ],
              ),
      ),
    );

    if (widget.opacity != 1.0) {
      card = Opacity(opacity: widget.opacity, child: card);
    }

    if (widget.onTap == null) return card;

    return GestureDetector(
      onTap: widget.onTap,
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      behavior: HitTestBehavior.opaque,
      child: card,
    );
  }
}

/// A left-aligned uppercase section heading with wide tracking, optionally
/// prefixed by an icon — the prototype's most repeated element.
class SectionHeader extends StatelessWidget {
  const SectionHeader(
    this.label, {
    super.key,
    this.icon,
    this.trailing,
  });

  final String label;
  final IconData? icon;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final heading = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[
          Icon(icon, size: 14, color: AppColors.slate400),
          const SizedBox(width: AppSpace.x2),
        ],
        Flexible(
          child: Text(
            label.toUpperCase(),
            style: const TextStyle(
              fontSize: AppText.xs,
              fontWeight: AppText.bold,
              color: AppColors.slate400,
              letterSpacing: AppText.widest,
            ),
          ),
        ),
      ],
    );

    if (trailing == null) return heading;

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [Flexible(child: heading), trailing!],
    );
  }
}

/// `text-[10px] font-bold uppercase text-slate-400` — form and stat labels.
class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key, this.color = AppColors.slate400});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Text(
        text.toUpperCase(),
        style: TextStyle(
          fontSize: AppText.micro,
          fontWeight: AppText.bold,
          color: color,
          letterSpacing: 0.4,
        ),
      );
}
