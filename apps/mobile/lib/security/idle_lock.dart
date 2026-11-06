import 'dart:async';

import 'package:flutter/material.dart';

import '../auth/session_controller.dart';
import '../design/theme.dart';

/// Locks the app after [idle] without a touch, and when it has been in the background longer
/// than [backgroundGrace] (module 9: "PIN or biometric unlock, auto-lock when idle").
///
/// While the app is not in the foreground it is covered, so the app switcher's snapshot never
/// shows a chart (module 9: "Screen hidden in the app switcher"). Android's FLAG_SECURE does the
/// same on that platform; this covers iOS.
class IdleLock extends StatefulWidget {
  const IdleLock({
    super.key,
    required this.session,
    required this.idle,
    this.backgroundGrace = const Duration(seconds: 30),
    required this.child,
  });

  final SessionController session;
  final Duration idle;
  final Duration backgroundGrace;
  final Widget child;

  @override
  State<IdleLock> createState() => _IdleLockState();
}

class _IdleLockState extends State<IdleLock> {
  Timer? _timer;
  late final AppLifecycleListener _lifecycle;
  DateTime? _hiddenAt;
  bool _covered = false;

  @override
  void initState() {
    super.initState();
    widget.session.addListener(_restart);
    _lifecycle = AppLifecycleListener(
      onInactive: () => setState(() => _covered = true),
      onHide: () => _hiddenAt ??= DateTime.now(),
      onShow: _returned,
      onResume: () {
        _returned();
        setState(() => _covered = false);
      },
    );
    _restart();
  }

  void _returned() {
    final hiddenAt = _hiddenAt;
    _hiddenAt = null;
    if (hiddenAt != null && DateTime.now().difference(hiddenAt) >= widget.backgroundGrace) {
      unawaited(widget.session.lock());
    } else {
      _restart();
    }
  }

  void _restart() {
    _timer?.cancel();
    if (widget.session.state is Unlocked) {
      _timer = Timer(widget.idle, () => unawaited(widget.session.lock()));
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _lifecycle.dispose();
    widget.session.removeListener(_restart);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _restart(),
      child: Focus(
        canRequestFocus: false,
        onKeyEvent: (_, _) {
          _restart();
          return KeyEventResult.ignored;
        },
        child: Stack(
          children: [
            widget.child,
            if (_covered)
              Positioned.fill(
                child: ColoredBox(
                  color: context.field.ground,
                  child: const Center(child: Icon(Icons.lock_outline, size: 48)),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
