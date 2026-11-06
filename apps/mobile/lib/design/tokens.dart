// Sineobex Field design tokens, transcribed from the design system
// (https://claude.ai/artifact/5HMw4MtUiGeuP21s91i21V), the same values as
// apps/website/src/styles/tokens.css. Update by re-copying; never tune a value here.
import 'package:flutter/widgets.dart';

/// The three themes in module 15: Day, Night run and High contrast (7:1).
enum FieldTheme { day, night, contrast }

@immutable
class FieldColors {
  const FieldColors({
    required this.ground,
    required this.surface,
    required this.surfaceSunken,
    required this.ink,
    required this.inkMuted,
    required this.line,
    required this.lineStrong,
    required this.accent,
    required this.onAccent,
    required this.accentSoft,
    required this.hivis,
    required this.inkOnHivis,
    required this.critical,
    required this.criticalSoft,
    required this.warning,
    required this.warningSoft,
    required this.good,
    required this.goodSoft,
    required this.info,
    required this.infoSoft,
  });

  final Color ground;
  final Color surface;
  final Color surfaceSunken;
  final Color ink;
  final Color inkMuted;
  final Color line;
  final Color lineStrong;
  final Color accent;
  final Color onAccent;
  final Color accentSoft;
  final Color hivis;
  final Color inkOnHivis;
  final Color critical;
  final Color criticalSoft;
  final Color warning;
  final Color warningSoft;
  final Color good;
  final Color goodSoft;
  final Color info;
  final Color infoSoft;

  Color get focusRing => accent;

  static const day = FieldColors(
    ground: Color(0xFFEEF1EF),
    surface: Color(0xFFFFFFFF),
    surfaceSunken: Color(0xFFE3E8E6),
    ink: Color(0xFF121A19),
    inkMuted: Color(0xFF4A5755),
    line: Color(0xFFC9D1CE),
    lineStrong: Color(0xFF7B8784),
    accent: Color(0xFF0A6B66),
    onAccent: Color(0xFFFFFFFF),
    accentSoft: Color(0xFFD6ECE9),
    hivis: Color(0xFFE8590C),
    inkOnHivis: Color(0xFF121A19),
    critical: Color(0xFFB42318),
    criticalSoft: Color(0xFFFBE4E1),
    warning: Color(0xFF8A5300),
    warningSoft: Color(0xFFFCEFD3),
    good: Color(0xFF1E6B35),
    goodSoft: Color(0xFFDDF0E2),
    info: Color(0xFF2251A3),
    infoSoft: Color(0xFFE1EAF8),
  );

  static const night = FieldColors(
    ground: Color(0xFF0F1514),
    surface: Color(0xFF18201F),
    surfaceSunken: Color(0xFF0A0F0E),
    ink: Color(0xFFEEF2F1),
    inkMuted: Color(0xFFA5B1AE),
    line: Color(0xFF2C3634),
    lineStrong: Color(0xFF6E7B78),
    accent: Color(0xFF4FC2B8),
    onAccent: Color(0xFF06201E),
    accentSoft: Color(0xFF10302D),
    hivis: Color(0xFFFF7A2E),
    inkOnHivis: Color(0xFF121A19),
    critical: Color(0xFFFF8A80),
    criticalSoft: Color(0xFF3A1512),
    warning: Color(0xFFF5B83D),
    warningSoft: Color(0xFF33250A),
    good: Color(0xFF6FD08C),
    goodSoft: Color(0xFF12301B),
    info: Color(0xFF8DB4F5),
    infoSoft: Color(0xFF132440),
  );

  static const contrast = FieldColors(
    ground: Color(0xFFFFFFFF),
    surface: Color(0xFFFFFFFF),
    surfaceSunken: Color(0xFFECEFEE),
    ink: Color(0xFF000000),
    inkMuted: Color(0xFF28302F),
    line: Color(0xFF8E9896),
    lineStrong: Color(0xFF3D4645),
    accent: Color(0xFF00504B),
    onAccent: Color(0xFFFFFFFF),
    accentSoft: Color(0xFFD3EBE8),
    hivis: Color(0xFFE8590C),
    inkOnHivis: Color(0xFF000000),
    critical: Color(0xFF8A1208),
    criticalSoft: Color(0xFFFBE1DD),
    warning: Color(0xFF5A3600),
    warningSoft: Color(0xFFFBEBC8),
    good: Color(0xFF0E4620),
    goodSoft: Color(0xFFD6EEDC),
    info: Color(0xFF123A7C),
    infoSoft: Color(0xFFDCE6F7),
  );

  static FieldColors of(FieldTheme theme) => switch (theme) {
    FieldTheme.day => day,
    FieldTheme.night => night,
    FieldTheme.contrast => contrast,
  };
}

/// Spacing, radii and tap targets. 48 px minimum targets are for gloved hands (module 15).
abstract final class FieldSpace {
  static const double s1 = 4;
  static const double s2 = 8;
  static const double s3 = 12;
  static const double s4 = 16;
  static const double s5 = 24;
  static const double s6 = 32;
  static const double s7 = 48;
}

abstract final class FieldRadius {
  static const double sm = 6;
  static const double md = 10;
  static const double lg = 16;
  static const double pill = 999;
}

abstract final class FieldTap {
  static const double min = 48;
  static const double large = 56;
}

abstract final class FieldFonts {
  static const String sans = 'AtkinsonHyperlegibleNext';
  static const String label = 'BarlowCondensed';
  static const String mono = 'AtkinsonHyperlegibleMono';
}
