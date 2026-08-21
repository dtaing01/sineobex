import 'package:dio/dio.dart';

import '../../core/env/app_config.dart';
import 'auth_interceptor.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  /// 4xx other than 408/429 will never succeed on retry.
  bool get isPermanent {
    final code = statusCode;
    if (code == null) return false;
    if (code == 408 || code == 429) return false;
    return code >= 400 && code < 500;
  }

  @override
  String toString() => 'ApiException($statusCode): $message';
}

/// Talks to API Gateway. All PHI travels over TLS 1.2+ with a Cognito
/// bearer token; nothing identifying ever goes in a URL path or query string,
/// because those land in access logs.
class ApiClient {
  ApiClient({Dio? dio, TokenProvider? tokenProvider})
    : _dio = dio ?? _build(tokenProvider);

  final Dio _dio;

  bool get isConfigured => AppConfig.hasBackend;

  static Dio _build(TokenProvider? tokenProvider) {
    final dio = Dio(
      BaseOptions(
        baseUrl: AppConfig.apiBaseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 30),
        sendTimeout: const Duration(seconds: 30),
        headers: {'content-type': 'application/json'},
      ),
    );
    if (tokenProvider != null) {
      dio.interceptors.add(AuthInterceptor(tokenProvider));
    }
    return dio;
  }

  Future<void> pushMutation({
    required String entity,
    required String entityId,
    required String op,
    required Map<String, dynamic> payload,
  }) async {
    if (!isConfigured) return;
    try {
      await _dio.post<dynamic>(
        '/sync/mutations',
        data: {
          'entity': entity,
          'entityId': entityId,
          'op': op,
          'payload': payload,
        },
      );
    } on DioException catch (e) {
      throw ApiException(
        e.message ?? 'Request failed',
        statusCode: e.response?.statusCode,
      );
    }
  }

  Future<Map<String, dynamic>?> fetchReferenceData() async {
    if (!isConfigured) return null;
    try {
      final res = await _dio.get<Map<String, dynamic>>('/reference');
      return res.data;
    } on DioException catch (e) {
      throw ApiException(
        e.message ?? 'Request failed',
        statusCode: e.response?.statusCode,
      );
    }
  }

  Future<Map<String, dynamic>?> fetchInsights() async {
    if (!isConfigured) return null;
    try {
      final res = await _dio.get<Map<String, dynamic>>('/insights');
      return res.data;
    } on DioException catch (e) {
      throw ApiException(
        e.message ?? 'Request failed',
        statusCode: e.response?.statusCode,
      );
    }
  }

  /// Ships queued audit rows. Kept separate from the mutation queue so that
  /// an audit backlog can never block clinical writes, nor the reverse.
  Future<void> pushAudit(List<Map<String, dynamic>> entries) async {
    if (!isConfigured || entries.isEmpty) return;
    try {
      await _dio.post<dynamic>('/audit', data: {'entries': entries});
    } on DioException catch (e) {
      throw ApiException(
        e.message ?? 'Request failed',
        statusCode: e.response?.statusCode,
      );
    }
  }
}
