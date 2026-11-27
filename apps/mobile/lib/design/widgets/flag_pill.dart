import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../presets/models.dart' show FlagBody, FlagColor;
import '../theme.dart';
import '../tokens.dart';
import 'status_chip.dart' show ChipTone, toneColors;

/// A flag as every screen of the phone draws it (phase 5 design 8, 8.2): its colour's plain name,
/// then the flag's own, "Red · High", with a flag icon, so which flag it is never rests on colour
/// (the design system's "Priority flags are pills that carry the colour name and the level's
/// word"). A screen reader hears "Red, High". Not a button; it wraps at large text instead of
/// clipping.
class FlagPill extends StatelessWidget {
  const FlagPill({super.key, required this.name, required this.colorName, this.color});

  /// The pill of a flag the phone holds.
  FlagPill.of(FlagBody flag, {Key? key})
    : this(key: key, name: flag.name, colorName: flag.color.colorName, color: flag.color);

  /// The flag's name, as the team wrote it.
  final String name;

  /// The colour's plain name, shown first: "Red".
  final String colorName;

  /// Null for a colour this version of the app does not know, named by the server: drawn as grey,
  /// with the name it was given.
  final FlagColor? color;

  /// What the pill shows: "Red · High".
  String get text => '$colorName · $name';

  /// What a screen reader says: "Red, High".
  String get spoken => '$colorName, $name';

  @override
  Widget build(BuildContext context) {
    final t = flagPillColors(Theme.of(context).extension<FieldPalette>()!, color);
    final style = Theme.of(context).textTheme.bodyMedium?.copyWith(color: t.fg, fontWeight: FontWeight.w700);
    return Semantics(
      label: spoken,
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: FieldSpace.s2, vertical: FieldSpace.s1),
        decoration: BoxDecoration(
          color: t.bg,
          border: Border.all(color: t.border, width: 1.5),
          borderRadius: BorderRadius.circular(FieldRadius.sm),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(LucideIcons.flag, size: 16, color: t.fg),
            ),
            const SizedBox(width: FieldSpace.s1),
            Flexible(child: Text(text, style: style)),
          ],
        ),
      ),
    );
  }
}

/// The words, fill and edge of a pill of [color] in [palette]'s theme. Red, yellow and green are
/// the design system's critical, warning and good pairs, the colours its tokens give the priority
/// flags, and blue its info pair; grey, and a colour the phone does not know, the neutral chip's.
/// Orange, teal and purple are this pill's own until the design system names them (the palette of
/// row TM-36 of docs/decisions-for-review.md). Every pair has its words at 4.5:1 or better on its
/// fill (7:1 in High contrast) and its edge at 3:1 or better on the ground and the surface:
/// test/features/presets/team_setup_screen_test.dart holds each one.
({Color fg, Color bg, Color border}) flagPillColors(FieldPalette palette, FlagColor? color) {
  final c = palette.colors;
  ({Color fg, Color bg, Color border}) own(
    ({Color fg, Color bg}) day,
    ({Color fg, Color bg}) night,
    ({Color fg, Color bg}) contrast,
  ) {
    final pair = switch (palette.theme) {
      FieldTheme.day => day,
      FieldTheme.night => night,
      FieldTheme.contrast => contrast,
    };
    return (fg: pair.fg, bg: pair.bg, border: pair.fg);
  }

  return switch (color) {
    FlagColor.red => toneColors(c, ChipTone.critical),
    FlagColor.yellow => toneColors(c, ChipTone.warning),
    FlagColor.green => toneColors(c, ChipTone.good),
    FlagColor.blue => toneColors(c, ChipTone.info),
    FlagColor.grey || null => toneColors(c, ChipTone.neutral),
    FlagColor.orange => own(
      (fg: const Color(0xFFA8430A), bg: const Color(0xFFFCE8DA)),
      (fg: const Color(0xFFFFA466), bg: const Color(0xFF3A2110)),
      (fg: const Color(0xFF7A2E00), bg: const Color(0xFFFCE4D2)),
    ),
    FlagColor.teal => own(
      (fg: const Color(0xFF0B6A70), bg: const Color(0xFFD5EFEF)),
      (fg: const Color(0xFF5CCFCB), bg: const Color(0xFF0D2D2D)),
      (fg: const Color(0xFF074A4F), bg: const Color(0xFFD2ECEC)),
    ),
    FlagColor.purple => own(
      (fg: const Color(0xFF6C3FA6), bg: const Color(0xFFEEE6F8)),
      (fg: const Color(0xFFC7A9F7), bg: const Color(0xFF2A1C44)),
      (fg: const Color(0xFF4B2380), bg: const Color(0xFFECE2F8)),
    ),
  };
}
