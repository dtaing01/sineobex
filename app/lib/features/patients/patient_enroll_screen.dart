import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/tokens.dart';
import '../../core/util/formatting.dart';
import '../../data/models/models.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_card.dart';
import '../../widgets/app_input.dart';
import '../../widgets/mini_map.dart';

/// Ports the enrollment form inside `PatientsView`.
///
/// Two things differ from the prototype, both deliberate: the record persists,
/// and the location is captured from the device rather than scattered randomly
/// within ±0.01° of downtown Detroit (plan defect D11).
class PatientEnrollScreen extends ConsumerStatefulWidget {
  const PatientEnrollScreen({super.key});

  @override
  ConsumerState<PatientEnrollScreen> createState() =>
      _PatientEnrollScreenState();
}

class _PatientEnrollScreenState extends ConsumerState<PatientEnrollScreen> {
  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _phone = TextEditingController();
  final _insurance = TextEditingController();
  final _memberId = TextEditingController();
  final _doctor = TextEditingController();
  final _location = TextEditingController();

  DateTime? _dob;
  RiskLevel _risk = RiskLevel.low;
  double? _lat;
  double? _lng;
  bool _locating = false;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [
      _firstName,
      _lastName,
      _phone,
      _insurance,
      _memberId,
      _doctor,
      _location,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _canSave =>
      _firstName.text.trim().isNotEmpty &&
      _lastName.text.trim().isNotEmpty &&
      _location.text.trim().isNotEmpty;

  Future<void> _captureLocation() async {
    setState(() {
      _locating = true;
      _error = null;
    });
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        setState(() => _error =
            'Location permission denied. The typed location will be used.');
        return;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 20),
        ),
      );
      setState(() {
        _lat = pos.latitude;
        _lng = pos.longitude;
      });
    } catch (e) {
      setState(() => _error = 'Could not read GPS. The typed location '
          'will be used instead.');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dob ?? DateTime(now.year - 40),
      firstDate: DateTime(now.year - 120),
      lastDate: now,
      helpText: 'Date of birth',
    );
    if (picked != null) setState(() => _dob = picked);
  }

  Future<void> _save() async {
    if (!_canSave || _saving) return;
    setState(() => _saving = true);
    try {
      final patient = await ref.read(patientRepositoryProvider).enroll(
            firstName: _firstName.text,
            lastName: _lastName.text,
            dob: _dob ?? DateTime(1990),
            risk: _risk,
            loc: _location.text,
            lat: _lat ?? detroitCenter.latitude,
            lng: _lng ?? detroitCenter.longitude,
            phone: _phone.text,
            insuranceName: _insurance.text,
            memberId: _memberId.text,
            primaryDoctor: _doctor.text,
          );
      if (!mounted) return;
      context.go(AppRoutes.patientDetail(patient.id));
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = 'Could not save: $e';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.slate50,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(maxWidth: AppSpace.maxContentWidth),
            child: ListView(
              padding: const EdgeInsets.all(AppSpace.x4),
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: AppButton(
                    label: 'Cancel',
                    icon: LucideIcons.chevronLeft,
                    variant: AppButtonVariant.ghost,
                    foreground: AppColors.slate500,
                    onPressed: () => context.pop(),
                  ),
                ),
                const SizedBox(height: AppSpace.x4),
                const Text(
                  'New Patient Enrollment',
                  style: TextStyle(
                    fontSize: AppText.xxl,
                    fontWeight: AppText.bold,
                    color: AppColors.slate900,
                  ),
                ),
                const SizedBox(height: AppSpace.x4),
                AppCard(
                  child: Column(
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: LabelledField(
                              label: 'First Name',
                              child: AppInput(
                                controller: _firstName,
                                placeholder: 'Jane',
                                textCapitalization: TextCapitalization.words,
                                onChanged: (_) => setState(() {}),
                              ),
                            ),
                          ),
                          const SizedBox(width: AppSpace.x3),
                          Expanded(
                            child: LabelledField(
                              label: 'Last Name',
                              child: AppInput(
                                controller: _lastName,
                                placeholder: 'Doe',
                                textCapitalization: TextCapitalization.words,
                                onChanged: (_) => setState(() {}),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpace.x4),
                      LabelledField(
                        label: 'Date of Birth',
                        child: AppInput(
                          readOnly: true,
                          onTap: _pickDob,
                          placeholder: 'Select a date',
                          controller: TextEditingController(
                            text: _dob == null ? '' : Fmt.isoDate(_dob!),
                          ),
                        ),
                      ),
                      const SizedBox(height: AppSpace.x4),
                      LabelledField(
                        label: 'Phone Number',
                        child: AppInput(
                          controller: _phone,
                          placeholder: '(555) 000-0000',
                          keyboardType: TextInputType.phone,
                          inputFormatters: [
                            FilteringTextInputFormatter.allow(
                              RegExp(r'[0-9()+\-\s]'),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: AppSpace.x4),
                      LabelledField(
                        label: 'Current/Found Location',
                        child: Column(
                          children: [
                            AppInput(
                              controller: _location,
                              placeholder: 'Cass Corridor',
                              textCapitalization: TextCapitalization.words,
                              onChanged: (_) => setState(() {}),
                            ),
                            const SizedBox(height: AppSpace.x2),
                            Row(
                              children: [
                                Expanded(
                                  child: AppButton(
                                    label: _locating
                                        ? 'Reading GPS…'
                                        : _lat == null
                                            ? 'Use my location'
                                            : 'Location captured',
                                    icon: _lat == null
                                        ? LucideIcons.navigation
                                        : LucideIcons.check,
                                    size: AppButtonSize.sm,
                                    variant: AppButtonVariant.outline,
                                    foreground: _lat == null
                                        ? AppColors.blue600
                                        : AppColors.emerald600,
                                    borderColor: _lat == null
                                        ? AppColors.blue200
                                        : AppColors.emerald100,
                                    onPressed:
                                        _locating ? null : _captureLocation,
                                  ),
                                ),
                              ],
                            ),
                            if (_lat != null)
                              Padding(
                                padding:
                                    const EdgeInsets.only(top: AppSpace.x1),
                                child: Text(
                                  '${_lat!.toStringAsFixed(5)}, '
                                  '${_lng!.toStringAsFixed(5)}',
                                  style: const TextStyle(
                                    fontSize: AppText.tiny,
                                    color: AppColors.slate400,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(height: AppSpace.x4),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: LabelledField(
                              label: 'Insurance Name',
                              child: AppInput(
                                controller: _insurance,
                                placeholder: 'Blue Cross',
                              ),
                            ),
                          ),
                          const SizedBox(width: AppSpace.x3),
                          Expanded(
                            child: LabelledField(
                              label: 'Member ID#',
                              child: AppInput(
                                controller: _memberId,
                                placeholder: 'XYZ123456',
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpace.x4),
                      LabelledField(
                        label: 'Primary Doctor',
                        child: AppInput(
                          controller: _doctor,
                          placeholder: 'Dr. Smith',
                          textCapitalization: TextCapitalization.words,
                        ),
                      ),
                      const SizedBox(height: AppSpace.x4),
                      LabelledField(
                        label: 'Risk Assessment',
                        child: FilterChipRow<RiskLevel>(
                          values: RiskLevel.values,
                          selected: _risk,
                          labelOf: (r) => r.label,
                          onSelected: (r) => setState(() => _risk = r),
                          expandEvenly: true,
                          height: 32,
                        ),
                      ),
                    ],
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: AppSpace.x3),
                  Text(
                    _error!,
                    style: const TextStyle(
                      fontSize: AppText.xs,
                      color: AppColors.orange700,
                    ),
                  ),
                ],
                const SizedBox(height: AppSpace.x4),
                AppButton(
                  label: _saving ? 'Saving…' : 'Complete Enrollment',
                  icon: LucideIcons.save,
                  size: AppButtonSize.lg,
                  expanded: true,
                  radius: AppRadius.xl,
                  shadows: AppShadows.blueGlow,
                  onPressed: _canSave && !_saving ? _save : null,
                ),
                const SizedBox(height: AppSpace.x4),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
