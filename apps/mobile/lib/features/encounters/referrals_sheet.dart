import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../encounters/encounter_services.dart';
import '../forms/text_field.dart' show limitCodePoints;
import '../patients/patient_labels.dart' show count, longDate;
import '../patients/patient_widgets.dart' show PhiField, WideButton, showDone, todayOf;
import 'encounter_labels.dart';

/// Most characters a referral's details hold (lifecycle 7, 9.10).
const referralDetailsMax = 2000;

const referralDetailsLabel = 'Details';
const referralDateLabel = 'Date';
const changeDateAction = 'Change date';
const referralAdded = 'Referral added';
const addReferralButton = 'Add referral';

/// **Add referral** (lifecycle 9.10), from a note's `add_referral` action (forms 6.8) or the summary
/// (9.6): a date, today by default, and a details box of up to 2,000 characters, made at the visit
/// [encounterId] when given. `Referrals.add` holds every rule and words every refusal; the sheet shows
/// them. Returns the referral's ID, or null when the sheet was closed without one.
///
/// The sheet's list of past referrals and Entered in error are card L5-referrals'.
Future<String?> showAddReferral(
  BuildContext context,
  EncounterServices services, {
  required String patientId,
  String? encounterId,
}) => showModalBottomSheet<String>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (context) => _AddReferral(services: services, patientId: patientId, encounterId: encounterId),
);

class _AddReferral extends ConsumerStatefulWidget {
  const _AddReferral({required this.services, required this.patientId, required this.encounterId});
  final EncounterServices services;
  final String patientId;
  final String? encounterId;

  @override
  ConsumerState<_AddReferral> createState() => _AddReferralState();
}

class _AddReferralState extends ConsumerState<_AddReferral> {
  final _details = TextEditingController();
  late DateTime _on = todayOf(ref);
  String? _problem;

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final today = todayOf(ref);
    final picked = await showDatePicker(
      context: context,
      initialDate: _on,
      // As far back as a note's dates reach (forms 10.1 #43); never ahead, which the server refuses.
      firstDate: DateTime(today.year - 100, today.month, today.day),
      lastDate: today,
    );
    if (picked != null && mounted) setState(() => _on = picked);
  }

  /// Cut at the limit as the form's text boxes cut theirs: in code points, as the server counts.
  void _typed(String typed) {
    final limited = limitCodePoints(typed, referralDetailsMax);
    if (limited != typed) {
      _details.value = TextEditingValue(
        text: limited,
        selection: TextSelection.collapsed(offset: limited.length),
      );
    }
    setState(() {});
  }

  void _add() {
    try {
      final id = widget.services.referrals.add(
        widget.patientId,
        referredOn: _on,
        details: _details.text,
        encounterId: widget.encounterId,
      );
      showDone(context, referralAdded);
      Navigator.of(context).pop(id);
    } on Exception catch (e) {
      setState(() => _problem = encounterErrorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
          children: [
            Semantics(header: true, child: Text(addReferralAction, style: text.titleLarge)),
            const SizedBox(height: FieldSpace.s3),
            Text('$referralDateLabel: ${longDate(_on)}', style: text.bodyLarge),
            const SizedBox(height: FieldSpace.s1),
            WideButton(label: changeDateAction, icon: LucideIcons.calendar, onPressed: () => unawaited(_pickDate())),
            const SizedBox(height: FieldSpace.s3),
            PhiField(
              name: 'referralDetails',
              label: referralDetailsLabel,
              controller: _details,
              maxLines: 8,
              minLines: 3,
              showCounter: false,
              capitalization: TextCapitalization.sentences,
              textInputAction: TextInputAction.newline,
              onChanged: _typed,
            ),
            const SizedBox(height: FieldSpace.s1),
            Text(
              '${count(_details.text.runes.length)} of ${count(referralDetailsMax)} characters',
              style: text.bodyMedium,
            ),
            if (_problem != null) ...[const SizedBox(height: FieldSpace.s2), ErrorMessage(_problem!)],
            const SizedBox(height: FieldSpace.s3),
            WideButton(label: addReferralButton, filled: true, onPressed: _add),
          ],
        ),
      ),
    );
  }
}
