import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/patients/patient_widgets.dart' show PhiField;

/// A private box's selection menu offers only cut, copy, paste and select all, on both platforms:
/// nothing that sends the chart's text out of the app (lifecycle 10.2; the coordinator's decision on
/// review finding PP-3). Every box of a chart or a note is a PhiField, a note's text boxes included.
void main() {
  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    testWidgets('the selection menu of a private box on ${platform.name}', (tester) async {
      debugDefaultTargetPlatformOverride = platform;
      try {
        final controller = TextEditingController(text: 'Demo: cough for a week');
        addTearDown(controller.dispose);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Center(
                child: PhiField(name: 'concern', label: 'Chief concern', controller: controller),
              ),
            ),
          ),
        );
        final box = find.byType(EditableText);
        await tester.showKeyboard(box);
        final state = tester.state<EditableTextState>(box);
        state.userUpdateTextEditingValue(
          state.textEditingValue.copyWith(selection: const TextSelection(baseOffset: 0, extentOffset: 22)),
          SelectionChangedCause.longPress,
        );
        await tester.pump();
        // What the platform would offer, Share among them.
        final offered = {for (final i in state.contextMenuButtonItems) i.type};
        expect(offered, contains(ContextMenuButtonType.share));
        state.showToolbar();
        await tester.pumpAndSettle();
        expect(find.text('Copy'), findsOneWidget);
        expect(find.text('Cut'), findsOneWidget);
        for (final label in ['Share', 'Share...', 'Search Web', 'Look Up']) {
          expect(find.text(label), findsNothing, reason: label);
        }
        state.hideToolbar();
        await tester.pumpWidget(const SizedBox());
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    });
  }
}
