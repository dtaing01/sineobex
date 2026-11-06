import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app_providers.dart';
import '../../auth/auth_provider.dart';
import '../../auth/session_controller.dart';
import '../../design/widgets/form_bits.dart';

/// Shared state for the sign-in forms: busy flag and the last error.
mixin _Submitting<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  bool busy = false;
  String? error;

  Future<void> submit(Future<void> Function() action) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } on AuthException catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}

class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});
  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> with _Submitting {
  final _email = TextEditingController();
  final _password = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _go() {
    if (_email.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => error = 'Enter your email and password.');
      return;
    }
    unawaited(submit(() => ref.read(sessionProvider).signIn(_email.text, _password.text)));
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(sessionProvider).state;
    final notice = state is SignedOut ? state.notice : null;
    return AuthScaffold(
      title: 'Sign in',
      lede: 'Use your team account. Next you’ll enter a code from your authenticator app.',
      children: [
        if (notice != null) ...[NoticeMessage(notice), gap],
        if (error != null) ...[ErrorMessage(error!), gap],
        AutofillGroup(
          child: Column(
            children: [
              TextField(
                controller: _email,
                decoration: const InputDecoration(labelText: 'Email'),
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.username],
                textInputAction: TextInputAction.next,
                autocorrect: false,
              ),
              gap,
              TextField(
                controller: _password,
                decoration: const InputDecoration(labelText: 'Password'),
                obscureText: true,
                autofillHints: const [AutofillHints.password],
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _go(),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        BusyButton(label: 'Continue', busy: busy, onPressed: _go),
      ],
    );
  }
}

class _CodeField extends StatelessWidget {
  const _CodeField({required this.controller, required this.onSubmitted});
  final TextEditingController controller;
  final VoidCallback onSubmitted;

  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    decoration: const InputDecoration(labelText: '6-digit code'),
    keyboardType: TextInputType.number,
    inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
    autofillHints: const [AutofillHints.oneTimeCode],
    onSubmitted: (_) => onSubmitted(),
  );
}

class MfaScreen extends ConsumerStatefulWidget {
  const MfaScreen({super.key});
  @override
  ConsumerState<MfaScreen> createState() => _MfaScreenState();
}

class _MfaScreenState extends ConsumerState<MfaScreen> with _Submitting {
  final _code = TextEditingController();

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  void _go() {
    if (_code.text.length != 6) {
      setState(() => error = 'The code is 6 digits.');
      return;
    }
    unawaited(submit(() => ref.read(sessionProvider).verifyCode(_code.text)));
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: 'Enter your code',
      lede: 'Open your authenticator app (for example Microsoft Authenticator, Google Authenticator or Duo Mobile) and enter the code for Sineobex.',
      children: [
        if (error != null) ...[ErrorMessage(error!), gap],
        _CodeField(controller: _code, onSubmitted: _go),
        const SizedBox(height: 24),
        BusyButton(label: 'Sign in', busy: busy, onPressed: _go),
        gap,
        TextButton(onPressed: ref.read(sessionProvider).restartSignIn, child: const Text('Use a different account')),
      ],
    );
  }
}

class EnrollScreen extends ConsumerStatefulWidget {
  const EnrollScreen({super.key});
  @override
  ConsumerState<EnrollScreen> createState() => _EnrollScreenState();
}

class _EnrollScreenState extends ConsumerState<EnrollScreen> with _Submitting {
  final _code = TextEditingController();

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  void _go() {
    if (_code.text.length != 6) {
      setState(() => error = 'The code is 6 digits.');
      return;
    }
    unawaited(submit(() => ref.read(sessionProvider).verifyCode(_code.text)));
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(sessionProvider).state;
    final enrollment = state is AwaitingEnrollment ? state.enrollment : null;
    return AuthScaffold(
      title: 'Set up your authenticator',
      lede: 'Every sign-in needs a code from an authenticator app. Sineobex never sends codes by text message.',
      children: [
        if (error != null) ...[ErrorMessage(error!), gap],
        if (enrollment == null)
          BusyButton(
            label: 'Start setup',
            busy: busy,
            onPressed: () => unawaited(submit(() => ref.read(sessionProvider).beginEnrollment())),
          )
        else ...[
          OutlinedButton(
            onPressed: () => unawaited(launchUrl(Uri.parse(enrollment.uri))),
            child: const Text('Add Sineobex to my authenticator app'),
          ),
          gap,
          Text('Or type this key into the app:', style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: 8),
          // Plain text, not selectable: the key is a credential and the clipboard is readable by
          // other apps.
          Text(
            enrollment.secret,
            style: const TextStyle(fontFamily: 'AtkinsonHyperlegibleMono', fontSize: 20, letterSpacing: 2),
          ),
          gap,
          _CodeField(controller: _code, onSubmitted: _go),
          const SizedBox(height: 24),
          BusyButton(label: 'Finish setup', busy: busy, onPressed: _go),
        ],
      ],
    );
  }
}
