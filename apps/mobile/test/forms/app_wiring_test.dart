import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sineobex_field/app_providers.dart';
import 'package:sineobex_field/security/secure_store.dart';

import '../auth/fakes.dart' show demoUser;
import '../features/patients/patient_kit.dart' show signIn;

/// The definition store as the app and the app harness wire it (phase 4 forms 3.4): the sync
/// controller holds it, its files live inside the databases' folder, and the harness's screens
/// still sign in with the sign-in's fetch running.
void main() {
  test('the app’s sync controller holds the definition store', () {
    final container = ProviderContainer(
      overrides: [
        deviceStoreProvider.overrideWithValue(MemorySecureStore()),
        biometricStoreProvider.overrideWithValue(MemorySecureStore()),
      ],
    );
    addTearDown(container.dispose);
    expect(container.read(syncControllerProvider).definitions, isNotNull);
  });

  test('its folder is inside the databases’ folder, which backups leave out, and is asked for once', () async {
    final dir = Directory.systemTemp.createTempSync('wiring');
    addTearDown(() => dir.deleteSync(recursive: true));
    var asked = 0;
    var fail = true;
    final store = appDefinitionStore(
      databases: () async {
        asked++;
        if (fail) throw StateError('Demo: no folder yet');
        return dir.path;
      },
    );
    await expectLater(store.directory(), throwsStateError);
    fail = false;
    expect(await store.directory(), p.join(dir.path, 'forms'), reason: 'a failure is asked again');
    expect(await store.directory(), p.join(dir.path, 'forms'));
    expect(asked, 2);
  });

  testWidgets('a sign-in through the harness’s screens fetches every team’s list and still settles', (tester) async {
    final h = await signIn(tester);
    await tester.pumpAndSettle();
    expect(h.forms.listRequests, greaterThan(0));
    final team = await tester.runAsync(() => h.sync.definitions!.team(demoUser().userId, demoUser().teams.first.id));
    expect(team, isNotNull, reason: 'the list the fake serves, the bundled presets, was kept');
  });
}
