import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "SineobexDevice") {
      DeviceChannel.register(with: registrar.messenger())
    }
  }
}

/// The app's own native calls (lib/sync/device_channel.dart).
enum DeviceChannel {
  static func register(with messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(name: "org.sineobex.field/device", binaryMessenger: messenger)
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "bootClock":
        result(bootClock())
      case "excludeFromBackup":
        guard let args = call.arguments as? [String: Any], let path = args["path"] as? String else {
          result(FlutterError(code: "bad_args", message: "path required", details: nil))
          return
        }
        do {
          var url = URL(fileURLWithPath: path, isDirectory: true)
          // Setting a resource value on a folder that doesn't exist yet fails.
          try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
          var values = URLResourceValues()
          values.isExcludedFromBackup = true
          try url.setResourceValues(values)
          result(nil)
        } catch {
          result(FlutterError(code: "exclude_failed", message: "could not exclude from backup", details: nil))
        }
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  /// The clock check (lib/sync/clock.dart) needs time since boot that keeps counting while the
  /// phone sleeps (CLOCK_MONOTONIC on Darwin does; CLOCK_UPTIME_RAW and mach_absolute_time don't),
  /// and a way to tell that the phone restarted (the boot session UUID).
  private static func bootClock() -> [String: Any] {
    let elapsedMs = Int64(clock_gettime_nsec_np(CLOCK_MONOTONIC) / 1_000_000)
    return ["bootId": bootSessionId(), "elapsedMs": elapsedMs]
  }

  private static let processId = "ios-process-\(UUID().uuidString)"

  private static func bootSessionId() -> String {
    var size = 0
    guard sysctlbyname("kern.bootsessionuuid", nil, &size, nil, 0) == 0, size > 0 else { return processId }
    var buffer = [CChar](repeating: 0, count: size)
    guard sysctlbyname("kern.bootsessionuuid", &buffer, &size, nil, 0) == 0 else { return processId }
    return "ios-boot-" + String(cString: buffer)
  }
}
