import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/patients/generated/sensitive_codes.dart';

import '../sync/fake_server.dart';

/// What each credential may do, as the phone knows it (lifecycle 3.5, 6.2): a copy of the server's
/// table, which no vector carries, so this reads the server's own source and fails when they part.
void main() {
  test('each credential may do on the phone what it may do on the server', () {
    final source = File('../../services/api/src/auth/permissions.ts').readAsStringSync();
    final block = RegExp(r'export const CAPABILITIES[^=]*= \{([\s\S]*?)\n\};').firstMatch(source)!.group(1)!;
    final entries = RegExp(r'(\w+): \{([^}]*)\}').allMatches(block);
    final server = {
      for (final e in entries)
        e.group(1)!: {
          for (final f in RegExp(r'(\w+): (true|false)').allMatches(e.group(2)!)) f.group(1)!: f.group(2) == 'true',
        },
    };
    expect(server.keys, unorderedEquals(['attending', 'resident', 'np', 'pa', 'student', 'chw', 'none']));
    final phone = {
      for (final MapEntry(:key, value: c) in credentialCapabilities.entries)
        key: {
          'chartMedical': c.chartMedical,
          'orderMedications': c.orderMedications,
          'sign': c.sign,
          'attest': c.attest,
          'billingNeedsAttestation': c.billingNeedsAttestation,
        },
    };
    expect(phone, server);
    // The phone's test server agrees too, where it has the column.
    for (final MapEntry(:key, value: c) in FakeSyncServer.capabilities.entries) {
      expect(
        [c.chartMedical, c.orderMedications, c.sign, c.billingNeedsAttestation],
        [
          phone[key]!['chartMedical'],
          phone[key]!['orderMedications'],
          phone[key]!['sign'],
          phone[key]!['billingNeedsAttestation'],
        ],
        reason: key,
      );
    }
  });

  test('a credential the app does not know may do nothing', () {
    expect(capabilitiesOf('nurse'), credentialCapabilities['none']);
  });

  test('a credential in words, as the portal words it; one the app does not know has none', () {
    final labels = File('../portal/src/lib/labels.ts').readAsStringSync();
    for (final (code, words) in [
      ('attending', 'Attending physician'),
      ('resident', 'Resident'),
      ('np', 'Nurse practitioner'),
      ('pa', 'Physician assistant'),
      ('student', 'Student or volunteer'),
      ('chw', 'Community health worker'),
      ('none', 'No clinical credential'),
    ]) {
      expect(credentialText(code), words);
      expect(labels, contains("$code: '$words'"), reason: code);
    }
    expect(credentialText('demo_new_credential'), isNull);
  });

  test('the person carries the name their saved profile shows', () {
    final user = EncounterUser(
      userId: 'u',
      displayName: 'Demo Alex Rivera',
      credential: 'resident',
      permissions: const ['encounters.chart'],
    );
    expect(user.displayName, 'Demo Alex Rivera');
  });

  test('the reader visibleAnswers is given is the person’s keys and credential now', () {
    final user = EncounterUser(
      userId: 'u',
      displayName: 'Demo Charter',
      credential: 'student',
      permissions: const ['patients.view', 'encounters.chart', 'patients.view_sensitive'],
    );
    final r = user.reader(actsAsAuthor: false);
    expect(
      [r.actsAsAuthor, r.viewSensitive, r.viewSensitiveExams, r.readsMedical, r.chartsMedical, r.ordersMedications],
      [false, true, false, true, true, false],
    );
    expect(r.sensitiveCodes, sensitiveCodeRanges);
    expect(user.reader(actsAsAuthor: true).actsAsAuthor, isTrue);
    // Billing/Data reads Medical notes; the community health worker preset reads none and charts none.
    expect(
      EncounterUser(
        userId: 'u',
        displayName: 'Demo Charter',
        credential: 'none',
        permissions: const ['patients.view', 'billing.view_codes'],
      ).readsMedical,
      isTrue,
    );
    final chw = EncounterUser(
      userId: 'u',
      displayName: 'Demo Charter',
      credential: 'chw',
      permissions: FakeSyncServer.chw,
    );
    expect([chw.readsMedical, chw.charts, chw.can.chartMedical], [false, false, false]);
  });
}
