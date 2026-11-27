import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/widgets/status_chip.dart';
import '../../forms/definition.dart';

/// Guidance in a note form (forms 2.2 `info`): its label is the text, its help the detail. It
/// stores nothing and has nothing to tap, so it is the same on a finished note.
class InfoField extends StatelessWidget {
  const InfoField({super.key, required this.field});
  final InfoDef field;

  @override
  Widget build(BuildContext context) =>
      StatusBanner(icon: LucideIcons.info, tone: ChipTone.info, text: field.label, detail: field.help);
}
