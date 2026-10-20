package com.sineobex.field

import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterFragmentActivity

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
}
