import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/theme/tokens.dart';
import '../../core/util/formatting.dart';
import '../../data/models/models.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_input.dart';

/// Ports the "Log New Encounter" flow.
///
/// In the prototype, "Save Entry" called `setIsLogging(false)` and nothing
/// else — the notes, the supplies, and the follow-up flag were all discarded
/// (plan defect D8). Here the encounter is written to the encrypted store,
/// queued for sync, appended to the patient's history, recorded as a movement
/// observation, and debited against inventory.
class EncounterForm extends ConsumerStatefulWidget {
  const EncounterForm({super.key, required this.patient});

  final Patient patient;

  @override
  ConsumerState<EncounterForm> createState() => _EncounterFormState();
}

class _EncounterFormState extends ConsumerState<EncounterForm> {
  final _notes = TextEditingController();
  final _needs = TextEditingController();
  final _location = TextEditingController();
  final _supplySearch = TextEditingController();

  bool _open = false;
  bool _saving = false;
  bool _followUp = false;
  DateTime? _followUpDate;
  final _selectedSupplies = <String>{};
  String _supplyQuery = '';

  @override
  void initState() {
    super.initState();
    _location.text = widget.patient.loc;
  }

  @override
  void dispose() {
    _notes.dispose();
    _needs.dispose();
    _location.dispose();
    _supplySearch.dispose();
    super.dispose();
  }

  void _reset() {
    _notes.clear();
    _needs.clear();
    _supplySearch.clear();
    _location.text = widget.patient.loc;
    setState(() {
      _open = false;
      _saving = false;
      _followUp = false;
      _followUpDate = null;
      _selectedSupplies.clear();
      _supplyQuery = '';
    });
  }

