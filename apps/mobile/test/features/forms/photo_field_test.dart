import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/photo_field.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A photo field before phase 8 (forms 6.8): it says photos arrive in a later release, and offers
/// nothing to tap.
void main() {
  final photos = presetField('wound_care', 'wound.treatment.photos') as PhotoDef;

  forEachRun('says photos arrive later, and offers nothing to tap', (tester, run) async {
    await pumpField(tester, PhotoField(field: photos), run: run);
    expect(find.text('Photos arrive in a later release.'), findsOneWidget);
    // Said with the field's label: a screen reader landing on it knows which photos.
    expect(find.bySemanticsLabel('Wound photos. Photos arrive in a later release.'), findsOneWidget);
    expect(find.semantics.byAction(SemanticsAction.tap), findsNothing);
    expect(find.byType(TextField), findsNothing);
    await expectFieldOk(tester);
  });
}
