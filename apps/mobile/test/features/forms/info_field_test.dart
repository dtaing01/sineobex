import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/info_field.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// Guidance in a form (forms 2.2 `info`, 6.8): words to read, nothing to answer.
void main() {
  final resources = presetField('social_needs', 'needs.resources') as InfoDef;

  forEachRun('guidance is read, and offers nothing to tap', (tester, run) async {
    await pumpField(tester, InfoField(field: resources), run: run);
    expect(find.text('The resource directory is coming.'), findsOneWidget);
    expect(find.bySemanticsLabel('The resource directory is coming.'), findsOneWidget);
    expect(find.semantics.byAction(SemanticsAction.tap), findsNothing);
    await expectFieldOk(tester);
  });

  testWidgets('its help is read after it', (tester) async {
    final handle = tester.ensureSemantics();
    final info = fieldOf({
      'id': 'about',
      'kind': 'info',
      'label': 'Demo: read this first',
      'help': 'Demo: and then this',
    }) as InfoDef;
    await pumpField(tester, InfoField(field: info));
    expect(find.text('Demo: read this first'), findsOneWidget);
    expect(find.text('Demo: and then this'), findsOneWidget);
    await expectFieldOk(tester);
    handle.dispose();
  });
}
