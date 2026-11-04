package com.sineobex.field

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
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
    private val handler = Handler(Looper.getMainLooper())

    /** A link this app put on the clipboard that hasn't been cleared yet. */
    private var copied = false
    private val clearCopied = Runnable { clearClip() }

    override fun onCreate(savedInstanceState: Bundle?) {
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
    }

    /** A copied ID link doesn't outlive the app being in front (design 10.4). */
    override fun onStop() {
        clearClip()
        super.onStop()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "org.sineobex.field/device")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "bootClock" -> result.success(bootClock())
                    // allowBackup="false" and the data extraction rules already exclude app data.
                    "excludeFromBackup" -> result.success(null)
                    "secureCopy" -> {
                        val text = call.argument<String>("text")
                        val expiresAfterMs = call.argument<Number>("expiresAfterMs")?.toLong() ?: 60_000L
                        if (text == null) {
                            result.error("bad_args", "text required", null)
                        } else {
                            secureCopy(text, expiresAfterMs)
                            result.success(true)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * Puts an ID link on the clipboard marked sensitive, so the system's copy preview doesn't show
     * it (EXTRA_IS_SENSITIVE from Android 13; earlier versions read the same key or ignore it), and
     * clears it after [expiresAfterMs] or when the app goes to the background, whichever comes
     * first. The label names no one.
     */
    private fun secureCopy(text: String, expiresAfterMs: Long) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText("Street Medicine ID link", text)
        val sensitiveKey = if (Build.VERSION.SDK_INT >= 33) {
            ClipDescription.EXTRA_IS_SENSITIVE
        } else {
            "android.content.extra.IS_SENSITIVE"
        }
        clip.description.extras = PersistableBundle().apply { putBoolean(sensitiveKey, true) }
        clipboard.setPrimaryClip(clip)
        copied = true
        handler.removeCallbacks(clearCopied)
        handler.postDelayed(clearCopied, expiresAfterMs)
    }

    private fun clearClip() {
        handler.removeCallbacks(clearCopied)
        if (!copied) return
        copied = false
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        if (Build.VERSION.SDK_INT >= 28) {
            clipboard.clearPrimaryClip()
        } else {
            clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
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
