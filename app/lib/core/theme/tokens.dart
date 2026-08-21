import 'package:flutter/widgets.dart';

/// Design tokens ported from the React prototype.
///
/// The prototype's `index.css` declares shadcn OKLCH variables, but `App.tsx`
/// never uses them — every colour is a raw Tailwind utility class. These are
/// the Tailwind v4 palette values the prototype actually renders.
class AppColors {
  const AppColors._();

  // slate
  static const slate50 = Color(0xFFF8FAFC);
  static const slate100 = Color(0xFFF1F5F9);
  static const slate200 = Color(0xFFE2E8F0);
  static const slate300 = Color(0xFFCBD5E1);
  static const slate400 = Color(0xFF94A3B8);
  static const slate500 = Color(0xFF64748B);
  static const slate600 = Color(0xFF475569);
  static const slate700 = Color(0xFF334155);
  static const slate800 = Color(0xFF1E293B);
  static const slate900 = Color(0xFF0F172A);

  // blue
  static const blue50 = Color(0xFFEFF6FF);
  static const blue100 = Color(0xFFDBEAFE);
  static const blue200 = Color(0xFFBFDBFE);
  static const blue300 = Color(0xFF93C5FD);
  static const blue400 = Color(0xFF60A5FA);
  static const blue500 = Color(0xFF3B82F6);
  static const blue600 = Color(0xFF2563EB);
  static const blue700 = Color(0xFF1D4ED8);
  static const blue900 = Color(0xFF1E3A8A);

  // orange
  static const orange50 = Color(0xFFFFF7ED);
  static const orange100 = Color(0xFFFFEDD5);
  static const orange200 = Color(0xFFFED7AA);
  static const orange500 = Color(0xFFF97316);
  static const orange600 = Color(0xFFEA580C);
  static const orange700 = Color(0xFFC2410C);
  static const orange900 = Color(0xFF7C2D12);

  // red
  static const red50 = Color(0xFFFEF2F2);
  static const red100 = Color(0xFFFEE2E2);
  static const red200 = Color(0xFFFECACA);
  static const red500 = Color(0xFFEF4444);
  static const red600 = Color(0xFFDC2626);
  static const red700 = Color(0xFFB91C1C);

  // amber / yellow
  static const amber500 = Color(0xFFF59E0B);
  static const amber50 = Color(0xFFFFFBEB);
  static const amber100 = Color(0xFFFEF3C7);
  static const amber200 = Color(0xFFFDE68A);
  static const amber400 = Color(0xFFFBBF24);
  static const amber600 = Color(0xFFD97706);
  static const yellow100 = Color(0xFFFEF9C3);
  static const yellow500 = Color(0xFFEAB308);
  static const yellow700 = Color(0xFFA16207);

  // green / emerald
  static const green50 = Color(0xFFF0FDF4);
  static const green100 = Color(0xFFDCFCE7);
  static const green200 = Color(0xFFBBF7D0);
  static const green500 = Color(0xFF22C55E);
  static const green600 = Color(0xFF16A34A);
  static const green700 = Color(0xFF15803D);
  static const green900 = Color(0xFF14532D);
  static const emerald50 = Color(0xFFECFDF5);
  static const emerald100 = Color(0xFFD1FAE5);
  static const emerald400 = Color(0xFF34D399);
  static const emerald500 = Color(0xFF10B981);
  static const emerald600 = Color(0xFF059669);

  // purple / violet
  static const purple50 = Color(0xFFFAF5FF);
  static const purple100 = Color(0xFFF3E8FF);
  static const purple200 = Color(0xFFE9D5FF);
  static const purple500 = Color(0xFFA855F7);
  static const purple600 = Color(0xFF9333EA);
  static const purple700 = Color(0xFF7E22CE);
  static const purple900 = Color(0xFF581C87);
  static const violet500 = Color(0xFF8B5CF6);

  // rose
  static const rose50 = Color(0xFFFFF1F2);
  static const rose400 = Color(0xFFFB7185);
  static const rose500 = Color(0xFFF43F5E);
  static const rose600 = Color(0xFFE11D48);

  static const white = Color(0xFFFFFFFF);
  static const transparent = Color(0x00000000);
}

/// Font sizes. The prototype leans on arbitrary Tailwind values
/// (`text-[8px]` … `text-[11px]`) alongside the standard ramp.
class AppText {
  const AppText._();

  static const xxxs = 7.0; // text-[7px]
  static const xxs = 8.0; // text-[8px]
  static const tiny = 9.0; // text-[9px]
  static const micro = 10.0; // text-[10px] / text-xs in prototype usage
  static const mini = 11.0; // text-[11px]
  static const xs = 12.0; // text-xs
  static const sm = 14.0; // text-sm
  static const base = 16.0; // text-base
  static const lg = 18.0; // text-lg
  static const xl = 20.0; // text-xl
  static const xxl = 24.0; // text-2xl
  static const xxxl = 30.0; // text-3xl

  static const regular = FontWeight.w400;
  static const medium = FontWeight.w500;
  static const semibold = FontWeight.w600;
  static const bold = FontWeight.w700;

  /// `tracking-widest`
  static const widest = 1.6;

  /// `tracking-wider`
  static const wider = 0.8;

  /// `tracking-tight`
  static const tight = -0.4;

  /// `tracking-tighter`
  static const tighter = -0.8;

  static const family = 'Inter';
}

/// Border radii. `--radius: 0.625rem` = 10px is the shadcn base; the prototype
/// also uses explicit `rounded-xl`/`rounded-2xl`/`rounded-[2rem]`.
class AppRadius {
  const AppRadius._();

  static const sm = 6.0;
  static const md = 8.0;
  static const lg = 10.0;
  static const xl = 12.0;
  static const xxl = 16.0;
  static const xxxl = 24.0;
  static const map = 32.0; // rounded-[2rem]
  static const full = 999.0;
}

/// Tailwind's spacing scale is 4px per unit.
class AppSpace {
  const AppSpace._();

  static const x0_5 = 2.0;
  static const x1 = 4.0;
  static const x1_5 = 6.0;
  static const x2 = 8.0;
  static const x3 = 12.0;
  static const x4 = 16.0;
  static const x5 = 20.0;
  static const x6 = 24.0;
  static const x8 = 32.0;

  /// `max-w-md` — the phone-width column the prototype centres everything in.
  static const maxContentWidth = 448.0;
}

class AppShadows {
  const AppShadows._();

  static const sm = [
    BoxShadow(color: Color(0x0D000000), blurRadius: 2, offset: Offset(0, 1)),
  ];
  static const md = [
    BoxShadow(color: Color(0x14000000), blurRadius: 6, offset: Offset(0, 4)),
    BoxShadow(color: Color(0x0D000000), blurRadius: 4, offset: Offset(0, 2)),
  ];
  static const lg = [
    BoxShadow(color: Color(0x1A000000), blurRadius: 15, offset: Offset(0, 10)),
    BoxShadow(color: Color(0x0D000000), blurRadius: 6, offset: Offset(0, 4)),
  ];
  static const xxl = [
    BoxShadow(color: Color(0x40000000), blurRadius: 50, offset: Offset(0, 25)),
  ];

  /// `shadow-lg shadow-blue-100` — the blue-tinted glow on primary CTAs.
  static const blueGlow = [
    BoxShadow(color: Color(0x66DBEAFE), blurRadius: 15, offset: Offset(0, 10)),
  ];
}
