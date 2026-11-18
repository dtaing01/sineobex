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

  test('the reader visibleAnswers is given is the person’s keys and credential now', () {
    final user = EncounterUser(
      userId: 'u',
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
        credential: 'none',
        permissions: const ['patients.view', 'billing.view_codes'],
      ).readsMedical,
      isTrue,
    );
    final chw = EncounterUser(userId: 'u', credential: 'chw', permissions: FakeSyncServer.chw);
    expect([chw.readsMedical, chw.charts, chw.can.chartMedical], [false, false, false]);
  });
}
