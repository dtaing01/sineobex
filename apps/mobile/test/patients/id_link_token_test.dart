import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/patients/id_link_token.dart';

/// The server's id-links.ts reproduces the same vectors: a hash or reference that differed would
/// make an offline-issued card unfindable, and a URL that differed would print a card the portal
/// can't open.
void main() {
  final file = File('../../packages/contract/test-vectors/id-link-token.json');
  final vectors = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
  List<Map<String, Object?>> list(String key) => (vectors[key]! as List<Object?>).cast<Map<String, Object?>>();

  List<int> hexBytes(String hex) => [
    for (var i = 0; i < hex.length; i += 2) int.parse(hex.substring(i, i + 2), radix: 16),
  ];

  test('matches the shared shape', () {
    expect(idLinkTokenPattern.pattern, vectors['pattern']);
    expect(idLinkTokenBytes, vectors['bytes']);
  });

  test('encodes, hashes and references every token as the server does', () {
    for (final v in list('tokens')) {
      final token = v['token']! as String;
      expect(idLinkTokenFromBytes(hexBytes(v['bytesHex']! as String)), token);
      expect(isIdLinkToken(token), isTrue, reason: token);
      expect(idLinkTokenHash(token), v['sha256'], reason: token);
      expect(idLinkTokenRef(token), v['tokenRef'], reason: token);
      expect(idLinkTokenRef(token), hasLength(vectors['tokenRefLength']! as int));
    }
    for (final v in list('shapeOnly')) {
      final token = v['token']! as String;
      expect(isIdLinkToken(token), isTrue, reason: v['note']! as String);
      expect(idLinkTokenHash(token), v['sha256']);
      expect(idLinkTokenRef(token), v['tokenRef']);
    }
  });

  test('refuses what the server refuses', () {
    for (final v in list('invalid')) {
      expect(isIdLinkToken(v['token']! as String), isFalse, reason: v['why']! as String);
    }
  });

  test('builds the card URL with the token in the fragment', () {
    for (final v in list('urls')) {
      expect(idLinkUrl(v['baseUrl']! as String, v['token']! as String), v['url']);
    }
  });

  test('a new token is 22 base64url characters from 16 random bytes', () {
    final seen = <String>{};
    for (var i = 0; i < 200; i++) {
      final token = newIdLinkToken();
      expect(isIdLinkToken(token), isTrue, reason: token);
      final decoded = base64Url.decode('$token==');
      expect(decoded, hasLength(idLinkTokenBytes));
      seen.add(token);
    }
    expect(seen, hasLength(200));
    // The generator is the only source of randomness: the same bytes give the same token.
    expect(newIdLinkToken(Random(7)), newIdLinkToken(Random(7)));
    expect(() => idLinkTokenFromBytes(List<int>.filled(15, 0)), throwsArgumentError);
  });
}
