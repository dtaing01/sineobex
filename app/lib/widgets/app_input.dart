import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/theme/tokens.dart';

/// The prototype's `<Input>`.
class AppInput extends StatelessWidget {
  const AppInput({
    super.key,
    this.controller,
    this.placeholder,
    this.keyboardType,
    this.onChanged,
    this.leadingIcon,
    this.height = 40,
    this.radius = AppRadius.xl,
    this.readOnly = false,
    this.onTap,
    this.inputFormatters,
    this.textCapitalization = TextCapitalization.none,
  });

  final TextEditingController? controller;
  final String? placeholder;
  final TextInputType? keyboardType;
  final ValueChanged<String>? onChanged;
  final IconData? leadingIcon;
  final double height;
  final double radius;
  final bool readOnly;
  final VoidCallback? onTap;
  final List<TextInputFormatter>? inputFormatters;
  final TextCapitalization textCapitalization;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: TextField(
        controller: controller,
        keyboardType: keyboardType,
        onChanged: onChanged,
        readOnly: readOnly,
        onTap: onTap,
        inputFormatters: inputFormatters,
        textCapitalization: textCapitalization,
        style: const TextStyle(
          fontSize: AppText.sm,
          color: AppColors.slate900,
        ),
        decoration: InputDecoration(
          hintText: placeholder,
          hintStyle: const TextStyle(
            fontSize: AppText.sm,
            color: AppColors.slate400,
          ),
          prefixIcon: leadingIcon == null
              ? null
              : Icon(leadingIcon, size: 18, color: AppColors.slate400),
          filled: true,
          fillColor: AppColors.white,
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: AppSpace.x3,
            vertical: AppSpace.x2,
          ),
          border: _border(AppColors.slate200, radius),
          enabledBorder: _border(AppColors.slate200, radius),
          focusedBorder: _border(AppColors.blue500, radius),
        ),
      ),
    );
  }

  static OutlineInputBorder _border(Color color, double radius) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(radius),
        borderSide: BorderSide(color: color),
      );
}

/// The prototype's `<Textarea>` — a taller multiline input.
class AppTextArea extends StatelessWidget {
  const AppTextArea({
    super.key,
    this.controller,
    this.placeholder,
    this.minHeight = 120,
    this.onChanged,
  });

  final TextEditingController? controller;
  final String? placeholder;
  final double minHeight;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: BoxConstraints(minHeight: minHeight),
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        maxLines: null,
        minLines: 5,
        textCapitalization: TextCapitalization.sentences,
        style: const TextStyle(fontSize: AppText.sm, color: AppColors.slate900),
        decoration: InputDecoration(
          hintText: placeholder,
          hintStyle: const TextStyle(
            fontSize: AppText.sm,
            color: AppColors.slate400,
          ),
          filled: true,
          fillColor: AppColors.white,
          contentPadding: const EdgeInsets.all(AppSpace.x3),
          border: AppInput._border(AppColors.slate200, AppRadius.md),
          enabledBorder: AppInput._border(AppColors.slate200, AppRadius.md),
          focusedBorder: AppInput._border(AppColors.blue500, AppRadius.md),
        ),
      ),
    );
  }
}

/// A labelled form field: `<label>` above an input, as used throughout the
/// enrollment form.
class LabelledField extends StatelessWidget {
  const LabelledField({super.key, required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          style: const TextStyle(
            fontSize: AppText.micro,
            fontWeight: AppText.bold,
            color: AppColors.slate400,
            letterSpacing: 0.4,
          ),
        ),
        const SizedBox(height: AppSpace.x1_5),
        child,
      ],
    );
  }
}
