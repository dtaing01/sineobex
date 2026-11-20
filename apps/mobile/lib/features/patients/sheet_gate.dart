import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_providers.dart' show syncControllerProvider;
import '../../encounters/encounter_services.dart' show EncounterServices;
import '../../patients/patient_providers.dart' show PatientServices;
import '../../sync/local_store.dart' show LocalStore;
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
      // Whichever hears of the freeze first: the controller, or a change through either services.
      listenable: Listenable.merge({sync, _services, ?PatientServices.of(store), ?EncounterServices.of(store)}),
      builder: (context, _) {
        // A lock, a sign-out or a team switch closed the database the sheet reads.
        if (!identical(sync.store, store)) return const SizedBox.shrink();
        if (store.frozenMessage case final frozen?) return SafeArea(child: FrozenNotice(frozen));
        return child;
      },
    );
  }
}
