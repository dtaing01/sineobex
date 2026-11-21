import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme.dart';
import '../tokens.dart';

/// "Demo data only" strip shown above every screen of a local or preview build (Build plan:
/// "Every screen in the preview shows Demo data only"). It cannot be dismissed.
class DemoBanner extends StatelessWidget {
  const DemoBanner({super.key});

  static const message = 'Demo data only. Never enter a real patient.';

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    return Semantics(
      container: true,
      label: message,
      excludeSemantics: true,
      child: Material(
        color: c.warningSoft,
        child: SafeArea(
          bottom: false,
          child: Container(
            constraints: const BoxConstraints(minHeight: 40),
            padding: const EdgeInsets.symmetric(horizontal: FieldSpace.s4, vertical: FieldSpace.s2),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: c.warning, width: 1.5)),
            ),
            child: Row(
              children: [
                Icon(LucideIcons.flaskConical, size: 18, color: c.warning),
                const SizedBox(width: FieldSpace.s2),
                Expanded(
                  child: Text(
                    message,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700, color: c.ink),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Wraps every route so the banner can't be forgotten on a new screen.
class DemoFrame extends StatelessWidget {
  const DemoFrame({super.key, required this.enabled, required this.child});

  final bool enabled;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!enabled) return child;
    return Column(
      children: [
        const DemoBanner(),
        Expanded(
          // Routes block the semantics of whatever is painted before them in the same container.
          // Without this boundary the banner is visible but screen readers never announce it.
          child: Semantics(
            container: true,
            child: MediaQuery.removePadding(context: context, removeTop: true, child: child),
          ),
        ),
      ],
    );
  }
}
