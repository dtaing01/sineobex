import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/theme/tokens.dart';
import '../data/models/models.dart';

/// The teardrop marker from the prototype.
///
/// Leaflet drew it as a `divIcon` containing a square with
/// `border-radius: 50% 50% 50% 0` rotated -45°, which yields a circle with one
/// pointed corner at the bottom. This paints that shape directly.
class MapPin extends StatelessWidget {
  const MapPin({
    super.key,
    required this.color,
    this.size = 20,
    this.showCenterDot = true,
    this.borderWidth = 1.5,
  });

  /// Risk-coloured patient pin: blue / amber / red.
  factory MapPin.risk(RiskLevel risk, {double size = 20, bool dot = true}) =>
      MapPin(color: colorForRisk(risk), size: size, showCenterDot: dot);

  final Color color;
  final double size;
  final bool showCenterDot;
  final double borderWidth;

  static Color colorForRisk(RiskLevel risk) => switch (risk) {
    RiskLevel.high => AppColors.red500,
    RiskLevel.moderate => AppColors.amber500,
    RiskLevel.low => AppColors.blue500,
  };

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(size, size * 1.2),
      painter: _PinPainter(
        color: color,
        showCenterDot: showCenterDot,
        borderWidth: borderWidth,
      ),
    );
  }
}

class _PinPainter extends CustomPainter {
  const _PinPainter({
    required this.color,
    required this.showCenterDot,
    required this.borderWidth,
  });

  final Color color;
  final bool showCenterDot;
  final double borderWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final radius = size.width / 2;
    final center = Offset(radius, radius);
    final tip = Offset(radius, size.height);

    // Circle plus a triangle down to the tip, tangent to the circle so the
    // silhouette reads as one continuous teardrop.
    final path = Path()
      ..addOval(Rect.fromCircle(center: center, radius: radius));

    final dx = tip.dx - center.dx;
    final dy = tip.dy - center.dy;
    final distance = math.sqrt(dx * dx + dy * dy);
    if (distance > radius) {
      final angle = math.acos(radius / distance);
      final base = math.atan2(dy, dx);
      final left = Offset(
        center.dx + radius * math.cos(base + angle),
        center.dy + radius * math.sin(base + angle),
      );
      final right = Offset(
        center.dx + radius * math.cos(base - angle),
        center.dy + radius * math.sin(base - angle),
      );
      path.addPath(
        Path()
          ..moveTo(left.dx, left.dy)
          ..lineTo(tip.dx, tip.dy)
          ..lineTo(right.dx, right.dy)
          ..close(),
        Offset.zero,
      );
    }

    final unioned = path..fillType = PathFillType.nonZero;

    canvas.drawShadow(unioned, const Color(0x55000000), 2, false);
    canvas.drawPath(unioned, Paint()..color = color);
    canvas.drawPath(
      unioned,
      Paint()
        ..color = AppColors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = borderWidth,
    );

    if (showCenterDot) {
      canvas.drawCircle(
        center,
        radius * 0.35,
        Paint()..color = AppColors.white,
      );
    }
  }

  @override
  bool shouldRepaint(_PinPainter old) =>
      old.color != color ||
      old.showCenterDot != showCenterDot ||
      old.borderWidth != borderWidth;
}

/// The circular emoji badge used for partner facilities.
class ResourcePin extends StatelessWidget {
  const ResourcePin({super.key, required this.type, this.size = 24});

  final ResourceType type;
  final double size;

  /// Shelters and hospitals are green (places to send someone); everything
  /// else is blue (services to use).
  static Color colorFor(ResourceType t) =>
      (t == ResourceType.shelter || t == ResourceType.hospital)
      ? AppColors.emerald500
      : AppColors.blue500;

  static Color fillFor(ResourceType t) =>
      (t == ResourceType.shelter || t == ResourceType.hospital)
      ? AppColors.green100
      : AppColors.blue100;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: fillFor(type),
        shape: BoxShape.circle,
        border: Border.all(color: colorFor(type), width: 2),
        boxShadow: AppShadows.sm,
      ),
      alignment: Alignment.center,
      child: Text(type.emoji, style: TextStyle(fontSize: size * 0.5)),
    );
  }
}

/// The floating white legend that sits over the map.
class MapLegend extends StatelessWidget {
  const MapLegend({
    super.key,
    required this.title,
    required this.entries,
    this.padding = const EdgeInsets.all(AppSpace.x4),
    this.minWidth = 160,
  });

  const MapLegend.compact({super.key, required this.entries})
    : title = null,
      padding = const EdgeInsets.all(AppSpace.x2),
      minWidth = 0;

  final String? title;
  final List<MapLegendEntry> entries;
  final EdgeInsets padding;
  final double minWidth;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(minWidth: minWidth),
      padding: padding,
      decoration: BoxDecoration(
        color: AppColors.white.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.slate100),
        boxShadow: AppShadows.lg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (title != null) ...[
            Text(
              title!.toUpperCase(),
              style: const TextStyle(
                fontSize: AppText.mini,
                fontWeight: AppText.bold,
                color: AppColors.slate400,
                letterSpacing: AppText.wider,
              ),
            ),
            const SizedBox(height: AppSpace.x2),
          ],
          for (var i = 0; i < entries.length; i++) ...[
            if (i > 0) const SizedBox(height: AppSpace.x1_5),
            entries[i],
          ],
        ],
      ),
    );
  }
}

class MapLegendEntry extends StatelessWidget {
  const MapLegendEntry({
    super.key,
    required this.label,
    this.color,
    this.emoji,
    this.emojiFill,
    this.emojiBorder,
    this.dotSize = 10,
    this.fontSize = AppText.micro,
  });

  final String label;
  final Color? color;
  final String? emoji;
  final Color? emojiFill;
  final Color? emojiBorder;
  final double dotSize;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (emoji != null)
          Container(
            width: 16,
            height: 16,
            decoration: BoxDecoration(
              color: emojiFill,
              shape: BoxShape.circle,
              border: Border.all(color: emojiBorder ?? AppColors.slate200),
            ),
            alignment: Alignment.center,
            child: Text(emoji!, style: const TextStyle(fontSize: AppText.xxs)),
          )
        else
          Container(
            width: dotSize,
            height: dotSize,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
        const SizedBox(width: AppSpace.x2),
        Text(
          label,
          style: TextStyle(
            fontSize: fontSize,
            fontWeight: AppText.medium,
            color: AppColors.slate600,
          ),
        ),
      ],
    );
  }
}
