import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

/// Street Medicine ID link tokens (design 10.1, 10.3; D31).
///
/// 16 bytes from a cryptographically secure generator, base64url without padding: 22 characters.
/// Never derived from a patient ID, name or time. The server stores the token and its SHA-256, and
/// looks links up only by the hash; audit events and notices name a token by [idLinkTokenRef]. The
/// URL carries the token in the fragment, which browsers and QR scanners never send to a server.
/// services/api/src/patients/id-links.ts holds the same helpers; both are pinned by
/// packages/contract/test-vectors/id-link-token.json.
const idLinkTokenBytes = 16;

/// The shape the server checks (`IdLinkCreate.token`).
final idLinkTokenPattern = RegExp(r'^[A-Za-z0-9_-]{22}$');

bool isIdLinkToken(String token) => idLinkTokenPattern.hasMatch(token);

/// A new token. [random] is for tests only: anything but [Random.secure] would make tokens guessable.
String newIdLinkToken([Random? random]) {
  final r = random ?? Random.secure();
  return idLinkTokenFromBytes(List<int>.generate(idLinkTokenBytes, (_) => r.nextInt(256)));
}

/// The token that encodes [bytes].
String idLinkTokenFromBytes(List<int> bytes) {
  if (bytes.length != idLinkTokenBytes) throw ArgumentError('an ID link token is $idLinkTokenBytes bytes');
  return base64Url.encode(bytes).replaceAll('=', '');
}

/// SHA-256 of the token's ASCII, lowercase hex: what the server stores as `token_hash`.
String idLinkTokenHash(String token) => sha256.convert(utf8.encode(token)).toString();

/// The first 12 hex characters of the hash: the only form audit entries and notices carry.
String idLinkTokenRef(String token) => idLinkTokenHash(token).substring(0, 12);

/// `{base}/c#<token>`: the portal's public landing page, the token in the fragment. [baseUrl] comes
/// from the server (`/v1/me` `idLinkBaseUrl`, cached), so an offline phone builds exactly the URL
/// the portal shows.
String idLinkUrl(String baseUrl, String token) => '${baseUrl.replaceFirst(RegExp(r'/+$'), '')}/c#$token';
