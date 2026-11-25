import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'dart:ui';
import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;

/// DevPulse Flutter SDK — Native iOS/Android crash, OOM, ANR, network, and flag telemetry.
class DevPulseFlutter with WidgetsBindingObserver {
  DevPulseFlutter._({
    required this.apiKey,
    this.endpoint = 'https://devpulse.ritualdev.in',
    this.release,
    this.appBuild,
    this.deviceModel,
  });

  final String apiKey;
  final String endpoint;
  final String? release;
  final String? appBuild;
  final String? deviceModel;

  static DevPulseFlutter? _instance;
  final List<Map<String, dynamic>> _breadcrumbs = [];

  static DevPulseFlutter init({
    required String apiKey,
    String endpoint = 'https://devpulse.ritualdev.in',
    String? release,
    String? appBuild,
    String? deviceModel,
  }) {
    final client = DevPulseFlutter._(
      apiKey: apiKey,
      endpoint: endpoint.replaceAll(RegExp(r'/$'), ''),
      release: release,
      appBuild: appBuild,
      deviceModel: deviceModel,
    );
    _instance = client;
    client._installHandlers();
    return client;
  }

  static DevPulseFlutter? get instance => _instance;

  void _installHandlers() {
    WidgetsFlutterBinding.ensureInitialized();
    WidgetsBinding.instance.addObserver(this);

    final prevOnError = FlutterError.onError;
    FlutterError.onError = (FlutterErrorDetails details) {
      unawaited(captureCrash(
        errorName: details.exception.runtimeType.toString(),
        message: details.exceptionAsString(),
        stackTrace: details.stack?.toString(),
        category: 'exception',
      ));
      prevOnError?.call(details);
    };

    PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
      unawaited(captureCrash(
        errorName: error.runtimeType.toString(),
        message: error.toString(),
        stackTrace: stack.toString(),
        category: 'exception',
      ));
      return false;
    };
  }

  @override
  void didHaveMemoryPressure() {
    addBreadcrumb('system.memory', 'Low memory warning received from OS (OOM risk)');
    unawaited(captureCrash(
      errorName: 'MemoryPressureOOMWarning',
      message: 'OS memory pressure callback triggered on ${Platform.operatingSystem}',
      category: 'oom',
    ));
  }

  void addBreadcrumb(String category, String message) {
    _breadcrumbs.add({
      'timestamp': DateTime.now().toUtc().toIso8601String(),
      'category': category,
      'message': message,
    });
    if (_breadcrumbs.length > 40) _breadcrumbs.removeAt(0);
  }

  Future<void> captureNetworkError({
    required String url,
    required int? statusCode,
    required String errorMessage,
  }) async {
    await captureCrash(
      errorName: 'MobileNetworkError(${statusCode ?? "timeout"})',
      message: '$url -> $errorMessage',
      category: 'network',
      routePath: Uri.tryParse(url)?.path,
    );
  }

  Future<void> reportAnr(int blockedMs) async {
    await captureCrash(
      errorName: 'FlutterIsolateANR',
      message: 'UI isolate stalled for ${blockedMs}ms',
      category: 'anr',
    );
  }

  Future<bool> flag(String key, {String userId = 'anonymous'}) async {
    try {
      final res = await http.get(
        Uri.parse('$endpoint/api/v1/flags/evaluate?apiKey=$apiKey&key=$key&userId=$userId'),
      );
      if (res.statusCode != 200) return false;
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final flags = body['flags'] as Map<String, dynamic>?;
      return flags?[key] == true;
    } catch (_) {
      return false;
    }
  }

  Future<void> captureCrash({
    required String errorName,
    required String message,
    String? stackTrace,
    String category = 'exception',
    String? routePath,
  }) async {
    final platformName = Platform.isIOS ? 'ios' : (Platform.isAndroid ? 'android' : 'flutter');
    try {
      await http.post(
        Uri.parse('$endpoint/api/v1/event'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'apiKey': apiKey,
          'errorName': errorName,
          'message': message,
          'stackTrace': stackTrace ?? '',
          'runtime': 'flutter',
          'platform': platformName,
          'errorCategory': category,
          'deviceModel': deviceModel,
          'appBuild': appBuild ?? release,
          'version': release,
          'os': '${Platform.operatingSystem} ${Platform.operatingSystemVersion}',
          'routePath': routePath,
          'breadcrumbs': _breadcrumbs,
        }),
      );
    } catch (_) {
      // Never crash app during telemetry delivery
    }
  }
}
