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
  bool _submitting = false;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    await ref
        .read(sessionControllerProvider.notifier)
        .signIn(_username.text.trim(), _password.text);
    if (mounted) setState(() => _submitting = false);
  }

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
                        ? 'Signing in…'
                        : configured
                        ? 'Sign in'
                        : 'Continue',
                    size: AppButtonSize.lg,
                    expanded: true,
                    radius: AppRadius.xl,
                    shadows: AppShadows.blueGlow,
                    onPressed: _submitting ? null : _submit,
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
