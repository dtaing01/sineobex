import 'package:dio/dio.dart';

typedef TokenProvider = Future<String?> Function({bool forceRefresh});

/// Attaches the Cognito access token and retries once on a 401, so an expired
/// token mid-shift is invisible to the user.
class AuthInterceptor extends Interceptor {
  AuthInterceptor(this._tokenProvider);

  final TokenProvider _tokenProvider;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await _tokenProvider(forceRefresh: false);
    if (token != null) {
      options.headers['authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final alreadyRetried = err.requestOptions.extra['retried'] == true;
    if (err.response?.statusCode != 401 || alreadyRetried) {
      return handler.next(err);
    }

    final token = await _tokenProvider(forceRefresh: true);
    if (token == null) return handler.next(err);

    final options = err.requestOptions
      ..headers['authorization'] = 'Bearer $token'
      ..extra['retried'] = true;

    try {
      final dio = Dio(BaseOptions(baseUrl: options.baseUrl));
      final response = await dio.fetch<dynamic>(options);
      return handler.resolve(response);
    } on DioException catch (e) {
      return handler.next(e);
    }
  }
}
