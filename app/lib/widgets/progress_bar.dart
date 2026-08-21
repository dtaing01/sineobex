import 'package:flutter/material.dart';

import '../core/theme/tokens.dart';

/// A rounded track with a coloured fill — the inventory stock bar, the
/// continuity metrics, and the grant mini-bars.
class ProgressBar extends StatelessWidget {
  const ProgressBar({
    super.key,
    required this.value,
    required this.color,
    this.height = 6,
    this.track = AppColors.slate100,
    this.animate = false,
    this.animationDelay = Duration.zero,
  });

  /// 0.0 – 1.0.
  final double value;
  final Color color;
  final double height;
  final Color track;

  /// The prototype animates the continuity bars from zero on mount.
  final bool animate;
  final Duration animationDelay;

  @override
  Widget build(BuildContext context) {
    final clamped = value.clamp(0.0, 1.0);

    Widget fill(double fraction) => FractionallySizedBox(
          alignment: Alignment.centerLeft,
          widthFactor: fraction,
          child: Container(
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(height),
            ),
          ),
        );

    return ClipRRect(
      borderRadius: BorderRadius.circular(height),
      child: Container(
        height: height,
        color: track,
        child: animate
            ? TweenAnimationBuilder<double>(
                tween: Tween(begin: 0, end: clamped),
                duration: const Duration(milliseconds: 1000),
                curve: Curves.easeOutCubic,
                builder: (_, v, __) => fill(v),
              )
            : fill(clamped),
      ),
    );
  }
}
