import 'dart:math' as math;

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/design/tokens.dart';

/// WCAG 2.x relative luminance and contrast ratio.
double _luminance(Color c) {
  double channel(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

double contrast(Color a, Color b) {
  final la = _luminance(a);
  final lb = _luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

void main() {
  // Text pairs every screen relies on. WCAG 2.2 AA needs 4.5:1 for body text; the High contrast
  // theme promises 7:1 (module 15).
  final pairs = <String, (Color Function(FieldColors), Color Function(FieldColors))>{
    'ink on surface': ((c) => c.ink, (c) => c.surface),
    'ink on ground': ((c) => c.ink, (c) => c.ground),
    'muted ink on surface': ((c) => c.inkMuted, (c) => c.surface),
    'button text on accent': ((c) => c.onAccent, (c) => c.accent),
    'critical on critical-soft': ((c) => c.critical, (c) => c.criticalSoft),
    'warning on warning-soft': ((c) => c.warning, (c) => c.warningSoft),
    'good on good-soft': ((c) => c.good, (c) => c.goodSoft),
    'info on info-soft': ((c) => c.info, (c) => c.infoSoft),
    'ink on warning-soft (demo banner)': ((c) => c.ink, (c) => c.warningSoft),
  };

  for (final theme in FieldTheme.values) {
    final colors = FieldColors.of(theme);
    final minimum = theme == FieldTheme.contrast ? 7.0 : 4.5;
    group('${theme.name} theme', () {
      for (final entry in pairs.entries) {
        test('${entry.key} meets $minimum:1', () {
          final (fg, bg) = entry.value;
          expect(contrast(fg(colors), bg(colors)), greaterThanOrEqualTo(minimum));
        });
      }
    });
  }
}