  Future<void> _pickFollowUpDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _followUpDate ?? now.add(const Duration(days: 14)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365 * 2)),
      helpText: 'Follow-up date',
    );
    if (picked != null) setState(() => _followUpDate = picked);
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() => _saving = true);

    final user = ref.read(currentUserProvider);
    final supplies = _selectedSupplies.toList();
    final location = _location.text.trim().isEmpty
        ? widget.patient.loc
        : _location.text.trim();

    try {
      await ref
          .read(patientRepositoryProvider)
          .logEncounter(
            patientId: widget.patient.id,
            provider: user.name,
            notes: _notes.text,
            needs: _needs.text,
            encounterLoc: location,
            supplies: supplies,
            followUpSet: _followUp,
            // Default to two weeks out if the user flagged a follow-up but
            // didn't pick a date, rather than losing the flag.
            followUpDate: _followUp
                ? (_followUpDate ??
                      DateTime.now().add(const Duration(days: 14)))
                : null,
            followUpLoc: location,
          );

      // Debit the supplies that were actually handed out.
      await ref
          .read(inventoryRepositoryProvider)
          .consume(supplies: supplies, location: location);

      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Encounter saved.')));
      _reset();
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Could not save encounter: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_open) {
      return AppButton(
        label: 'Log New Encounter',
        icon: LucideIcons.stethoscope,
        size: AppButtonSize.xl,
        expanded: true,
        radius: AppRadius.xxl,
        shadows: AppShadows.blueGlow,
        onPressed: () => setState(() => _open = true),
      );
    }

    final user = ref.watch(currentUserProvider);
    final inventory = ref.watch(inventoryProvider).valueOrNull ?? const [];

    // The prototype hardcoded `inventory.slice(0, 4)` — the first four items
    // only (plan defect D9). The full catalogue is searchable here.
    final available = inventory
        .where(
          (i) =>
              _supplyQuery.isEmpty ||
              i.name.toLowerCase().contains(_supplyQuery.toLowerCase()),
        )
        .take(_supplyQuery.isEmpty ? 8 : 20)
        .toList();

    return Container(
      decoration: BoxDecoration(
        color: AppColors.blue50.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AppColors.blue200, width: 2),
      ),
      padding: const EdgeInsets.all(AppSpace.x4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'New Field Entry',
                style: TextStyle(
                  fontSize: AppText.base,
                  fontWeight: AppText.bold,
                  color: AppColors.blue900,
                ),
              ),
              Flexible(
                child: Text(
                  'BY: ${user.name.toUpperCase()}',
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: AppText.micro,
                    fontWeight: AppText.bold,
                    color: AppColors.blue600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.x4),
          LabelledField(
            label: 'Needs Addressed',
            child: AppInput(
              controller: _needs,
              placeholder: 'Wound care, BP check, mental health support…',
              textCapitalization: TextCapitalization.sentences,
            ),
          ),
          const SizedBox(height: AppSpace.x4),
          LabelledField(
            label: 'Encounter Location',
            child: AppInput(
              controller: _location,
              placeholder: widget.patient.loc,
              textCapitalization: TextCapitalization.words,
            ),
          ),
          const SizedBox(height: AppSpace.x4),
          LabelledField(
            label: 'Encounter Notes',
            child: AppTextArea(
              controller: _notes,
              placeholder:
                  'Document findings, treatments, and immediate needs...',
            ),
          ),
          const SizedBox(height: AppSpace.x4),
          LabelledField(
            label: 'Supplies Used',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AppInput(
                  controller: _supplySearch,
                  placeholder: 'Search supplies…',
                  leadingIcon: LucideIcons.search,
                  height: 36,
                  onChanged: (v) => setState(() => _supplyQuery = v),
                ),
                const SizedBox(height: AppSpace.x2),
                Wrap(
                  spacing: AppSpace.x2,
                  runSpacing: AppSpace.x2,
                  children: [
                    for (final item in available)
                      _SupplyChip(
                        label: item.name,
                        selected: _selectedSupplies.contains(item.name),
                        outOfStock: item.isOutOfStock,
                        onTap: () => setState(() {
                          if (!_selectedSupplies.remove(item.name)) {
                            _selectedSupplies.add(item.name);
                          }
                        }),
                      ),
                  ],
                ),
                if (_selectedSupplies.isNotEmpty) ...[
                  const SizedBox(height: AppSpace.x2),
                  Text(
                    '${_selectedSupplies.length} selected — stock will be '
                    'debited on save.',
                    style: const TextStyle(
                      fontSize: AppText.tiny,
                      color: AppColors.slate500,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: AppSpace.x4),
          Container(
            padding: const EdgeInsets.all(AppSpace.x3),
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(AppRadius.xl),
              border: Border.all(color: AppColors.blue100),
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    SizedBox(
                      width: 20,
                      height: 20,
                      child: Checkbox(
                        value: _followUp,
                        visualDensity: VisualDensity.compact,
                        onChanged: (v) =>
                            setState(() => _followUp = v ?? false),
                      ),
                    ),
                    const SizedBox(width: AppSpace.x3),
                    const Expanded(
                      child: Text(
                        'Flag for Follow-up',
                        style: TextStyle(
                          fontSize: AppText.xs,
                          fontWeight: AppText.bold,
                          color: AppColors.slate700,
                        ),
                      ),
                    ),
                  ],
                ),
                if (_followUp) ...[
                  const SizedBox(height: AppSpace.x2),
                  Row(
                    children: [
                      const Icon(
                        LucideIcons.calendar,
                        size: 14,
                        color: AppColors.blue600,
                      ),
                      const SizedBox(width: AppSpace.x2),
                      Expanded(
                        child: Text(
                          _followUpDate == null
                              ? 'In 14 days (default)'
                              : Fmt.isoDate(_followUpDate!),
                          style: const TextStyle(
                            fontSize: AppText.xs,
                            color: AppColors.slate600,
                          ),
                        ),
                      ),
                      AppButton(
                        label: 'Pick date',
                        size: AppButtonSize.sm,
                        variant: AppButtonVariant.outline,
                        foreground: AppColors.blue600,
                        borderColor: AppColors.blue200,
                        onPressed: _pickFollowUpDate,
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: AppSpace.x4),
          Row(
            children: [
              Expanded(
                child: AppButton(
                  label: 'Cancel',
                  variant: AppButtonVariant.ghost,
                  onPressed: _saving ? null : _reset,
                ),
              ),
              const SizedBox(width: AppSpace.x2),
              Expanded(
                child: AppButton(
                  label: _saving ? 'Saving…' : 'Save Entry',
                  icon: LucideIcons.save,
                  onPressed: _saving ? null : _save,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SupplyChip extends StatelessWidget {
  const _SupplyChip({
    required this.label,
    required this.selected,
    required this.outOfStock,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final bool outOfStock;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.blue600 : AppColors.white,
      borderRadius: BorderRadius.circular(AppRadius.full),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.full),
        child: Container(
          height: 32,
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.x3),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.full),
            border: Border.all(
              color: selected ? AppColors.blue600 : AppColors.slate200,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (outOfStock) ...[
                Icon(
                  LucideIcons.triangleAlert,
                  size: 10,
                  color: selected ? AppColors.white : AppColors.orange500,
                ),
                const SizedBox(width: 4),
              ],
              Text(
                label,
                style: TextStyle(
                  fontSize: AppText.micro,
                  fontWeight: AppText.bold,
                  color: selected ? AppColors.white : AppColors.slate700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
