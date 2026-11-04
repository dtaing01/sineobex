import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../design/widgets/status_chip.dart';
import '../../patients/normalize.dart' show normalizeName;
import '../../patients/patient_providers.dart';
import '../../patients/problems.dart';
import '../../sync/local_store.dart' show ChartingPaused, LocalValidationError;
import 'patient_labels.dart';
import 'patient_widgets.dart';

/// **Add problem** (design 9.5): a title, an optional code from the bundled ICD-10-CM list ("No
/// code" allowed and explained), New or Ongoing (nothing preselected; Resolved isn't offered), an
/// optional onset date, and Sensitive (only for `patients.view_sensitive`; on and locked for a
/// sensitive code). When a Resolved problem of the patient has the same title or code, it asks
/// whether this is the same problem coming back.
class AddProblemScreen extends StatelessWidget {
  const AddProblemScreen({super.key, required this.patientId});
  final String patientId;

  @override
  Widget build(BuildContext context) => PatientsGate(
    title: 'Add problem',
    builder: (context, services) => _AddProblem(services: services, patientId: patientId),
  );
}

class _AddProblem extends ConsumerStatefulWidget {
  const _AddProblem({required this.services, required this.patientId});
  final PatientServices services;
  final String patientId;

  @override
  ConsumerState<_AddProblem> createState() => _AddProblemState();
}

class _AddProblemState extends ConsumerState<_AddProblem> {
  final _title = TextEditingController();
  final _codeQuery = TextEditingController();
  final _titleFocus = FocusNode();
  ProblemCode? _code;
  String? _status;
  bool _sensitive = false;
  DateTime? _onset;

  /// The answer to "Is this the same problem coming back?": null until asked and answered.
  bool? _sameComingBack;
  String? _error;
  String? _titleError;

  PatientServices get _s => widget.services;

  @override
  void dispose() {
    _title.dispose();
    _codeQuery.dispose();
    _titleFocus.dispose();
    super.dispose();
  }

  /// A Resolved problem of this patient with the same code or the same title, words compared
  /// loosely: the recurrence question (9.5).
  ProblemView? _resolvedMatch() {
    final title = normalizeName(_title.text);
    for (final p in _s.problems.problemsOf(widget.patientId) ?? const <ProblemView>[]) {
      if (p.status != 'resolved') continue;
      if (_code != null && p.code?.code == _code!.code) return p;
      if (title != null && normalizeName(p.title) == title) return p;
    }
    return null;
  }

