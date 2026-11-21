import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';

import '../../app_providers.dart';
import '../../auth/session_controller.dart';
import '../../design/widgets/form_bits.dart';
import '../../security/key_vault.dart';

/// Whether this phone can use biometrics. Overridden in tests.
final biometricsAvailableProvider = FutureProvider<bool>((ref) async {
  try {
    final auth = LocalAuthentication();
    return await auth.isDeviceSupported() && await auth.canCheckBiometrics;
  } on Object {
    return false;
  }
});

class _PinField extends StatelessWidget {
  const _PinField({required this.controller, required this.label, this.onSubmitted, this.autofocus = false});
  final TextEditingController controller;
  final String label;
  final VoidCallback? onSubmitted;
  final bool autofocus;

  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    autofocus: autofocus,
    decoration: InputDecoration(labelText: label),
    keyboardType: TextInputType.number,
    obscureText: true,
    enableSuggestions: false,
    autocorrect: false,
    inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(12)],
    onSubmitted: (_) => onSubmitted?.call(),
  );
}

class PinSetupScreen extends ConsumerStatefulWidget {
  const PinSetupScreen({super.key});
  @override
  ConsumerState<PinSetupScreen> createState() => _PinSetupScreenState();
}

class _PinSetupScreenState extends ConsumerState<PinSetupScreen> {
  final _pin = TextEditingController();
  final _confirm = TextEditingController();
  bool _useBiometric = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _pin.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final problem = KeyVault.pinProblem(_pin.text);
    if (problem != null) return setState(() => _error = problem);
    if (_pin.text != _confirm.text) return setState(() => _error = 'The two PINs don’t match.');
    setState(() {
      _busy = true;
      _error = null;
    });
    final session = ref.read(sessionProvider);
    await session.setPin(_pin.text);
    if (_useBiometric) await session.enableBiometric();
  }

  @override
  Widget build(BuildContext context) {
    final biometrics = ref.watch(biometricsAvailableProvider).value ?? false;
    return AuthScaffold(
      title: 'Choose a PIN',
      lede:
          'The PIN unlocks Sineobex on this phone, even with no signal. Use at least 6 digits. '
          'After 10 wrong tries, the patient data on this phone is erased.',
      children: [
        if (_error != null) ...[ErrorMessage(_error!), gap],
        _PinField(controller: _pin, label: 'New PIN', autofocus: true),
        gap,
        _PinField(controller: _confirm, label: 'Type it again', onSubmitted: _save),
        if (biometrics) ...[
          gap,
          SwitchListTile(
            value: _useBiometric,
            onChanged: (v) => setState(() => _useBiometric = v),
            title: const Text('Also unlock with fingerprint or face'),
            contentPadding: EdgeInsets.zero,
          ),
        ],
        const SizedBox(height: 24),
        BusyButton(label: 'Save PIN', busy: _busy, onPressed: _save),
      ],
    );
  }
}

class UnlockScreen extends ConsumerStatefulWidget {
  const UnlockScreen({super.key});
  @override
  ConsumerState<UnlockScreen> createState() => _UnlockScreenState();
}

class _UnlockScreenState extends ConsumerState<UnlockScreen> {
  final _pin = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  Future<void> _unlock() async {
    if (_pin.text.isEmpty) return setState(() => _error = 'Enter your PIN.');
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider).unlockWithPin(_pin.text);
    } on WrongPin catch (e) {
      _pin.clear();
      if (mounted) {
        setState(
          () => _error = e.attemptsLeft <= 3
              ? 'Wrong PIN. ${e.attemptsLeft} ${e.attemptsLeft == 1 ? 'try' : 'tries'} left before the data on this phone is erased.'
              : 'Wrong PIN. Try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _biometric() async {
    final ok = await ref.read(sessionProvider).unlockWithBiometric();
    if (!ok && mounted) setState(() => _error = 'Biometric unlock didn’t work. Use your PIN.');
  }

  Future<void> _signOut() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out on this phone?'),
        content: const Text(
          'You’ll need your password and authenticator code to sign in again. Anything that hasn’t synced '
          'stays encrypted on this phone and finishes syncing when you sign in again.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (confirmed == true) await ref.read(sessionProvider).signOut();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(sessionProvider).state;
    if (state is! Locked) return const SizedBox.shrink();
    final first = state.user.displayName.split(' ').first;
    return AuthScaffold(
      title: 'Welcome back, $first',
      lede: 'Sineobex locks itself when you step away, to protect patient privacy.',
      children: [
        if (_error != null) ...[ErrorMessage(_error!), gap],
        _PinField(controller: _pin, label: 'PIN', autofocus: true, onSubmitted: _unlock),
        const SizedBox(height: 24),
        BusyButton(label: 'Unlock', busy: _busy, onPressed: _unlock),
        if (state.biometric) ...[
          gap,
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(onPressed: _biometric, child: const Text('Unlock with fingerprint or face')),
          ),
        ],
        gap,
        TextButton(onPressed: _signOut, child: const Text('Sign out')),
      ],
    );
  }
}

class TeamPickerScreen extends ConsumerWidget {
  const TeamPickerScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(sessionProvider).state;
    if (state is! Unlocked) return const SizedBox.shrink();
    return AuthScaffold(
      title: 'Choose a team',
      lede: 'You work with more than one team. Pick the one you’re with today.',
      children: [
        if (state.user.teams.isEmpty) const Text('You aren’t on a team yet. Ask your Program Admin to invite you.'),
        for (final t in state.user.teams) ...[
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: () => ref.read(sessionProvider).selectTeam(t.id),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text('${t.name} · ${t.roleName}'),
              ),
            ),
          ),
          gap,
        ],
      ],
    );
  }
}
