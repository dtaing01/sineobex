import 'package:flutter/services.dart';

import '../sync/device_channel.dart';

/// How long a copied ID link stays on the clipboard (design 10.4: "It clears in 60 seconds").
const secureCopyLifetime = Duration(seconds: 60);

/// Copies [text] (an ID link, never a name or health detail) through the app's native channel, as
/// short-lived and private as each platform allows (design 10.4, risk 14.2-14):
///
/// - iOS: a local-only pasteboard item (never Universal Clipboard to the person's other devices)
///   that expires after [lifetime].
/// - Android: a clip marked sensitive (`ClipDescription.EXTRA_IS_SENSITIVE`, so the system's copy
///   preview hides it), cleared after [lifetime] if it is still the one on the clipboard, so it can
///   be pasted into another app meanwhile and nothing copied since is wiped (review P9). From
///   Android 10 an app in the background can't read the clipboard, so a link whose time runs out
///   there is cleared when the app is back in front. Before Android 13 there is no sensitive flag;
///   the clearing still applies.
///
/// Returns false when nothing was copied: the platform refused, or there is no native side (tests
/// and desktop builds). Never falls back to the plain clipboard, which would keep the link
/// indefinitely and share it across devices.
Future<bool> secureCopy(String text, {Duration lifetime = secureCopyLifetime}) async {
  try {
    final copied = await deviceChannel.invokeMethod<bool>('secureCopy', {
      'text': text,
      'expiresAfterMs': lifetime.inMilliseconds,
    });
    return copied ?? false;
  } on MissingPluginException {
    return false;
  } on PlatformException {
    return false;
  }
}

/// What copies text securely; tests and screens pass a fake.
typedef SecureCopy = Future<bool> Function(String text);
