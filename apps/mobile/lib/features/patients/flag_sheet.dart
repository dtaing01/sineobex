/// The **Change flags** sheet (phase 5 design 8.2): a patient's risk level (one, or None) and
/// conditions (several), the history of their changes (the flag, set or cleared, who, when, why), a
/// reason box, required, and Save; Entered in error on a change of the person's own, or on anyone's
/// for a Program Admin. It writes through the flags domain class (lib/patients/flags.dart), never the
/// store. Opened from the profile's flags row through `SheetGate.patients` (D125), its choosers
/// through `DialogGate`, its reason box a `PrivateBox` (D126). Works offline; shown only with
/// `patients.edit`.
///
/// Written ahead of its code (card P5-tests): the sheet draws nothing until card P5-phone-sheet
/// builds it. test/features/patients/flag_sheet_test.dart says what it must do; the words below are
/// the ones its tests read where the design gives none.
library;

import 'package:flutter/material.dart';

import '../../patients/patient_providers.dart';

/// The profile's flags row: its button, which opens the sheet, and where focus returns after Save.
const changeFlagsAction = 'Change flags';

/// The sheet's heading.
const changeFlagsTitle = 'Change flags';

/// The risk level's chooser: a button opening a dialog of None and each level the person may set.
const chooseRiskLevelAction = 'Choose a risk level';

/// The conditions' chooser: a button opening a dialog of a checkbox for each condition, and Done.
const chooseConditionsAction = 'Choose conditions';

/// A risk level of none, in the sheet and its chooser.
const noRiskLevelText = 'None';

/// The conditions chooser's button that keeps what is ticked.
const conditionsDoneAction = 'Done';

/// A history row's words for a set and for a clear.
const flagSetText = 'Set';
const flagClearedText = 'Cleared';

/// A history row's action on a change the person may mark, and the question's button.
const flagEnteredInErrorAction = 'Entered in error';
const markFlagChangeAction = 'Mark entered in error';

/// Opens the sheet for [patientId], gated by [services]' store: once it freezes, nothing of the
/// sheet is drawn, and what was typed goes with it.
Future<void> showFlagSheet(BuildContext context, PatientServices services, {required String patientId}) async {}

/// The sheet's body.
class FlagSheet extends StatelessWidget {
  const FlagSheet({super.key, required this.services, required this.patientId});

  final PatientServices services;
  final String patientId;

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
