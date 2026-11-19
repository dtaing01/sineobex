import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show MissingPluginException, PlatformException;
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:sineobex_field/features/encounters/encounter_screen.dart';
import 'package:sineobex_field/features/encounters/location_field.dart';

import 'encounter_kit.dart';
import 'fake_location.dart';

/// **Remove**, by what a screen reader hears: asked for when used, after the binding is up.
Finder get remove => find.bySemanticsLabel('Remove my location');

/// **Use my location** in New encounter's Where step (lifecycle 9.2, 12.1 #15; card L5-location).
/// The phone is asked nothing before the tap, not even whether it may: the permission is asked for
/// then. The place goes with the visit as the phone gave it, and only then. When the phone refuses
/// or can't say, the button says so plainly, and the place typed works without it. Three themes,
/// 200% text and 320 wide; offline, then synced.
void main() {
  const added = 'Your location is added.';
  const notAllowed = 'You didn’t allow your location. Type the place instead.';
  const blocked =
      'Your phone doesn’t let this app use your location. Allow it in your phone’s settings, or type the place.';
  const serviceOff = 'Location is off on this phone. Turn it on in your phone’s settings, or type the place.';
  const notFound = 'Your phone couldn’t find where you are. Try again, or type the place.';
  const unavailable = 'Your location isn’t available on this phone. Type the place instead.';
  const still = 'Still finding where you are. If you choose now, the visit starts without it.';
  const finding = 'Finding where you are…';
  const findingBeforeStart = 'Finding where you are. If you start the visit now, it starts without it.';
  const demoPlace = {'lat': 10.123456, 'lng': -150.654321, 'accuracyM': 12.5};

  final use = find.widgetWithText(OutlinedButton, 'Use my location');
  const medical = 'Medical: clinical notes, orders, signing';

  /// New encounter from P1's profile: Who is skipped, so Where comes first.
  Future<void> openWhere(WidgetTester tester) async {
    await go(tester, '/patients/$p1Id/encounters/new');
    await expectShown(tester, find.text('Where are you?'));
  }

  Map<String, Object?>? locationOf(AppHarness h) => visits(h).single.fields['location']?.value as Map<String, Object?>?;

  OutlinedButton useButton(WidgetTester tester) => tester.widget<OutlinedButton>(use);

  /// A tap while the phone looks: frames pumped, never settled. The spinner doesn't settle, and
  /// settling would run the clock on until the app locked itself for being left alone.
  Future<void> tapWhileLooking(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder.first);
    await tester.pump();
    await tester.tap(finder.first);
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  for (final run in runs) {
    testWidgets('a tap asks, then adds the place as the phone gave it, read and reflowed (${runName(run)})', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      final phone = FakeLocation.install();
      final h = await signInToChart(tester, run: run);
      await openWhere(tester);
      // Nothing is asked of the phone before the tap: not where it is, not whether it may say.
      expect(phone.calls, isEmpty);
      await reveal(tester, use);
      expect(
        tester.getSemantics(use),
        isSemantics(label: 'Use my location', isButton: true, hasTapAction: true, isEnabled: true, isFocusable: true),
      );
      expect(tester.getSize(use).height, greaterThanOrEqualTo(48));
      await expectScreenOk(tester);

      await tapOn(tester, use);
      expect(phone.calls, ['service', 'check', 'request', 'position']);
      // The phone's best fix, for a limited time.
      expect(phone.asked!.accuracy, LocationAccuracy.high);
      expect(phone.asked!.timeLimit, locationTimeLimit);
      await expectShown(tester, find.text(added));
      expect(tester.getSemantics(find.text(added)), isSemantics(label: added));
      // Never the coordinates: only that there is a place.
      expect(find.textContaining('10.12'), findsNothing);
      await reveal(tester, remove);
      expect(tester.getSemantics(remove), isSemantics(isButton: true, hasTapAction: true, isEnabled: true));
      await expectScreenOk(tester);

      await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
      // The kind step says the place is coming with the visit.
      await expectShown(tester, find.text(added));
      await expectScreenOk(tester);
      await tapOn(tester, find.bySemanticsLabel(medical));
      expect(find.byType(EncounterScreen), findsOneWidget);
      expect(locationOf(h), demoPlace);
      // Asked once, on the tap.
      expect(phone.calls, ['service', 'check', 'request', 'position']);
      handle.dispose();
    });

    testWidgets('each refusal said plainly, the place typed working without it (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final phone = FakeLocation.install();
      final h = await signInToChart(tester, run: run);
      await openWhere(tester);
      await type(tester, 'locationText', 'Demo: by the river steps');

      Future<void> refused(String sentence, {bool settings = false}) async {
        await tapOn(tester, use);
        await expectShown(tester, find.text(sentence));
        expect(find.text(added), findsNothing);
        // The button stays, to try again; the sentence is said as it appears.
        await reveal(tester, use);
        expect(useButton(tester).onPressed, isNotNull);
        expect(tester.getSemantics(find.text(sentence)), isSemantics(isLiveRegion: true));
        expect(find.widgetWithText(OutlinedButton, 'Open phone settings'), settings ? findsOneWidget : findsNothing);
        await expectScreenOk(tester);
      }

      // Asked, and not allowed.
      phone.answer = LocationPermission.denied;
      await refused(notAllowed);
      expect(phone.calls, ['service', 'check', 'request']);

      // Not allowed for good: the phone isn't asked again, and its settings are a tap away.
      phone
        ..calls.clear()
        ..permission = LocationPermission.deniedForever;
      await refused(blocked, settings: true);
      expect(phone.calls, ['service', 'check']);
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open phone settings'));
      expect(phone.calls.last, 'app settings');

      // Location off for the whole phone: its location settings.
      phone
        ..calls.clear()
        ..permission = LocationPermission.whileInUse
        ..serviceOn = false;
      await refused(serviceOff, settings: true);
      expect(phone.calls, ['service']);
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open phone settings'));
      expect(phone.calls.last, 'location settings');

      // No fix in time.
      phone
        ..serviceOn = true
        ..error = TimeoutException('no fix', locationTimeLimit);
      await refused(notFound);

      // No way to ask.
      phone.error = PlatformException(code: 'LOCATION_UPDATE_FAILURE');
      await refused(unavailable);

      // The place typed goes with the visit; no place from the phone.
      await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
      await tapOn(tester, find.bySemanticsLabel(medical));
      final visit = visits(h).single;
      expect(visit.fields['location']?.value, isNull);
      expect(visit.fields['locationText']!.value, 'Demo: by the river steps');
      handle.dispose();
    });
  }

  testWidgets('no tap, no place: the phone is never asked', (tester) async {
    final phone = FakeLocation.install()..permission = LocationPermission.whileInUse;
    final h = await signInToChart(tester);
    await openWhere(tester);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    await tapOn(tester, find.bySemanticsLabel(medical));
    expect(locationOf(h), isNull);
    expect(phone.calls, isEmpty);
  });

  testWidgets('already allowed: the permission is checked, not asked again', (tester) async {
    final phone = FakeLocation.install()..permission = LocationPermission.whileInUse;
    await signInToChart(tester);
    await openWhere(tester);
    await tapOn(tester, use);
    expect(phone.calls, ['service', 'check', 'position']);
    await expectShown(tester, find.text(added));
  });

  testWidgets('Remove: the visit goes without the place, and Use my location is back', (tester) async {
    FakeLocation.install();
    final h = await signInToChart(tester);
    await openWhere(tester);
    await tapOn(tester, use);
    await tapOn(tester, remove);
    expect(find.text(added), findsNothing);
    await reveal(tester, use);
    expect(useButton(tester).onPressed, isNotNull);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    expect(find.text(added), findsNothing);
    await tapOn(tester, find.bySemanticsLabel(medical));
    expect(locationOf(h), isNull);
  });

  testWidgets('while the phone looks the button waits, and a place that comes on the kind step goes with the visit', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final phone = FakeLocation.install()..hold = true;
    final h = await signInToChart(tester);
    await openWhere(tester);
    await tapWhileLooking(tester, use);
    expect(find.text(finding), findsOneWidget);
    expect(tester.getSemantics(find.text(finding)), isSemantics(label: finding, isLiveRegion: true));
    expect(useButton(tester).onPressed, isNull);
    await expectScreenOk(tester);
    // The person can go on: the place typed doesn't wait for the phone.
    await tapWhileLooking(tester, find.widgetWithText(FilledButton, 'Next'));
    expect(find.text(still), findsOneWidget);
    expect(tester.getSemantics(find.text(still)), isSemantics(label: still, isLiveRegion: true));
    await expectScreenOk(tester);
    phone.release();
    await settle(tester);
    expect(find.text(still), findsNothing);
    await expectShown(tester, find.text(added));
    await tapOn(tester, find.bySemanticsLabel(medical));
    expect(locationOf(h), demoPlace);
    handle.dispose();
  });

  testWidgets('a kind chosen while the phone still looks starts the visit without the place', (tester) async {
    final phone = FakeLocation.install()..hold = true;
    final h = await signInToChart(tester);
    await openWhere(tester);
    await tapWhileLooking(tester, use);
    await tapWhileLooking(tester, find.widgetWithText(FilledButton, 'Next'));
    await tapWhileLooking(tester, find.bySemanticsLabel(medical));
    await settle(tester);
    expect(find.byType(EncounterScreen), findsOneWidget);
    // The fix that comes after is dropped: the screen that asked for it is gone.
    phone.release();
    await settle(tester);
    expect(tester.takeException(), isNull);
    expect(locationOf(h), isNull);
  });

  testWidgets('where Where starts the visit, the wait says the visit would start without the place', (tester) async {
    final phone = FakeLocation.install()..hold = true;
    final h = await signInToChart(tester);
    await asCredential(tester, h, 'chw');
    await openWhere(tester);
    await tapWhileLooking(tester, use);
    expect(find.text(finding), findsNothing);
    expect(find.text(findingBeforeStart), findsOneWidget);
    await tapWhileLooking(tester, find.widgetWithText(FilledButton, 'Start the visit'));
    await settle(tester);
    expect(find.byType(EncounterScreen), findsOneWidget);
    phone.release();
    await settle(tester);
    expect(locationOf(h), isNull);
  });

  testWidgets('a rough fix says so; a fix with no accuracy has none', (tester) async {
    final phone = FakeLocation.install()..fix = demoFix(accuracy: 2500);
    final h = await signInToChart(tester);
    await openWhere(tester);
    await tapOn(tester, use);
    await expectShown(tester, find.text('Your phone could tell only roughly where you are.'));
    await tapOn(tester, remove);
    phone.fix = demoFix(accuracy: 0);
    await tapOn(tester, use);
    await expectShown(tester, find.text(added));
    expect(find.text('Your phone could tell only roughly where you are.'), findsNothing);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    await tapOn(tester, find.bySemanticsLabel(medical));
    expect(locationOf(h), {'lat': 10.123456, 'lng': -150.654321});
  });

  testWidgets('focus follows from Use my location to Remove and back, for a screen reader', (tester) async {
    final handle = tester.ensureSemantics();
    FakeLocation.install();
    await signInToChart(tester);
    tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(
      accessibleNavigation: true,
    );
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    await openWhere(tester);
    bool focused(Finder inside) => Focus.of(tester.element(inside)).hasPrimaryFocus;
    final useWords = find.descendant(of: use, matching: find.text('Use my location'));
    final removeWords = find.descendant(of: remove, matching: find.text('Remove'));
    await reveal(tester, use);
    Focus.of(tester.element(useWords)).requestFocus();
    await tester.pump();
    await tapOn(tester, use);
    expect(focused(removeWords), isTrue);
    await tapOn(tester, remove);
    expect(focused(useWords), isTrue);
    handle.dispose();
  });

  testWidgets('offline, then synced: the server holds the place as the phone gave it', (tester) async {
    FakeLocation.install();
    final h = await signInToChart(tester);
    await openWhere(tester);
    await tapOn(tester, use);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    await tapOn(tester, find.bySemanticsLabel('Non-Medical: outreach, supplies, social needs'));
    final visit = visits(h).single;
    expect(h.server.records[visit.id], isNull);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    expect(h.server.records[visit.id]!.fields['location']!.value, demoPlace);
  });

  group('placeOf: a position the server takes, as the phone gave it', () {
    test('lat, lng and accuracy unchanged', () {
      expect(placeOf(demoFix()), demoPlace);
    });
    test('no accuracy when the phone doesn’t know it (0 on Android, negative on iOS)', () {
      expect(placeOf(demoFix(accuracy: 0)), {'lat': 10.123456, 'lng': -150.654321});
      expect(placeOf(demoFix(accuracy: -1)), {'lat': 10.123456, 'lng': -150.654321});
    });
    test('none for 0, 0, out of range, or worse than 100 km', () {
      expect(placeOf(demoFix(lat: 0, lng: 0)), isNull);
      expect(placeOf(demoFix(lat: 91)), isNull);
      expect(placeOf(demoFix(lng: -180.5)), isNull);
      expect(placeOf(demoFix(lat: double.nan)), isNull);
      expect(placeOf(demoFix(accuracy: 100001)), isNull);
      expect(placeOf(demoFix(accuracy: 100000)), isNotNull);
    });
    test('a missing plugin is "not available", never a crash', () async {
      final before = GeolocatorPlatform.instance;
      final phone = FakeLocation()
        ..permission = LocationPermission.whileInUse
        ..error = MissingPluginException();
      GeolocatorPlatform.instance = phone;
      addTearDown(() => GeolocatorPlatform.instance = before);
      final location = PhoneLocation();
      await location.locate();
      expect(location.state, LocationState.unavailable);
      expect(location.location, isNull);
    });
  });
}
