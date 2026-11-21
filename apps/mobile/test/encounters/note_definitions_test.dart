import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/app_providers.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/forms/definition_store.dart';
import 'package:sineobex_field/forms/forms_api.dart';
import 'package:sineobex_field/security/secure_store.dart';
import 'package:sineobex_field/sync/canonical_json.dart';

import '../forms/forms_fake.dart';
import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';

/// A note's definition, by the note's own key and version (phase 4 design, forms 3.4; lifecycle 4.5):
/// from the phone's files, offline too, and fetched when the phone lacks it and has signal. And the
/// versions the notes on the phone are written on, which the sync controller fetches with the
/// team's list, so a draft on a version the list no longer names still opens offline.
void main() {
  const userId = 'a0000000-0000-4000-8000-00000000000a';
  const teamId = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  late Directory dir;
  late DefinitionStore files;
  late FakeFormsServer forms;

  Version versionOf(Map<String, Object?> definition) => {
    'key': definition['key'],
    'version': definition['version'],
    'hash': valueHash(definition),
    'definition': definition,
  };
  final note = versionOf(testNoteTypes.firstWhere((d) => d['key'] == testNote.key));
  final medical = versionOf(testNoteTypes.firstWhere((d) => d['key'] == testMedical.key));

  setUp(() {
    dir = Directory.systemTemp.createTempSync('note_definitions');
    files = DefinitionStore(directory: () async => dir.path, presets: () async => const []);
    forms = FakeFormsServer()..teams[teamId] = [note, medical];
  });
  tearDown(() => dir.deleteSync(recursive: true));

  NoteDefinitions definitions() => NoteDefinitions.team(
    files,
    userId: userId,
    teamId: teamId,
    api: FormsApi(SineobexApi(forms.transportFor(teamId))),
  );

  Future<void> hold(Version v) => files.keep(
    userId,
    teamId,
    ListedVersion(key: v['key']! as String, version: v['version']! as int, hash: v['hash']! as String),
    v['definition']! as Map<String, Object?>,
    generation: files.generation(userId, teamId),
  );

  test('one the phone holds is read from its files, offline too, and asked of nobody', () async {
    await hold(note);
    forms.offline = true;
    final defs = definitions();
    expect(defs.loaded(testNote.key, testNote.version), isNull, reason: 'nothing is read before it is asked for');
    final def = await defs.load(testNote.key, testNote.version);
    expect([def?.key, def?.version], [testNote.key, testNote.version]);
    expect(defs.loaded(testNote.key, testNote.version), same(def));
    expect(forms.requests, isEmpty);
  });

  test('one the phone lacks is fetched with signal and kept; without, the screen gets none', () async {
    final defs = definitions();
    forms.offline = true;
    expect(await defs.load(testMedical.key, testMedical.version), isNull);
    expect(defs.loaded(testMedical.key, testMedical.version), isNull);
    // Asked again once there is signal: a miss is not remembered.
    forms.offline = false;
    final def = await defs.load(testMedical.key, testMedical.version);
    expect(def?.key, testMedical.key);
    // Asked offline and not answered, then asked and answered.
    expect(forms.versionRequests, [
      '${testMedical.key}/${testMedical.version}',
      '${testMedical.key}/${testMedical.version}',
    ]);
    expect((await files.definition(userId, teamId, testMedical.key, testMedical.version))?.key, testMedical.key);
    // Kept: offline again, a fresh lookup reads it from the files.
    forms.offline = true;
    expect((await definitions().load(testMedical.key, testMedical.version))?.key, testMedical.key);
    expect(forms.versionRequests, hasLength(2));
  });

  test('one the server can’t give, or gives as something else, is none', () async {
    final defs = definitions();
    forms.answers['${testMedical.key}/${testMedical.version}'] = const ApiException(404, 'not_found', 'Not found.');
    expect(await defs.load(testMedical.key, testMedical.version), isNull);
    // An answer whose definition names another version is refused by the files, and kept nowhere.
    forms.answers['${testNote.key}/2'] = {...note, 'version': 2};
    expect(await defs.load(testNote.key, 2), isNull);
    expect(await files.definition(userId, teamId, testNote.key, 2), isNull);
    // With no API (a lookup for tests or a screen with no team), only the files are read.
    await hold(note);
    final local = NoteDefinitions.team(files, userId: userId, teamId: teamId);
    expect((await local.load(testNote.key, testNote.version))?.key, testNote.key);
    expect(await local.load(testMedical.key, testMedical.version), isNull);
  });

  test('loadAll reads each version once', () async {
    await hold(note);
    final defs = definitions();
    await defs.loadAll([testNote, testNote, testMedical]);
    expect(defs.loaded(testNote.key, testNote.version)?.key, testNote.key);
    expect(defs.loaded(testMedical.key, testMedical.version)?.key, testMedical.key);
    expect(forms.versionRequests, ['${testMedical.key}/${testMedical.version}']);
  });

  group('the versions the notes on the phone are written on', () {
    late FakeSyncServer server;
    late TestPhone phone;
    setUp(() {
      server = FakeSyncServer(now: () => DateTime.utc(2026, 10, 20, 15));
      phone = TestPhone(
        userId: userId,
        teamId: teamId,
        transport: () => server.transportFor(userId, teamId),
        wall: DateTime.utc(2026, 10, 20, 15),
      );
    });
    tearDown(() => phone.close());

    test('each key and version once; a note written before versions names none', () async {
      final store = phone.store;
      expect(heldNoteTypes(store), isEmpty);
      final visit = store.createEncounter(kind: 'medical');
      for (final t in [testNote, testNote, testMedical]) {
        store.createNote(encounterId: visit, noteTypeKey: t.key, noteTypeVersion: t.version);
      }
      store.createNote(encounterId: visit, noteTypeKey: 'vitals');
      expect(heldNoteTypes(store), unorderedEquals([testNote, testMedical]));

      // A teammate's note opened from the server counts as one made here does.
      server.noteTypes[(testRedFlags.key, testRedFlags.version)] = redFlagsNoteType;
      final other = server.seed('encounter', {
        'kind': 'medical',
        'patientId': server.seedPatient(),
      }, by: 'b0000000-0000-4000-8000-00000000000b');
      final theirs = server.seed('encounter_note', {
        'encounterId': other,
        'noteTypeKey': testRedFlags.key,
        'noteTypeVersion': testRedFlags.version,
      }, by: 'b0000000-0000-4000-8000-00000000000b');
      expect(await phone.engine.openServerRecord('encounter_note', theirs), isTrue);
      expect(heldNoteTypes(store), unorderedEquals([testNote, testMedical, testRedFlags]));
    });
  });

  test('the app’s sync controller is given them', () {
    final container = ProviderContainer(
      overrides: [
        deviceStoreProvider.overrideWithValue(MemorySecureStore()),
        biometricStoreProvider.overrideWithValue(MemorySecureStore()),
      ],
    );
    addTearDown(container.dispose);
    expect(container.read(syncControllerProvider).heldNoteTypes, heldNoteTypes);
  });
}
