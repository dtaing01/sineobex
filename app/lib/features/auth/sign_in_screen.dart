import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/env/app_config.dart';
import '../../core/theme/tokens.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_card.dart';
import '../../widgets/app_input.dart';
import 'session_controller.dart';

class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _mfaCode = TextEditingController();
  final _newPassword = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _mfaCode.dispose();
    _newPassword.dispose();
    super.dispose();
  }

  Future<void> _run(Future<bool> Function() action) async {
    setState(() => _submitting = true);
    await action();
    if (mounted) setState(() => _submitting = false);
  }

  Future<void> _submit() => _run(
    () => ref
        .read(sessionControllerProvider.notifier)
        .signIn(_username.text.trim(), _password.text),
  );

  Future<void> _submitMfa() => _run(
    () =>
        ref.read(sessionControllerProvider.notifier).confirmMfa(_mfaCode.text),
  );

  Future<void> _submitNewPassword() => _run(
    () => ref
        .read(sessionControllerProvider.notifier)
        .completeNewPassword(_newPassword.text),
  );

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionControllerProvider);
    final configured = ref
        .read(sessionControllerProvider.notifier)
        .isConfigured;

    return Scaffold(
      backgroundColor: AppColors.slate50,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpace.x6),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Container(
                      padding: const EdgeInsets.all(AppSpace.x3),
                      decoration: BoxDecoration(
                        color: AppColors.blue600,
                        borderRadius: BorderRadius.circular(AppRadius.xxl),
                      ),
                      child: const Icon(
                        LucideIcons.stethoscope,
                        size: 32,
                        color: AppColors.white,
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpace.x4),
                  const Text(
                    'Sineobex',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: AppText.xxxl,
                      fontWeight: AppText.bold,
                      color: AppColors.slate900,
                      letterSpacing: AppText.tight,
                    ),
                  ),
                  const Text(
                    'Street medicine outreach',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: AppText.sm,
                      color: AppColors.slate500,
                    ),
                  ),
                  const SizedBox(height: AppSpace.x8),
                  if (!configured)
                    AppCard(
                      background: AppColors.amber50,
                      borderColor: AppColors.amber200,
                      child: const Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            LucideIcons.triangleAlert,
                            size: 16,
                            color: AppColors.amber600,
                          ),
                          SizedBox(width: AppSpace.x2),
                          Expanded(
                            child: Text(
                              'No identity provider is configured, so sign-in '
                              'is not enforced in this build. Do not enter '
                              'real patient data until Cognito is wired up.',
                              style: TextStyle(
                                fontSize: AppText.micro,
                                color: AppColors.amber600,
                                height: 1.5,
                              ),
                            ),
                          ),
                        ],
                      ),
                    )
                  else if (session.state == SessionState.mfaRequired)
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'Enter the 6-digit code from your authenticator app.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: AppText.sm,
                            color: AppColors.slate600,
                          ),
                        ),
                        const SizedBox(height: AppSpace.x4),
                        LabelledField(
                          label: 'Verification code',
                          child: AppInput(
                            controller: _mfaCode,
                            placeholder: '123456',
                            keyboardType: TextInputType.number,
                            height: 48,
                          ),
                        ),
                      ],
                    )
                  else if (session.state == SessionState.newPasswordRequired)
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'Choose a permanent password to finish setting up '
                          'your account.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: AppText.sm,
                            color: AppColors.slate600,
                          ),
                        ),
                        const SizedBox(height: AppSpace.x4),
                        LabelledField(
                          label: 'New password',
                          child: SizedBox(
                            height: 48,
                            child: TextField(
                              controller: _newPassword,
                              obscureText: true,
                              decoration: InputDecoration(
                                filled: true,
                                fillColor: AppColors.white,
                                helperText:
                                    'At least 14 characters, with upper, '
                                    'lower, a digit and a symbol.',
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(
                                    AppRadius.xl,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    )
                  else
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        LabelledField(
                          label: 'Email',
                          child: AppInput(
                            controller: _username,
                            placeholder: 'you@agency.org',
                            keyboardType: TextInputType.emailAddress,
                            height: 48,
                          ),
                        ),
                        const SizedBox(height: AppSpace.x4),
                        LabelledField(
                          label: 'Password',
                          child: SizedBox(
                            height: 48,
                            child: TextField(
                              controller: _password,
                              obscureText: true,
                              decoration: InputDecoration(
                                filled: true,
                                fillColor: AppColors.white,
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(
                                    AppRadius.xl,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  if (session.error != null) ...[
                    const SizedBox(height: AppSpace.x3),
                    Text(
                      session.error!,
                      style: const TextStyle(
                        fontSize: AppText.xs,
                        color: AppColors.red600,
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSpace.x6),
                  AppButton(
                    label: _submitting
                        ? 'Working…'
                        : switch (session.state) {
                            SessionState.mfaRequired => 'Verify',
                            SessionState.newPasswordRequired => 'Set password',
                            _ => configured ? 'Sign in' : 'Continue',
                          },
                    size: AppButtonSize.lg,
                    expanded: true,
                    radius: AppRadius.xl,
                    shadows: AppShadows.blueGlow,
                    onPressed: _submitting
                        ? null
                        : switch (session.state) {
                            SessionState.mfaRequired => _submitMfa,
                            SessionState.newPasswordRequired =>
                              _submitNewPassword,
                            _ => _submit,
                          },
                  ),
                  const SizedBox(height: AppSpace.x6),
                  Text(
                    'This system contains protected health information. '
                    'Access is logged. Version ${AppConfig.appVersion}.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: AppText.tiny,
                      color: AppColors.slate400,
                      height: 1.5,
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
