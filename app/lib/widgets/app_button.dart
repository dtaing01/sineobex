import 'package:flutter/material.dart';

import '../core/theme/tokens.dart';

enum AppButtonVariant { primary, outline, ghost, secondary, white }

enum AppButtonSize { sm, md, lg, xl }

/// The prototype's `<Button>` with its `default` / `outline` / `ghost` /
/// `secondary` variants and `sm` / `icon` sizes.
class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    this.onPressed,
    this.variant = AppButtonVariant.primary,
    this.size = AppButtonSize.md,
    this.icon,
    this.expanded = false,
    this.uppercase = false,
    this.foreground,
    this.background,
    this.borderColor,
    this.radius,
    this.fontSize,
    this.shadows,
  });

  final String label;
  final VoidCallback? onPressed;
  final AppButtonVariant variant;
  final AppButtonSize size;
  final IconData? icon;
  final bool expanded;
  final bool uppercase;
  final Color? foreground;
  final Color? background;
  final Color? borderColor;
  final double? radius;
  final double? fontSize;
  final List<BoxShadow>? shadows;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, border) = _colors;
    final height = switch (size) {
      AppButtonSize.sm => 28.0,
      AppButtonSize.md => 36.0,
      AppButtonSize.lg => 48.0,
      AppButtonSize.xl => 56.0,
    };
    final textSize = fontSize ??
        switch (size) {
          AppButtonSize.sm => AppText.micro,
          AppButtonSize.md => AppText.xs,
          AppButtonSize.lg => AppText.sm,
          AppButtonSize.xl => AppText.lg,
        };
    final iconSize = switch (size) {
      AppButtonSize.sm => 14.0,
      AppButtonSize.md => 16.0,
      AppButtonSize.lg => 18.0,
      AppButtonSize.xl => 20.0,
    };
    final r = radius ?? AppRadius.md;

    final content = Row(
      mainAxisSize: expanded ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (icon != null) ...[
          Icon(icon, size: iconSize, color: fg),
          const SizedBox(width: AppSpace.x2),
        ],
        Flexible(
          child: Text(
            uppercase ? label.toUpperCase() : label,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: textSize,
              fontWeight: AppText.bold,
              color: fg,
              letterSpacing: uppercase ? 0.6 : 0,
            ),
          ),
        ),
      ],
    );

    final button = DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(r),
        boxShadow: onPressed == null ? null : shadows,
      ),
      child: Material(
        color: bg,
        borderRadius: BorderRadius.circular(r),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(r),
          child: Container(
            height: height,
            padding: EdgeInsets.symmetric(
              horizontal: size == AppButtonSize.sm ? AppSpace.x2 : AppSpace.x4,
            ),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(r),
              border: border == null ? null : Border.all(color: border),
            ),
            alignment: Alignment.center,
            child: content,
          ),
        ),
      ),
    );

    return Opacity(
      opacity: onPressed == null ? 0.5 : 1,
      child: expanded ? SizedBox(width: double.infinity, child: button) : button,
    );
  }

  (Color, Color, Color?) get _colors {
    if (background != null || foreground != null) {
      return (
        background ?? AppColors.transparent,
        foreground ?? AppColors.slate900,
        borderColor,
      );
    }
    return switch (variant) {
      AppButtonVariant.primary => (
          AppColors.blue600,
          AppColors.white,
          borderColor,
        ),
      AppButtonVariant.outline => (
          AppColors.white,
          AppColors.slate700,
          borderColor ?? AppColors.slate200,
        ),
      AppButtonVariant.ghost => (
          AppColors.transparent,
          AppColors.slate600,
          null,
        ),
      AppButtonVariant.secondary => (
          AppColors.slate100,
          AppColors.slate900,
          borderColor,
        ),
      AppButtonVariant.white => (
          AppColors.white,
          AppColors.slate900,
          borderColor ?? AppColors.slate200,
        ),
    };
  }
}

/// `size="icon"` — a circular icon-only button.
class AppIconButton extends StatelessWidget {
  const AppIconButton({
    super.key,
    required this.icon,
    this.onPressed,
    this.size = 40,
    this.iconSize = 20,
    this.background = AppColors.blue600,
    this.foreground = AppColors.white,
    this.shadows,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final double size;
  final double iconSize;
  final Color background;
  final Color foreground;
  final List<BoxShadow>? shadows;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(shape: BoxShape.circle, boxShadow: shadows),
      child: Material(
        color: background,
        shape: const CircleBorder(),
        child: InkWell(
          onTap: onPressed,
          customBorder: const CircleBorder(),
          child: SizedBox(
            width: size,
            height: size,
            child: Icon(icon, size: iconSize, color: foreground),
          ),
        ),
      ),
    );
  }
}

/// The horizontally-scrolling pill row used for patient filters, inventory
/// filters, and the risk selector.
class FilterChipRow<T> extends StatelessWidget {
  const FilterChipRow({
    super.key,
    required this.values,
    required this.selected,
    required this.labelOf,
    required this.onSelected,
    this.selectedBackground = AppColors.blue600,
    this.selectedForeground = AppColors.white,
    this.height = 32,
    this.expandEvenly = false,
  });

  final List<T> values;
  final T selected;
  final String Function(T) labelOf;
  final ValueChanged<T> onSelected;
  final Color selectedBackground;
  final Color selectedForeground;
  final double height;

  /// The risk selector splits the row into equal thirds instead of scrolling.
  final bool expandEvenly;

  @override
  Widget build(BuildContext context) {
    final chips = values.map(_chip).toList();

    if (expandEvenly) {
      return Row(
        children: [
          for (var i = 0; i < chips.length; i++) ...[
            if (i > 0) const SizedBox(width: AppSpace.x2),
            Expanded(child: chips[i]),
          ],
        ],
      );
    }

    return SizedBox(
      height: height,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: chips.length,
        separatorBuilder: (_, __) => const SizedBox(width: AppSpace.x2),
        itemBuilder: (_, i) => chips[i],
      ),
    );
  }

  Widget _chip(T value) {
    final isSelected = value == selected;
    return SizedBox(
      height: height,
      child: Material(
        color: isSelected ? selectedBackground : AppColors.white,
        borderRadius: BorderRadius.circular(AppRadius.full),
        child: InkWell(
          onTap: () => onSelected(value),
          borderRadius: BorderRadius.circular(AppRadius.full),
          child: Container(
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.x3),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.full),
              border: Border.all(
                color: isSelected ? selectedBackground : AppColors.slate200,
              ),
            ),
            child: Text(
              labelOf(value).toUpperCase(),
              style: TextStyle(
                fontSize: AppText.micro,
                fontWeight: AppText.bold,
                color: isSelected ? selectedForeground : AppColors.slate700,
                letterSpacing: 0.4,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
