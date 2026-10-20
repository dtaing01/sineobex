import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/app.dart';
import 'package:sineobex_field/config/env.dart';
import 'package:sineobex_field/design/widgets/demo_banner.dart';

Widget _app(DeploymentKind kind) => ProviderScope(
  overrides: [
    appConfigProvider.overrideWithValue(AppConfig(apiBaseUrl: Uri.parse('https://api.invalid'), deployment: kind)),
  ],
  child: const SineobexApp(),
);

void main() {
  testWidgets('demo builds show the Demo data only banner', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(_app(DeploymentKind.preview));
    await tester.pumpAndSettle();
    expect(find.text(DemoBanner.message), findsOneWidget);
    expect(find.bySemanticsLabel(DemoBanner.message), findsOneWidget);
    handle.dispose();
  });

  testWidgets('pilot builds do not', (tester) async {
    await tester.pumpWidget(_app(DeploymentKind.pilot));
    await tester.pumpAndSettle();
    expect(find.text(DemoBanner.message), findsNothing);
  });

  testWidgets('the home screen meets tap-target and text-contrast guidelines', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(_app(DeploymentKind.preview));
    await tester.pumpAndSettle();
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
    handle.dispose();
  });
}