  Future<void> _pickOnset() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _onset ?? now,
      firstDate: DateTime(1900),
      lastDate: now,
      helpText: 'When did it start?',
    );
    if (picked != null && mounted) setState(() => _onset = picked);
  }

  void _save() {
    final title = _title.text.trim();
    setState(() {
      _titleError = title.isEmpty ? 'Give the problem a title.' : null;
      _error = _status == null ? 'Choose New or Ongoing.' : null;
    });
    if (_titleError != null) {
      _titleFocus.requestFocus();
      return;
    }
    if (_error != null) return;
    final match = _resolvedMatch();
    if (match != null && _sameComingBack == null) {
      setState(() => _error = 'Answer whether this is the same problem coming back.');
      return;
    }
    try {
      _s.problems.add(
        widget.patientId,
        title: title,
        code: _code?.value,
        status: _status!,
        sensitive: _sensitive || (_code?.sensitive ?? false),
        onsetDate: _onset == null ? null : _iso(_onset!),
        recurrenceOf: match != null && _sameComingBack == true ? match.id : null,
      );
      _s.changed();
      showDone(context, 'Problem added');
      context.pop();
    } on LocalValidationError catch (e) {
      setState(() => _error = e.message);
    } on ChartingPaused catch (e) {
      setState(() => _error = e.message);
    }
  }

  static String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final codes = ref.watch(problemCodesProvider);
    final text = Theme.of(context).textTheme;
    final today = todayOf(ref);
    final codeSensitive = _code?.sensitive ?? false;
    final match = _resolvedMatch();
    final results = switch (codes) {
      AsyncData(:final value) when _code == null => value.search(_codeQuery.text, limit: 8),
      _ => const <ProblemCode>[],
    };
    return Scaffold(
      appBar: AppBar(title: const Text('Add problem')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(FieldSpace.s4),
          children: [
            if (_error != null) ...[ErrorMessage(_error!), const SizedBox(height: FieldSpace.s3)],
            PhiField(
              name: 'problemTitle',
              label: 'Title',
              controller: _title,
              focusNode: _titleFocus,
              error: _titleError,
              maxLength: 200,
              capitalization: TextCapitalization.sentences,
              onChanged: (_) => setState(() => _sameComingBack = null),
            ),
            const SectionHeading('Code'),
            if (_code case final code?) ...[
              StatusBanner(
                icon: LucideIcons.circleCheck,
                tone: ChipTone.good,
                text: '${code.title} (${code.code})',
                action: OutlinedButton(
                  onPressed: () => setState(() {
                    _code = null;
                    _sameComingBack = null;
                  }),
                  child: Semantics(label: 'Remove code ${code.code}', excludeSemantics: true, child: const Text('Remove code')),
                ),
              ),
            ] else ...[
              PhiField(
                name: 'codeSearch',
                label: 'Search codes by word or code',
                controller: _codeQuery,
                prefixIcon: const Icon(LucideIcons.search),
                capitalization: TextCapitalization.none,
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: FieldSpace.s2),
              for (final c in results)
                Semantics(
                  button: true,
                  label: '${c.title}, code ${c.code}',
                  excludeSemantics: true,
                  child: InkWell(
                    onTap: () => setState(() {
                      _code = c;
                      _sameComingBack = null;
                      if (_title.text.trim().isEmpty) _title.text = c.title;
                      if (c.sensitive) _sensitive = true;
                    }),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: FieldTap.min),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: FieldSpace.s2),
                        child: Text('${c.title} (${c.code})', style: text.bodyLarge),
                      ),
                    ),
                  ),
                ),
              if (_codeQuery.text.trim().isNotEmpty && results.isEmpty && codes is AsyncData)
                Text('No code on this phone’s list matches.', style: text.bodyLarge),
              const SizedBox(height: FieldSpace.s2),
              Text(
                'No code is fine: the problem is saved without one. A problem with no code won’t add supplies to '
                'route bags.',
                style: text.bodyMedium?.copyWith(color: context.field.inkMuted),
              ),
            ],
            const SectionHeading('Status'),
            RadioChips<String>(
              options: const {'new': 'New', 'ongoing': 'Ongoing'},
              selected: _status,
              onSelected: (v) => setState(() => _status = v),
            ),
            const SectionHeading('Started'),
            Wrap(
              spacing: FieldSpace.s2,
              runSpacing: FieldSpace.s2,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (_onset != null) Text(shortDate(_onset!, today), style: text.bodyLarge),
                OutlinedButton.icon(
                  onPressed: () => unawaited(_pickOnset()),
                  icon: const Icon(LucideIcons.calendar),
                  label: Text(_onset == null ? 'Add the date it started' : 'Change the date'),
                ),
                if (_onset != null)
                  TextButton(onPressed: () => setState(() => _onset = null), child: const Text('Clear the date')),
              ],
            ),
            if (_s.problems.maySeeSensitive) ...[
              const SectionHeading('Sensitive'),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Sensitive'),
                subtitle: Text(
                  codeSensitive
                      ? 'This code is always sensitive.'
                      : 'Only people who may see sensitive problems see it.',
                ),
                value: _sensitive || codeSensitive,
                onChanged: codeSensitive ? null : (v) => setState(() => _sensitive = v),
              ),
            ],
            if (match != null) ...[
              const SizedBox(height: FieldSpace.s3),
              StatusBanner(
                icon: LucideIcons.history,
                tone: ChipTone.info,
                text: 'Is this the same problem coming back?',
                detail: '“${match.title}” is on the list as Resolved.',
                action: RadioChips<bool>(
                  options: const {true: 'Yes, it came back', false: 'No, a different problem'},
                  selected: _sameComingBack,
                  onSelected: (v) => setState(() => _sameComingBack = v),
                ),
              ),
            ],
            const SizedBox(height: FieldSpace.s5),
            SizedBox(height: FieldTap.large, child: FilledButton(onPressed: _save, child: const Text('Add problem'))),
          ],
        ),
      ),
    );
  }
}
