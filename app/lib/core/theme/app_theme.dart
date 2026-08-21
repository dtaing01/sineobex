import 'package:flutter/material.dart';

import 'tokens.dart';

class AppTheme {
  const AppTheme._();

  static ThemeData light() {
    const base = ColorScheme.light(
      primary: AppColors.blue600,
      onPrimary: AppColors.white,
      secondary: AppColors.slate100,
      onSecondary: AppColors.slate900,
      surface: AppColors.white,
      onSurface: AppColors.slate900,
      error: AppColors.red600,
      onError: AppColors.white,
      outline: AppColors.slate200,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: base,
      fontFamily: AppText.family,
      scaffoldBackgroundColor: AppColors.slate50,
      splashFactory: InkSparkle.splashFactory,
      textTheme: _textTheme,
      dividerTheme: const DividerThemeData(
        color: AppColors.slate100,
        thickness: 1,
        space: 1,
      ),
      // The prototype has no dark mode; every surface is explicit.
      brightness: Brightness.light,
    );
  }

  static const _textTheme = TextTheme(
    displayLarge: TextStyle(
      fontSize: AppText.xxxl,
      fontWeight: AppText.bold,
      color: AppColors.slate900,
      letterSpacing: AppText.tight,
    ),
    headlineLarge: TextStyle(
      fontSize: AppText.xxl,
      fontWeight: AppText.bold,
      color: AppColors.slate900,
      letterSpacing: AppText.tight,
    ),
    titleLarge: TextStyle(
      fontSize: AppText.lg,
      fontWeight: AppText.bold,
      color: AppColors.slate900,
    ),
    titleMedium: TextStyle(
      fontSize: AppText.base,
      fontWeight: AppText.bold,
      color: AppColors.slate900,
    ),
    bodyLarge: TextStyle(fontSize: AppText.sm, color: AppColors.slate700),
    bodyMedium: TextStyle(fontSize: AppText.xs, color: AppColors.slate600),
    bodySmall: TextStyle(fontSize: AppText.micro, color: AppColors.slate500),
  );

  /// `text-xs font-bold uppercase text-slate-400 tracking-widest` — the
  /// section header that appears 20+ times across the prototype.
  static const sectionHeader = TextStyle(
    fontSize: AppText.xs,
    fontWeight: AppText.bold,
    color: AppColors.slate400,
    letterSpacing: AppText.widest,
  );

  /// `text-[10px] font-bold uppercase text-slate-400` — field labels.
  static const fieldLabel = TextStyle(
    fontSize: AppText.micro,
    fontWeight: AppText.bold,
    color: AppColors.slate400,
    letterSpacing: 0.4,
  );
}
