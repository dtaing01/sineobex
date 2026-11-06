import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/generated/api.dart' show FieldReviewView, ReviewNeeds;
import '../../api/transport.dart' show ApiException, NetworkException;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import 'patient_labels.dart';

/// "Which is right?" (design 3.2, 12.1): two values were recorded for one field and someone who
/// knows the person chooses. Each value is a radio card with who recorded it and when. **Save
/// choice** works online only; offline the sheet is read-only and says why. Identity fields (legal
/// name, birth) are a Program Admin's: the sheet says so and offers no choice.
///
/// Returns true when a choice was saved.
Future<bool?> showFieldReviewSheet(
  BuildContext context, {
  required FieldReviewView review,
  required bool mayDecide,
  required bool online,
  required Future<void> Function(bool keepCurrent, String? historyId) onSave,
  DateTime? today,
}) => showModalBottomSheet<bool>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => FieldReviewSheet(
    review: review,
    mayDecide: mayDecide,
    online: online,
    onSave: onSave,
    today: today ?? DateTime.now(),
  ),
);

class FieldReviewSheet extends StatefulWidget {
  const FieldReviewSheet({
    super.key,
    required this.review,
    required this.mayDecide,
    required this.online,
    required this.onSave,
    required this.today,
  });

  final FieldReviewView review;

  /// The person may decide reviews of ordinary fields (`patients.edit`).
  final bool mayDecide;
  final bool online;
  final Future<void> Function(bool keepCurrent, String? historyId) onSave;
  final DateTime today;

  @override
  State<FieldReviewSheet> createState() => _FieldReviewSheetState();
}

class _FieldReviewSheetState extends State<FieldReviewSheet> {
  /// Null: the value on the chart now; otherwise the alternate's history ID. Nothing is chosen
  /// until the person chooses.
  String? _choice;
  bool _chosen = false;
  bool _saving = false;
  String? _error;

  bool get _identity => widget.review.needs == ReviewNeeds.patientsCorrectIdentity;

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.onSave(_choice == null, _choice);
      if (mounted) Navigator.of(context).pop(true);
    } on NetworkException {
      if (mounted) setState(() => _error = 'Connect to save a choice.');
    } on ApiException catch (e) {
      if (mounted) {
        setState(
          () => _error = e.status == 409
              ? 'The value changed since this was opened. Open the chart again to see it.'
              : 'The choice couldn’t be saved. Try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.review;
    final text = Theme.of(context).textTheme;
    final label = patientFieldLabels[r.field] ?? r.field;
    final canChoose = !_identity && widget.mayDecide;
    final current = r.current;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(header: true, child: Text('Which is right?', style: text.titleLarge)),
            const SizedBox(height: FieldSpace.s1),
            Text('Two values were recorded for $label.', style: text.bodyLarge),
            const SizedBox(height: FieldSpace.s3),
            if (_identity) ...[
              const NoticeMessage('A Program Admin will check this.'),
              const SizedBox(height: FieldSpace.s3),
            ],
            Semantics(
              container: true,
              label: 'Values for $label',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _ValueCard(
                    value: patientValueText(r.field, current.value, widget.today),
                    who: 'On the chart now',
                    when: current.changedAt == null ? null : shortDate(current.changedAt!, widget.today),
                    selected: _chosen && _choice == null,
                    onTap: canChoose
                        ? () => setState(() {
                            _chosen = true;
                            _choice = null;
                          })
                        : null,
                  ),
                  for (final a in r.alternates) ...[
                    const SizedBox(height: FieldSpace.s2),
                    _ValueCard(
                      value: patientValueText(r.field, a.value, widget.today),
                      who: 'Recorded by ${a.by.displayName}',
                      when: a.deviceTime == null ? null : shortDate(a.deviceTime!, widget.today),
                      selected: _chosen && _choice == a.historyId,
                      onTap: canChoose
                          ? () => setState(() {
                              _chosen = true;
                              _choice = a.historyId;
                            })
                          : null,
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: FieldSpace.s3),
            if (_error != null) ...[ErrorMessage(_error!), const SizedBox(height: FieldSpace.s3)],
            if (canChoose) ...[
              if (!widget.online)
                Padding(
                  padding: const EdgeInsets.only(bottom: FieldSpace.s2),
                  child: Text(
                    'Connect to save a choice. Until then both values stay on the chart.',
                    style: text.bodyLarge,
                  ),
                ),
              BusyButton(label: 'Save choice', busy: _saving, onPressed: widget.online && _chosen ? _save : null),
            ] else if (!_identity)
              Text('Someone who can edit patient details will choose.', style: text.bodyLarge),
          ],
        ),
      ),
    );
  }
}

/// One value as a radio card, read with who recorded it and when.
class _ValueCard extends StatelessWidget {
  const _ValueCard({required this.value, required this.who, required this.when, required this.selected, this.onTap});
  final String value;
  final String who;
  final String? when;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final detail = when == null ? who : '$who · $when';
    return Semantics(
      inMutuallyExclusiveGroup: true,
      checked: selected,
      enabled: onTap != null,
      label: '$value. $detail',
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: selected ? c.accentSoft : c.surface,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: selected ? c.accent : c.lineStrong, width: selected ? 2 : 1.5),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(FieldRadius.md),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: FieldTap.large),
            child: Padding(
              padding: const EdgeInsets.all(FieldSpace.s3),
              child: Row(
                children: [
                  if (onTap != null) ...[
                    Icon(selected ? LucideIcons.circleDot : LucideIcons.circle, color: c.ink),
                    const SizedBox(width: FieldSpace.s3),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(value, style: text.titleMedium),
                        Text(detail, style: text.bodyMedium),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
