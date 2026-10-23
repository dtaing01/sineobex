import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/auth/session_controller.dart';

import '../auth/fakes.dart';
import '../helpers/app_harness.dart';

void main() {
  Future<AppHarness> signInToHome(WidgetTester tester, {int teams = 1}) async {
    usePhoneSize(tester);
    final h = AppHarness(teams: teams);
    await tester.pumpWidget(h.build());
    await tester.pumpAndSettle();
    await enter(tester, 'Email', 'clinician@example.com');
    await enter(tester, 'Password', validPassword);
    await tapText(tester, 'Continue');
    await enter(tester, '6-digit code', validCode);
    await tapText(tester, 'Sign in');
    await enter(tester, 'New PIN', '482913');
    await enter(tester, 'Type it again', '482913');
    await tapText(tester, 'Save PIN');
    return h;
  }

  testWidgets('sign in, enter the code, choose a PIN, reach Home; every screen meets the guidelines', (tester) async {
    final handle = tester.ensureSemantics();
    usePhoneSize(tester);
    final h = AppHarness();
    await tester.pumpWidget(h.build());
    await tester.pumpAndSettle();

    expect(find.text('Sign in'), findsWidgets);
    await expectGuidelines(tester);
    await tapText(tester, 'Continue');
    expect(find.text('Enter your email and password.'), findsOneWidget);

    await enter(tester, 'Email', 'clinician@example.com');
    await enter(tester, 'Password', 'wrong');
    await tapText(tester, 'Continue');
    expect(find.text('That email and password don’t match.'), findsOneWidget);
    await expectGuidelines(tester);

    await enter(tester, 'Password', validPassword);
    await tapText(tester, 'Continue');
    expect(find.text('Enter your code'), findsOneWidget);
    await expectGuidelines(tester);

    await enter(tester, '6-digit code', validCode);
    await tapText(tester, 'Sign in');
    expect(find.text('Choose a PIN'), findsOneWidget);
    await expectGuidelines(tester);

    await enter(tester, 'New PIN', '123456');
    await enter(tester, 'Type it again', '123456');
    await tapText(tester, 'Save PIN');
    expect(find.text('Don’t use a sequence like 123456.'), findsOneWidget);

    await enter(tester, 'New PIN', '482913');
    await enter(tester, 'Type it again', '482913');
    await tapText(tester, 'Save PIN');
    expect(find.text('Hello, Jordan'), findsOneWidget);
    expect(h.session.state, isA<Unlocked>());
    await expectGuidelines(tester);
    handle.dispose();
  });

  testWidgets('Lock now, then unlock with the PIN; warnings near the wipe limit', (tester) async {
    final handle = tester.ensureSemantics();
    await signInToHome(tester);
    await tapText(tester, 'Lock now');
    expect(find.text('Welcome back, Jordan'), findsOneWidget);
    await expectGuidelines(tester);

    for (var i = 0; i < 7; i++) {
      await enter(tester, 'PIN', '000001');
      await tapText(tester, 'Unlock');
    }
    expect(find.textContaining('3 tries left before the data on this phone is erased'), findsOneWidget);

    await enter(tester, 'PIN', '482913');
    await tapText(tester, 'Unlock');
    expect(find.text('Hello, Jordan'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('locks itself after the idle time with no touches', (tester) async {
    final h = await signInToHome(tester);
    await tester.pump(const Duration(minutes: 4));
    await tester.tap(find.text('Hello, Jordan'));
    await tester.pump(const Duration(minutes: 4));
    expect(h.session.state, isA<Unlocked>(), reason: 'the touch restarted the timer');
    await tester.pump(const Duration(minutes: 2));
    await tester.pumpAndSettle();
    expect(h.session.state, isA<Locked>());
    expect(find.text('Welcome back, Jordan'), findsOneWidget);
  });

  testWidgets('covers the screen when the app leaves the foreground', (tester) async {
    await signInToHome(tester);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(find.byIcon(Icons.lock_outline), findsOneWidget);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(find.byIcon(Icons.lock_outline), findsNothing);
  });

  testWidgets('people on several teams choose one first', (tester) async {
    await signInToHome(tester, teams: 2);
    expect(find.text('Choose a team'), findsOneWidget);
    await expectGuidelines(tester);
    await tapText(tester, 'Demo Team 1 · Healthcare Staff');
    expect(find.text('Demo Team 1 · Healthcare Staff'), findsOneWidget);
    expect(find.text('Switch team'), findsOneWidget);
  });
}
