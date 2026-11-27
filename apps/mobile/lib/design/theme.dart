import 'package:flutter/material.dart';

import 'tokens.dart';

/// Theme extension so widgets can reach the full token set, not only Material's color scheme.
@immutable
class FieldPalette extends ThemeExtension<FieldPalette> {
  const FieldPalette(this.colors, this.theme);

  final FieldColors colors;
  final FieldTheme theme;

  @override
  FieldPalette copyWith({FieldColors? colors, FieldTheme? theme}) =>
      FieldPalette(colors ?? this.colors, theme ?? this.theme);

  @override
  FieldPalette lerp(ThemeExtension<FieldPalette>? other, double t) => t < 0.5 ? this : (other as FieldPalette? ?? this);
}

extension FieldThemeContext on BuildContext {
  FieldColors get field => Theme.of(this).extension<FieldPalette>()!.colors;
}

/// Variable fonts need the weight axis set explicitly; FontWeight alone doesn't move it everywhere.
TextStyle _sans(double size, double height, FontWeight weight, Color color) => TextStyle(
  fontFamily: FieldFonts.sans,
  fontSize: size,
  height: height / size,
  fontWeight: weight,
  fontVariations: [FontVariation('wght', weight.value.toDouble())],
  color: color,
);

ThemeData buildFieldTheme(FieldTheme theme) {
  final c = FieldColors.of(theme);
  final brightness = theme == FieldTheme.night ? Brightness.dark : Brightness.light;
  final scheme = ColorScheme(
    brightness: brightness,
    primary: c.accent,
    onPrimary: c.onAccent,
    primaryContainer: c.accentSoft,
    onPrimaryContainer: c.ink,
    secondary: c.accent,
    onSecondary: c.onAccent,
    tertiary: c.hivis,
    onTertiary: c.inkOnHivis,
    error: c.critical,
    onError: c.surface,
    errorContainer: c.criticalSoft,
    onErrorContainer: c.ink,
    surface: c.surface,
    onSurface: c.ink,
    onSurfaceVariant: c.inkMuted,
    surfaceContainerLowest: c.surface,
    surfaceContainerLow: c.surface,
    surfaceContainer: c.ground,
    surfaceContainerHigh: c.surfaceSunken,
    surfaceContainerHighest: c.surfaceSunken,
    outline: c.lineStrong,
    outlineVariant: c.line,
  );

  final text = TextTheme(
    headlineMedium: _sans(28, 34, FontWeight.w700, c.ink),
    headlineSmall: _sans(24, 30, FontWeight.w700, c.ink),
    titleLarge: _sans(20, 26, FontWeight.w700, c.ink),
    titleMedium: _sans(18, 24, FontWeight.w700, c.ink),
    bodyLarge: _sans(17, 24, FontWeight.w400, c.ink),
    bodyMedium: _sans(15, 22, FontWeight.w400, c.ink),
    bodySmall: _sans(13, 18, FontWeight.w400, c.inkMuted),
    labelLarge: _sans(17, 20, FontWeight.w700, c.ink),
    labelMedium: TextStyle(
      fontFamily: FieldFonts.label,
      fontSize: 14,
      height: 18 / 14,
      fontWeight: FontWeight.w600,
      letterSpacing: 14 * 0.06,
      color: c.inkMuted,
    ),
  );

  final buttonShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(FieldRadius.md));
  const minSize = Size(FieldTap.min, FieldTap.min);

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: c.ground,
    fontFamily: FieldFonts.sans,
    textTheme: text,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    visualDensity: VisualDensity.standard,
    extensions: [FieldPalette(c, theme)],
    focusColor: c.focusRing.withValues(alpha: 0.24),
    appBarTheme: AppBarTheme(
      backgroundColor: c.surface,
      foregroundColor: c.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleTextStyle: text.titleLarge,
      shape: Border(bottom: BorderSide(color: c.line)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.accent,
        foregroundColor: c.onAccent,
        disabledBackgroundColor: c.surfaceSunken,
        disabledForegroundColor: c.inkMuted,
        minimumSize: minSize,
        shape: buttonShape,
        textStyle: text.labelLarge,
        padding: const EdgeInsets.symmetric(horizontal: FieldSpace.s4),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: c.ink,
        backgroundColor: c.surface,
        side: BorderSide(color: c.lineStrong, width: 1.5),
        minimumSize: minSize,
        shape: buttonShape,
        textStyle: text.labelLarge,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: c.accent,
        minimumSize: minSize,
        shape: buttonShape,
        textStyle: text.labelLarge,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: FieldSpace.s3, vertical: FieldSpace.s3),
      constraints: const BoxConstraints(minHeight: FieldTap.min),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(FieldRadius.md),
        borderSide: BorderSide(color: c.lineStrong, width: 1.5),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(FieldRadius.md),
        borderSide: BorderSide(color: c.lineStrong, width: 1.5),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(FieldRadius.md),
        borderSide: BorderSide(color: c.focusRing, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(FieldRadius.md),
        borderSide: BorderSide(color: c.critical, width: 2),
      ),
      labelStyle: text.bodyLarge,
      helperStyle: text.bodyMedium?.copyWith(color: c.inkMuted),
      errorStyle: text.bodyMedium?.copyWith(color: c.critical, fontWeight: FontWeight.w700),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: c.surface,
      selectedColor: c.accent,
      checkmarkColor: c.onAccent,
      side: BorderSide(color: c.lineStrong, width: 1.5),
      shape: buttonShape,
      labelStyle: _sans(16, 20, FontWeight.w500, c.ink),
      secondaryLabelStyle: _sans(16, 20, FontWeight.w700, c.onAccent),
      padding: const EdgeInsets.symmetric(horizontal: FieldSpace.s3, vertical: FieldSpace.s3),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: c.surface,
      indicatorColor: c.accentSoft,
      height: 72,
      labelTextStyle: WidgetStatePropertyAll(_sans(13, 16, FontWeight.w700, c.ink)),
      iconTheme: WidgetStatePropertyAll(IconThemeData(color: c.ink, size: 24)),
    ),
    dividerTheme: DividerThemeData(color: c.line, thickness: 1, space: 1),
    cardTheme: CardThemeData(
      color: c.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(FieldRadius.md),
        side: BorderSide(color: c.line),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: c.ink,
      contentTextStyle: _sans(15, 22, FontWeight.w500, c.surface),
      behavior: SnackBarBehavior.floating,
    ),
  );
}

/// Picks the theme: the user's explicit choice, else the platform's high-contrast setting, else
/// light or dark from the system (dark maps to Night run).
FieldTheme resolveFieldTheme({
  FieldTheme? userChoice,
  required bool platformHighContrast,
  required Brightness platformBrightness,
}) {
  if (userChoice != null) return userChoice;
  if (platformHighContrast) return FieldTheme.contrast;
  return platformBrightness == Brightness.dark ? FieldTheme.night : FieldTheme.day;
}
