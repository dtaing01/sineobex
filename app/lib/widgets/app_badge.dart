import 'package:flutter/material.dart';

import '../core/theme/tokens.dart';
import '../data/models/models.dart';

/// The prototype's `<Badge>`: a small pill of uppercase bold text.
class AppBadge extends StatelessWidget {
  const AppBadge(
    this.label, {
    super.key,
    this.background = AppColors.slate100,
    this.foreground = AppColors.slate600,
    this.borderColor,
    this.fontSize = AppText.tiny,
    this.uppercase = true,
    this.padding = const EdgeInsets.symmetric(
      horizontal: AppSpace.x2,
      vertical: 2,
    ),
    this.leading,
  });

  /// `variant="outline"` — transparent fill, visible border.
  const AppBadge.outline(
    this.label, {
    super.key,
    required Color color,
    Color? border,
    Color? fill,
    this.fontSize = AppText.tiny,
    this.uppercase = true,
    this.padding = const EdgeInsets.symmetric(
      horizontal: AppSpace.x2,
      vertical: 2,
    ),
    this.leading,
  }) : background = fill ?? AppColors.transparent,
       foreground = color,
       borderColor = border ?? color;

  final String label;
  final Color background;
  final Color foreground;
  final Color? borderColor;
  final double fontSize;
  final bool uppercase;
  final EdgeInsets padding;
  final Widget? leading;

  /// Risk badge colours, shared by the patient list, detail header, and map
  /// popups so they can never drift apart.
  factory AppBadge.risk(RiskLevel risk, {double fontSize = AppText.tiny}) {
    final (bg, fg) = switch (risk) {
      RiskLevel.high => (AppColors.red100, AppColors.red700),
      RiskLevel.moderate => (AppColors.orange100, AppColors.orange700),
      RiskLevel.low => (AppColors.slate100, AppColors.slate600),
    };
    return AppBadge(
      '${risk.label} Risk',
      background: bg,
      foreground: fg,
      fontSize: fontSize,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: borderColor == null ? null : Border.all(color: borderColor!),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: 4)],
          Text(
            uppercase ? label.toUpperCase() : label,
            style: TextStyle(
              fontSize: fontSize,
              fontWeight: AppText.bold,
              color: foreground,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

/// A small filled circle used as a status indicator, optionally pulsing —
/// the prototype's `animate-pulse` dot on the grant summary card.
class StatusDot extends StatefulWidget {
  const StatusDot({
    super.key,
    required this.color,
    this.size = 6,
    this.pulse = false,
  });

  final Color color;
  final double size;
  final bool pulse;

  @override
  State<StatusDot> createState() => _StatusDotState();
}

class _StatusDotState extends State<StatusDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2000),
  );

  @override
  void initState() {
    super.initState();
    if (widget.pulse) _controller.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(StatusDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.pulse && !_controller.isAnimating) {
      _controller.repeat(reverse: true);
    } else if (!widget.pulse && _controller.isAnimating) {
      _controller.stop();
      _controller.value = 1;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dot = Container(
      width: widget.size,
      height: widget.size,
      decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle),
    );
    if (!widget.pulse) return dot;
    return FadeTransition(
      opacity: Tween<double>(begin: 0.5, end: 1).animate(_controller),
      child: dot,
    );
  }
}
