import 'dart:async';
import 'dart:convert';
import 'dart:io' show SocketException;

import 'package:http/http.dart' as http;

/// The one way the generated client reaches the network. Tests swap in a fake.
abstract interface class ApiTransport {
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body});
}

/// The server answered with an error. [code] is stable; [message] is safe to show to staff.
class ApiException implements Exception {
  const ApiException(this.status, this.code, this.message, {this.details});

  final int status;
  final String code;
  final String message;
  final Map<String, Object?>? details;

  bool get isAuth => status == 401;
  bool get isForbidden => status == 403;

  @override
  String toString() => 'ApiException($status, $code)';
}

/// No answer: offline, timed out, or the connection dropped. The request may or may not have
/// reached the server, so only idempotent requests (every sync batch is) may be retried.
class NetworkException implements Exception {
  const NetworkException(this.reason);
  final String reason;
  @override
  String toString() => 'NetworkException($reason)';
}

typedef HeaderSource = FutureOr<String?> Function();

class HttpTransport implements ApiTransport {
  HttpTransport({
    required this.baseUrl,
    required this._client,
    this.accessToken,
    this.teamId,
    this.deviceId,
    this.timeout = defaultTimeout,
  });

  final Uri baseUrl;
  final http.Client _client;
  final HeaderSource? accessToken;
  final HeaderSource? teamId;
  final HeaderSource? deviceId;

  /// How long a request may wait for its answer. Sending a body adds its time on a slow uplink
  /// ([timeoutFor]).
  final Duration timeout;

  static const defaultTimeout = Duration(seconds: 20);

  /// The slowest uplink a request body is given time for, in bytes a second. On a weak uplink
  /// (EDGE, weak 3G) a full sync batch takes longer than [timeout] just to send, and timed like a
  /// small request it would time out on every try. Slower links still get through: the sync
  /// engine sends less at a time after a timeout.
  static const slowUplinkBytesPerSecond = 16 * 1024;

  /// How long a request whose body is [bodyBytes] long may take to be sent and answered.
  static Duration timeoutFor(int bodyBytes, [Duration base = defaultTimeout]) =>
      base + Duration(milliseconds: bodyBytes * 1000 ~/ slowUplinkBytesPerSecond);

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    final base = baseUrl.path.endsWith('/') ? baseUrl.path.substring(0, baseUrl.path.length - 1) : baseUrl.path;
    final uri = baseUrl.replace(path: '$base$path', queryParameters: query == null || query.isEmpty ? null : query);
    final request = http.Request(method, uri);
    request.headers['accept'] = 'application/json';
    final token = await accessToken?.call();
    if (token != null) request.headers['authorization'] = 'Bearer $token';
    final team = await teamId?.call();
    if (team != null) request.headers['x-team-id'] = team;
    final device = await deviceId?.call();
    if (device != null) request.headers['x-device-id'] = device;
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }

    final http.Response response;
    try {
      // Sending covers the upload too, so a large body gets longer. The answer's body is timed
      // too: one that stalls after its headers must not hang its caller.
      final sent = _client.send(request).timeout(timeoutFor(request.bodyBytes.length, timeout));
      response = await http.Response.fromStream(await sent).timeout(timeout);
    } on TimeoutException {
      throw const NetworkException('timeout');
    } on SocketException {
      throw const NetworkException('offline');
    } on http.ClientException {
      throw const NetworkException('connection');
    }

    if (response.statusCode == 204 || response.body.isEmpty) return null;
    final Object? decoded;
    try {
      decoded = jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      throw ApiException(response.statusCode, 'bad_response', 'The server sent something unexpected.');
    }
    if (response.statusCode >= 200 && response.statusCode < 300) return decoded;

    final error = decoded is Map<String, Object?> ? decoded['error'] : null;
    if (error is Map<String, Object?>) {
      throw ApiException(
        response.statusCode,
        error['code'] as String? ?? 'error',
        error['message'] as String? ?? 'Something went wrong.',
        details: error['details'] as Map<String, Object?>?,
      );
    }
    throw ApiException(response.statusCode, 'error', 'Something went wrong.');
  }
}
