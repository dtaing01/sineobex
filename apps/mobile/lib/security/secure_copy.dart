import 'package:flutter/services.dart';

import '../sync/device_channel.dart';

/// How long copied text stays on the clipboard (design 10.4: "It clears in 60 seconds").
// PLAN-OPEN: Android's clipboard rule (design 14.3, #17). The PRD (module 13) clears a copied link
// "as the user leaves the app" on Android. That makes it impossible to paste the link into the app
// that prints the card, which is what Copy is for, so both platforms clear after this time
// instead. The project lead confirms, or the PRD's rule comes back.
const secureCopyLifetime = Duration(seconds: 60);

/// Copies [text] through the app's native channel, as short-lived and private as each platform
/// allows (design 10.4, risk 14.2-14): an ID link, and since the phase 4 review whatever is copied
/// or cut in a private box, a patient's details or a note's text among them (`PrivateBox`; the
/// coordinator's decision on review finding C-4), so nothing typed into a chart reaches the general
/// pasteboard:
///
/// - iOS: a local-only pasteboard item (never Universal Clipboard to the person's other devices)
///   that expires after [lifetime].
/// - Android: a clip marked sensitive (`ClipDescription.EXTRA_IS_SENSITIVE`, so the system's copy
///   preview hides it), cleared after [lifetime] if it is still the one on the clipboard, so it can
///   be pasted into another app meanwhile and nothing copied since is wiped (review P9). From
///   Android 10 an app in the background can't read the clipboard, so a link whose time runs out
///   there is cleared when the app is back in front. Only the app's process remembers the copy, so
///   one whose process Android ends before it is cleared stays on the clipboard. Before Android 13
///   there is no sensitive flag; the clearing still applies.
///
/// Returns false when nothing was copied: the platform refused, or there is no native side (tests
/// and desktop builds). Never falls back to the plain clipboard, which would keep the text
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
