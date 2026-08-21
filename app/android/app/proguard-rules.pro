# Keep rules for release builds.
#
# The Flutter Gradle plugin contributes the engine's own rules; these cover
# the plugins this app uses that reflect or are referenced only from native
# code, and would otherwise be stripped by R8.

# SQLCipher and sqlite3 are reached through JNI.
-keep class net.sqlcipher.** { *; }
-keep class net.zetetic.** { *; }
-dontwarn net.sqlcipher.**

# androidx.security backs flutter_secure_storage's EncryptedSharedPreferences.
-keep class androidx.security.crypto.** { *; }
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**

# local_auth's BiometricPrompt callbacks.
-keep class androidx.biometric.** { *; }

# Play Core is referenced by the Flutter engine's deferred-components support
# even when the app does not use deferred components.
-dontwarn com.google.android.play.core.**

# Keep annotations that R8 uses to reason about nullability across the JNI
# boundary; stripping them produces confusing runtime failures rather than
# build errors.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
