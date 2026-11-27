import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../forms/definition.dart';

/// Where photos will be taken (forms 6.8: they arrive in phase 8). Until then it says so, stores
/// nothing and has nothing to tap. The field host shows its label above it.
class PhotoField extends StatelessWidget {
  const PhotoField({super.key, required this.field});
  final PhotoDef field;

  static const message = 'Photos arrive in a later release.';

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    return Semantics(
      container: true,
      label: '${field.label}. $message',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.all(FieldSpace.s3),
        decoration: BoxDecoration(
          color: c.surfaceSunken,
          border: Border.all(color: c.line),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(LucideIcons.cameraOff, size: 22, color: c.inkMuted),
            const SizedBox(width: FieldSpace.s2),
            Expanded(child: Text(message, style: Theme.of(context).textTheme.bodyLarge)),
          ],
        ),
      ),
    );
  }
}
