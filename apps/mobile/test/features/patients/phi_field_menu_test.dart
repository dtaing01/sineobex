import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/design/theme.dart';
import 'package:sineobex_field/design/tokens.dart';
import 'package:sineobex_field/design/widgets/birth_field.dart';
import 'package:sineobex_field/features/patients/patient_widgets.dart' show PhiField;
import 'package:sineobex_field/sync/device_channel.dart';

/// A private box's selection menu offers only cut, copy, paste and select all, on both platforms:
/// nothing that sends the chart's text out of the app (lifecycle 10.2; the coordinator's decision on
/// review finding PP-3). Every box of a chart or a note is a PhiField, a note's text boxes included,
/// and the birth date box shares its menu (C-2). Its Copy and Cut, from the menu and from a
/// hardware keyboard's shortcuts, go through secureCopy and never the general pasteboard (C-4); a
/// soft keyboard's own Copy is outside it and no test here drives it (plan risk 10).
void main() {
  /// What reached the app's native secure copy, and what reached the platform's plain clipboard.
  late List<String> secure;
  late List<Object?> plain;
  late bool nativeCopies;

  setUp(() {
    secure = [];
    plain = [];
    nativeCopies = true;
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(deviceChannel, (call) async {
      if (call.method != 'secureCopy') return null;
      if (!nativeCopies) throw PlatformException(code: 'refused');
      secure.add((call.arguments as Map<Object?, Object?>)['text']! as String);
      return true;
    });
    messenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') plain.add(call.arguments);
      return null;
    });
  });

  tearDown(() {
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger
      ..setMockMethodCallHandler(deviceChannel, null)
      ..setMockMethodCallHandler(SystemChannels.platform, null);
  });

  /// [box] drawn on its own, focused, with [length] characters selected from the start.
  Future<EditableTextState> selected(WidgetTester tester, Widget box, int length) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildFieldTheme(FieldTheme.day),
        home: Scaffold(body: Center(child: box)),
      ),
    );
    final editable = find.byType(EditableText);
    await tester.showKeyboard(editable);
    final state = tester.state<EditableTextState>(editable);
    state.userUpdateTextEditingValue(
      state.textEditingValue.copyWith(selection: TextSelection(baseOffset: 0, extentOffset: length)),
      SelectionChangedCause.longPress,
    );
    await tester.pump();
    return state;
  }

  Future<void> expectPrivateMenu(WidgetTester tester, EditableTextState state) async {
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
  }

  Future<void> tapInMenu(WidgetTester tester, EditableTextState state, String label) async {
    state.showToolbar();
    await tester.pumpAndSettle();
    await tester.tap(find.text(label));
    await tester.pumpAndSettle();
  }

  const platforms = TargetPlatformVariant({TargetPlatform.android, TargetPlatform.iOS});

  Widget phi(TextEditingController controller, {ValueChanged<String>? onChanged}) =>
      PhiField(name: 'concern', label: 'Chief concern', controller: controller, onChanged: onChanged);

  testWidgets('the selection menu of a private box', (tester) async {
    final controller = TextEditingController(text: 'Demo: cough for a week');
    addTearDown(controller.dispose);
    await expectPrivateMenu(tester, await selected(tester, phi(controller), 22));
    await tester.pumpWidget(const SizedBox());
  }, variant: platforms);

  testWidgets('the selection menu of the birth date box (C-2)', (tester) async {
    final state = await selected(tester, BirthField(today: DateTime(2026, 11, 21), onChanged: (_) {}), 0);
    state.userUpdateTextEditingValue(
      const TextEditingValue(text: '3/7/1946', selection: TextSelection(baseOffset: 0, extentOffset: 8)),
      SelectionChangedCause.longPress,
    );
    await tester.pump();
    await expectPrivateMenu(tester, state);
    await tapInMenu(tester, state, 'Copy');
    expect(secure, ['3/7/1946']);
    expect(plain, isEmpty);
    await tester.pumpWidget(const SizedBox());
  }, variant: platforms);

  testWidgets('Copy goes through the secure copy, never the plain clipboard, and says so', (tester) async {
    final controller = TextEditingController(text: 'Demo: cough for a week');
    addTearDown(controller.dispose);
    final state = await selected(tester, phi(controller), 11);
    await tapInMenu(tester, state, 'Copy');
    expect(secure, ['Demo: cough']);
    expect(plain, isEmpty);
    expect(controller.text, 'Demo: cough for a week');
    expect(find.text('Copied. It clears in 60 seconds.'), findsOneWidget);
    final said = tester.getSemantics(find.text('Copied. It clears in 60 seconds.'));
    expect(said.flagsCollection.isLiveRegion, isTrue);
    await tester.pumpWidget(const SizedBox());
  }, variant: platforms);

  testWidgets('Cut takes the text out once it was copied, as a typed change does', (tester) async {
    final controller = TextEditingController(text: 'Demo: cough for a week');
    addTearDown(controller.dispose);
    final changes = <String>[];
    final state = await selected(tester, phi(controller, onChanged: changes.add), 12);
    await tapInMenu(tester, state, 'Cut');
    expect(secure, ['Demo: cough ']);
    expect(plain, isEmpty);
    expect(controller.text, 'for a week');
    expect(changes, ['for a week']);
    await tester.pumpWidget(const SizedBox());
  }, variant: platforms);

  testWidgets('when the phone won’t copy privately, nothing is copied, Cut keeps the text, and it says so', (
    tester,
  ) async {
    nativeCopies = false;
    final controller = TextEditingController(text: 'Demo: cough for a week');
    addTearDown(controller.dispose);
    final state = await selected(tester, phi(controller), 11);
    await tapInMenu(tester, state, 'Cut');
    expect(secure, isEmpty);
    expect(plain, isEmpty);
    expect(controller.text, 'Demo: cough for a week');
    expect(find.text('Nothing was copied: this phone couldn’t copy it privately.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  }, variant: platforms);

  testWidgets('the keyboard’s copy and cut go through the secure copy too', (tester) async {
    final controller = TextEditingController(text: 'Demo: cough for a week');
    addTearDown(controller.dispose);
    await selected(tester, phi(controller), 11);
    final modifier = defaultTargetPlatform == TargetPlatform.iOS ? LogicalKeyboardKey.meta : LogicalKeyboardKey.control;
    Future<void> chord(LogicalKeyboardKey key) async {
      await tester.sendKeyDownEvent(modifier);
      await tester.sendKeyEvent(key);
      await tester.sendKeyUpEvent(modifier);
      await tester.pumpAndSettle();
    }

    await chord(LogicalKeyboardKey.keyC);
    expect(secure, ['Demo: cough']);
    expect(controller.text, 'Demo: cough for a week');
    await chord(LogicalKeyboardKey.keyX);
    expect(secure, ['Demo: cough', 'Demo: cough']);
    expect(controller.text, ' for a week');
    expect(plain, isEmpty);
    // A second copy is said again: a new live region, not the same one.
    expect(find.byKey(const ValueKey('private.copied.2')), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  }, variant: platforms);
}
