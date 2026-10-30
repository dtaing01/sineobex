import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme.dart';
import '../tokens.dart';

/// A centred, scrollable column for the screens before someone is in: readable at 200% text.
class AuthScaffold extends StatelessWidget {
  const AuthScaffold({super.key, required this.title, this.lede, required this.children});

  final String title;
  final String? lede;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Sineobex')),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: ListView(
              padding: const EdgeInsets.all(FieldSpace.s4),
              children: [
                Semantics(header: true, child: Text(title, style: text.headlineSmall)),
                if (lede != null) ...[
                  const SizedBox(height: FieldSpace.s2),
                  Text(lede!, style: text.bodyLarge?.copyWith(color: context.field.inkMuted)),
                ],
                const SizedBox(height: FieldSpace.s5),
                ...children,
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// An error that screen readers announce as soon as it appears.
class ErrorMessage extends StatelessWidget {
  const ErrorMessage(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        padding: const EdgeInsets.all(FieldSpace.s3),
        decoration: BoxDecoration(
          color: c.criticalSoft,
          border: Border.all(color: c.critical, width: 2),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(LucideIcons.circleAlert, color: c.critical, size: 22),
            const SizedBox(width: FieldSpace.s2),
            Expanded(
              child: Text(message, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      ),
    );
  }
}

class NoticeMessage extends StatelessWidget {
  const NoticeMessage(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        padding: const EdgeInsets.all(FieldSpace.s3),
        decoration: BoxDecoration(
          color: c.infoSoft,
          border: Border.all(color: c.info, width: 1.5),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: Text(message, style: Theme.of(context).textTheme.bodyLarge),
      ),
    );
  }
}

/// Full-width primary action that shows progress and can't be double-submitted.
class BusyButton extends StatelessWidget {
  const BusyButton({super.key, required this.label, required this.busy, required this.onPressed});
  final String label;
  final bool busy;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: FieldTap.large,
      child: FilledButton(
        onPressed: busy ? null : onPressed,
        child: busy
            ? Semantics(
                label: 'Working',
                child: const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5)),
              )
            : Text(label),
      ),
    );
  }
}

const gap = SizedBox(height: FieldSpace.s4);
