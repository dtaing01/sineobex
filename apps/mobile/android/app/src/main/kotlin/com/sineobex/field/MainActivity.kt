package com.sineobex.field

import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.view.WindowManager
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.UUID

/**
 * FLAG_SECURE blocks screenshots and screen recording, and blanks the app in the recent-apps
 * switcher, so a chart on screen can't end up in the photo roll or a screen share (module 9).
 * FlutterFragmentActivity is needed for biometric prompts (local_auth).
 */
class MainActivity : FlutterFragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "org.sineobex.field/device")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "bootClock" -> result.success(bootClock())
                    // allowBackup="false" and the data extraction rules already exclude app data.
                    "excludeFromBackup" -> result.success(null)
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * The clock check (lib/sync/clock.dart) needs time since boot that keeps counting while the
     * phone sleeps (elapsedRealtime, unlike uptimeMillis), and a way to tell that the phone
     * restarted (the boot count). Without a boot count the ID is unique to this process, so a
     * reference never outlives the app and times are treated as unverified rather than wrong.
     */
    private fun bootClock(): Map<String, Any> {
        val bootCount = try {
            Settings.Global.getInt(contentResolver, Settings.Global.BOOT_COUNT)
        } catch (e: Settings.SettingNotFoundException) {
            -1
        }
        val bootId = if (bootCount >= 0) "android-boot-$bootCount" else processBootId
        return mapOf("bootId" to bootId, "elapsedMs" to SystemClock.elapsedRealtime())
    }

    private companion object {
        val processBootId = "android-process-${UUID.randomUUID()}"
    }
}
