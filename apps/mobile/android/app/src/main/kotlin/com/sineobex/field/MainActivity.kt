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
    /** Forgets a copied link once something else is put on the clipboard (only called in front). */
    private val clipChanged = ClipboardManager.OnPrimaryClipChangedListener { forgetIfReplaced(applicationContext) }

    override fun onCreate(savedInstanceState: Bundle?) {
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
        clipboardOf(applicationContext).addPrimaryClipChangedListener(clipChanged)
    }

    override fun onDestroy() {
        // The clear after 60 seconds stays scheduled: it belongs to the process, not this screen.
        clipboardOf(applicationContext).removePrimaryClipChangedListener(clipChanged)
        super.onDestroy()
    }

    /**
     * Back in front: a link whose 60 seconds ran out while another app was in front is cleared now,
     * if it is still the one on the clipboard (from Android 10 an app can't read the clipboard from
     * the background, so it couldn't tell then).
     */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        inFront = hasFocus
        if (hasFocus) clearIfExpired(applicationContext)
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
                            secureCopy(applicationContext, text, expiresAfterMs)
                            result.success(true)
                        }
                    }
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

    /** A link this app put on the clipboard: its marker, its text and when it expires. */
    private class Copied(val id: String, val text: String, val expiresAt: Long)

    /**
     * Copied ID links (design 10.4). The state belongs to the process, so a link copied on one screen
     * is cleared whichever screen is in front when its time runs out.
     */
    private companion object {
        val processBootId = "android-process-${UUID.randomUUID()}"

        /** Marks the clip this app made, so the app can tell its own link from anything copied since. */
        const val COPY_ID = "org.sineobex.field.COPY_ID"

        val handler = Handler(Looper.getMainLooper())
        var copied: Copied? = null
        var inFront = false
        var appContext: Context? = null
        val clearExpired = Runnable { appContext?.let { clearIfExpired(it) } }

        fun clipboardOf(context: Context) = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

        /**
         * Puts text (an ID link, or what a private box copied: review finding C-4) on the clipboard
         * marked sensitive, so the system's copy preview doesn't show it (EXTRA_IS_SENSITIVE from
         * Android 13; Android 7 to 12 read the same key or ignore it), and clears it [expiresAfterMs] later, as iOS does, if it is still the one there: the
         * person can paste it into another app meanwhile, and something they copied since is never
         * wiped (review P9). The label names no one.
         */
        fun secureCopy(context: Context, text: String, expiresAfterMs: Long) {
            val clip = ClipData.newPlainText("Copied text", text)
            val id = UUID.randomUUID().toString()
            if (Build.VERSION.SDK_INT >= 24) {
                val sensitiveKey = if (Build.VERSION.SDK_INT >= 33) {
                    ClipDescription.EXTRA_IS_SENSITIVE
                } else {
                    "android.content.extra.IS_SENSITIVE"
                }
                clip.description.extras = PersistableBundle().apply {
                    putBoolean(sensitiveKey, true)
                    putString(COPY_ID, id)
                }
            }
            appContext = context
            copied = Copied(id, text, SystemClock.elapsedRealtime() + expiresAfterMs)
            clipboardOf(context).setPrimaryClip(clip)
            handler.removeCallbacks(clearExpired)
            handler.postDelayed(clearExpired, expiresAfterMs)
        }

        /**
         * Whether the clipboard still holds the link this app copied. Null when Android won't say:
         * from Android 10 an app in the background can't read the clipboard.
         */
        fun holdsOurs(context: Context): Boolean? {
            val c = copied ?: return false
            if (Build.VERSION.SDK_INT >= 29 && !inFront) return null
            val clipboard = clipboardOf(context)
            // Readable, and empty: something cleared it.
            val description = clipboard.primaryClipDescription ?: return false
            if (Build.VERSION.SDK_INT >= 24) return description.extras?.getString(COPY_ID) == c.id
            // No extras before Android 7, and no notice of a read either: the text itself.
            return clipboard.primaryClip?.getItemAt(0)?.text?.toString() == c.text
        }

        fun forgetIfReplaced(context: Context) {
            if (holdsOurs(context) == false) forget()
        }

        /** The link's time ran out: cleared if it is still ours, forgotten if it isn't. */
        fun clearIfExpired(context: Context) {
            val c = copied ?: return
            if (SystemClock.elapsedRealtime() < c.expiresAt) return
            when (holdsOurs(context)) {
                true -> {
                    val clipboard = clipboardOf(context)
                    if (Build.VERSION.SDK_INT >= 28) {
                        clipboard.clearPrimaryClip()
                    } else {
                        clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
                    }
                    forget()
                }
                false -> forget()
                // In the background: checked again when the app is back in front.
                null -> Unit
            }
        }

        fun forget() {
            copied = null
            handler.removeCallbacks(clearExpired)
        }
    }
}
