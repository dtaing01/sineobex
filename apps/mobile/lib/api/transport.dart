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
    this.timeout = const Duration(seconds: 20),
  });

  final Uri baseUrl;
  final http.Client _client;
  final HeaderSource? accessToken;
  final HeaderSource? teamId;
  final HeaderSource? deviceId;
  final Duration timeout;

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
      // The body too: an answer that stalls after its headers must not hang its caller.
      response = await http.Response.fromStream(await _client.send(request).timeout(timeout)).timeout(timeout);
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
