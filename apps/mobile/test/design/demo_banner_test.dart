import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/config/env.dart';
import 'package:sineobex_field/design/widgets/demo_banner.dart';

import '../helpers/app_harness.dart';

void main() {
  testWidgets('demo builds show the Demo data only banner, and screen readers announce it', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(AppHarness().build());
    await tester.pumpAndSettle();
    expect(find.text(DemoBanner.message), findsOneWidget);
    expect(find.bySemanticsLabel(DemoBanner.message), findsOneWidget);
    handle.dispose();
  });

  testWidgets('pilot builds do not', (tester) async {
    await tester.pumpWidget(AppHarness(deployment: DeploymentKind.pilot).build());
    await tester.pumpAndSettle();
    expect(find.text(DemoBanner.message), findsNothing);
  });
}
