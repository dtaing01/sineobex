import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_providers.dart' show syncControllerProvider;
import '../../encounters/encounter_services.dart' show EncounterServices;
import '../../patients/patient_providers.dart' show PatientServices;
import '../../sync/local_store.dart' show LocalStore;
import '../../sync/sync_controller.dart' show SyncController;
import 'patient_widgets.dart' show FrozenNotice;

/// A modal sheet over a team's screens (Correct, Add addendum, Attach to another patient): [child]
/// while the services it reads through read the database the controller holds open and the store is
/// not frozen; nothing once it closed, and why once it froze. A modal sheet is not under the
/// screen's gate, so it hears the controller and the team's services itself, as the screens under
/// it do: what it read before access ended goes, an answer being changed with it (phase 3's V1,
/// review SFL-3). What a sheet does itself (a search it runs) doesn't pass through here: a read the
/// store refuses drops what the sheet read before.
class SheetGate extends ConsumerWidget {
  /// Over a visit's screens, reading through [services].
  SheetGate({super.key, required EncounterServices services, required this.child})
    : store = services.store,
      _services = services;

  /// Over a patient's, reading through [services] (the picker).
  SheetGate.patients({super.key, required PatientServices services, required this.child})
    : store = services.store,
      _services = services;

  /// The team's store the sheet reads.
  final LocalStore store;
  final Listenable _services;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sync = ref.watch(syncControllerProvider);
    return ListenableBuilder(
      listenable: _hears(sync, store, _services),
      builder: (context, _) {
        // A lock, a sign-out or a team switch closed the database the sheet reads.
        if (!identical(sync.store, store)) return const SizedBox.shrink();
        if (store.frozenMessage case final frozen?) return SafeArea(child: FrozenNotice(frozen));
        return child;
      },
    );
  }
}

/// Whichever hears of a freeze first: the controller, or a change through either of the team's
/// services.
Listenable _hears(SyncController sync, LocalStore store, Listenable services) =>
    Listenable.merge({sync, services, ?PatientServices.of(store), ?EncounterServices.of(store)});

/// A dialog over a team's screens that names something of a chart or a note (Remove “a street
/// name”?, a card's date, an entry's title): [child] while the services it was opened over read the
/// database the controller holds open and the store is not frozen. A dialog is not under the
/// screen's gate either, and a reason in place of its question would leave a box that asks nothing,
/// so once either ends it hears what [SheetGate] hears and closes as its Cancel would: its caller
/// gets [cancel], so nothing it asks is done, and the screen under it, which hears the same, says why
/// (phase 3's V1).
class DialogGate<T> extends ConsumerStatefulWidget {
  /// Over a visit's screens, reading through [services].
  DialogGate({super.key, required EncounterServices services, this.cancel, required this.child})
    : store = services.store,
      _services = services;

  /// Over a patient's, reading through [services].
  DialogGate.patients({super.key, required PatientServices services, this.cancel, required this.child})
    : store = services.store,
      _services = services;

  /// The team's store the screen under the dialog reads.
  final LocalStore store;
  final Listenable _services;

  /// What the dialog's Cancel gives its caller.
  final T? cancel;
  final Widget child;

  @override
  ConsumerState<DialogGate<T>> createState() => _DialogGateState<T>();
}

class _DialogGateState<T> extends ConsumerState<DialogGate<T>> {
  bool _closing = false;

  @override
  Widget build(BuildContext context) {
    final sync = ref.watch(syncControllerProvider);
    final store = widget.store;
    return ListenableBuilder(
      listenable: _hears(sync, store, widget._services),
      builder: (context, _) {
        if (identical(sync.store, store) && !store.frozen) return widget.child;
        _close();
        // Not one more frame of what it names.
        return const SizedBox.shrink();
      },
    );
  }

  /// Once this frame is drawn: a route doesn't go while the frame that builds it is being built.
  void _close() {
    if (_closing) return;
    _closing = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final route = ModalRoute.of(context);
      // Already going: its own buttons closed it, or the screen it was asked over went.
      if (route == null || !route.isActive) return;
      final navigator = Navigator.of(context);
      if (route.isCurrent) {
        navigator.pop<T>(widget.cancel);
      } else {
        navigator.removeRoute(route, widget.cancel);
      }
    });
  }
}
