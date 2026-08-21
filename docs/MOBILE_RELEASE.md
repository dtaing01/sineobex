# Mobile release setup

Apple and Google account setup, code signing, and the store compliance forms.

Sineobex is a **health app that handles protected health information**, which
puts it in the strictest review category on both stores. Most of the delay in
getting an app like this published is not technical — it is the declarations.
They are covered here in as much detail as the signing steps.

Prerequisites from [`SETUP.md`](SETUP.md) §1 assumed.

---

## Part 1 — Apple

### 1.1 Enrolment

Enrol in the [Apple Developer Program](https://developer.apple.com/programs/)
as an **organization**, not an individual. Individual accounts publish under a
person's own name, which is wrong for a clinical service and cannot be
transferred cleanly later.

- US$99/year.
- Organization enrolment requires a **D-U-N-S number** for the legal entity.
  Apple issues these free via their D-U-N-S lookup, but allow **1–2 weeks** —
  this is the single most common cause of a surprise delay. Start it first.
- The enroller must have legal signing authority for the entity.

Then in App Store Connect, add team members under **Users and Access**. Give
CI its own API key (§1.5) rather than a human's credentials.

### 1.2 Bundle identifier and capabilities

The project ships with `org.streetmed.sineobex`. Change it to your own
reverse-DNS identifier before first submission — it is permanent once an app
record exists.

```sh
cd app
# Update in Xcode: Runner target → Signing & Capabilities → Bundle Identifier
open ios/Runner.xcworkspace
```

Register it at
[Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list).

Capabilities this app needs: **none beyond the defaults.** It uses no
HealthKit, no push entitlement yet, no App Groups, no iCloud. Do not enable
HealthKit — the app records clinician observations, not device health data,
and enabling it invites review questions you cannot answer affirmatively.

If push notifications are added later (the queue exists; delivery is not
built), you will need the Push Notifications capability and an APNs key.

### 1.3 Signing

For CI, use **App Store Connect API keys** and let `fastlane match` or Xcode
cloud-managed signing handle certificates. Manual certificate wrangling on a
shared CI runner is where signing setups rot.

Manual route, if you prefer it:

1. **Distribution certificate** — Certificates → `+` → Apple Distribution.
   Download, double-click to install into Keychain.
2. **Provisioning profile** — Profiles → `+` → App Store → select your
   identifier and certificate.
3. Export the certificate as `.p12` **with a password**. That file plus its
   password are what CI needs; both are secrets.

### 1.4 The privacy manifest — required, and easy to get wrong

`app/ios/Runner/PrivacyInfo.xcprivacy` is committed and declares:

- Six collected data types: name, email, phone, **health**, sensitive info,
  and precise location — all marked *linked to the user* and *not used for
  tracking*.
- Four "required reason" API categories, with the reason codes for file
  timestamps, disk space, user defaults, and system boot time. These are used
  by `path_provider`, `sqlite3`/SQLCipher, the Flutter engine, and
  `dio`/`connectivity_plus` respectively.

**The file must be in the Runner target's Copy Bundle Resources build phase**,
or it ships without a manifest and is rejected at submission. Xcode does not
add it automatically when the file merely exists on disk — so it is registered
in `Runner.xcodeproj/project.pbxproj` and committed, and CI fails the build if
it is ever missing from the produced bundle.

Nothing to do by hand. If you regenerate the iOS project, re-add it:

1. `open ios/Runner.xcworkspace`
2. Drag `PrivacyInfo.xcprivacy` into the **Runner** group in the navigator.
3. In the dialog, tick **Copy items if needed** and the **Runner** target.
4. Confirm under Runner → Build Phases → Copy Bundle Resources.

Verify in a built archive:

```sh
unzip -l build/ios/ipa/*.ipa | grep PrivacyInfo
```

Keep this file consistent with your App Privacy answers (§1.6). Apple
cross-checks them and a mismatch is a common rejection.

### 1.5 App Store Connect API key (for CI)

Users and Access → **Integrations** → App Store Connect API → `+`.

- Role: **App Manager** is sufficient. Admin is not needed.
- Download the `.p8` **once** — it cannot be downloaded again.
- Record the **Key ID** and **Issuer ID**.

These three become the `APP_STORE_CONNECT_*` secrets in §3.

### 1.6 App Privacy questionnaire

App Store Connect → your app → **App Privacy**. Declare, matching the manifest:

| Data type | Collected | Linked | Tracking | Purpose |
|---|---|---|---|---|
| Name | Yes | Yes | No | App Functionality |
| Email address | Yes | Yes | No | App Functionality |
| Phone number | Yes | Yes | No | App Functionality |
| Health | Yes | Yes | No | App Functionality |
| Sensitive info | Yes | Yes | No | App Functionality |
| Precise location | Yes | Yes | No | App Functionality |

Answer **No** to third-party advertising, analytics, and data brokerage. The
app contains no SDK that does any of those, which is a deliberate choice for
a system holding PHI — and worth keeping.

### 1.7 Encryption compliance — check this with counsel

`Info.plist` currently sets:

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

**Confirm this is right for you before submitting.** The app *does* use
encryption — SQLCipher with AES-256 for the local database, plus TLS. The
declaration asserts that none of it is *non-exempt*. Encryption limited to
protecting the user's own data with standard published algorithms generally
falls under the mass-market exemption, which is why `false` is the usual
answer for an app shaped like this one.

But that is an export-control determination, not a code comment, and the
consequences of getting it wrong are legal rather than technical. Have counsel
confirm it. If your determination differs, set the key to `true` and supply
the export compliance documentation Apple then asks for. France additionally
requires a declaration regardless of the US exemption.

### 1.8 Review notes

Apple will reject a clinical app with no way to see it work. In App Review
Information, supply:

- **A demo account.** A Cognito user in a demo pool, seeded with the synthetic
  dataset. Never a production account, and never one that can reach real PHI.
- **Notes** explaining that the app is for use by employed clinical staff of a
  street medicine programme, that accounts are provisioned by an
  administrator, and that there is no public sign-up by design.
- If you gate distribution to your own staff, consider the **Apple Business
  Manager** custom app route instead of public App Store distribution. For an
  internal clinical tool this is usually the better fit: no public listing, no
  consumer review surface, and distribution limited to your organization.

### 1.9 Build and upload

```sh
cd app
flutter build ipa --release --dart-define-from-file=config/prod.json
xcrun altool --upload-app --type ios \
  -f build/ios/ipa/*.ipa \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
```

CI does this for you — see [`CI.md`](CI.md).

---

## Part 2 — Google Play

### 2.1 Enrolment

[Play Console](https://play.google.com/console/signup), **organization**
account.

- US$25, one time.
- Organization accounts require **verification of the legal entity** —
  D-U-N-S number, and a matching public website and contact address. Budget
  **1–3 weeks**; Google has tightened this and the checks are real.
- Google also requires a verified contact address and phone for the account
  holder, shown on the store listing for organization accounts.

### 2.2 Application id

The project ships with `org.streetmed.sineobex`
(`app/android/app/build.gradle.kts`). Change it before first upload — it is
permanent for the life of the listing.

### 2.3 Signing

Use **Play App Signing**. Google holds the app signing key; you hold an
*upload* key. If the upload key is ever lost or compromised it can be reset,
which is not true of the app signing key.

Generate an upload key:

```sh
keytool -genkey -v -keystore ~/sineobex-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Wire it up locally — `key.properties` is gitignored:

```sh
cat > app/android/key.properties <<'EOF'
storePassword=<store password>
keyPassword=<key password>
keyAlias=upload
storeFile=/absolute/path/to/sineobex-upload.jks
EOF
```

The project's `build.gradle.kts` reads that file when present and falls back
to debug signing when it is not, so a plain `flutter build apk` still works
for local testing.

Keep the keystore backed up somewhere durable and access-controlled. Losing it
means resetting the upload key through Google support.

### 2.4 Service account (for CI)

1. In Play Console: **Setup → API access → Create new service account**. This
   sends you to Google Cloud.
2. Create the service account, then create and download a **JSON key**.
3. Back in Play Console, grant it access with these permissions and no more:
   - *View app information and download bulk reports*
   - *Manage testing tracks and edit tester lists*
   - *Manage store presence*, only if CI updates the listing
4. Do **not** grant *Release to production*. Let CI publish to a closed track
   and promote by hand — a mis-tagged commit should not be able to reach
   patients' clinicians without a person in the loop.

### 2.5 Data safety form

Play Console → **App content → Data safety**. Declare the same set as the
Apple manifest:

| Data type | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|
| Name | Yes | No | App functionality | No |
| Email address | Yes | No | App functionality, Account management | No |
| Phone number | Yes | No | App functionality | Yes |
| **Health info** | Yes | No | App functionality | No |
| Precise location | Yes | No | App functionality | Yes |

Also declare:

- Data **is** encrypted in transit — TLS 1.2+, and API Gateway does not accept
  plaintext.
- Users **can** request deletion — describe your process. For PHI this is
  governed by HIPAA and your retention policy, not by a self-service delete
  button; say so plainly rather than claiming a capability you do not offer.
- The app **does** collect data from children: **No** — it is a clinician
  tool. Patients do not have accounts.

### 2.6 Health apps declaration

Google requires an additional declaration for apps handling health data.
Play Console → **App content → Health apps**.

Expect to state: what health data you handle, that it is entered by trained
staff rather than sensed from the device, that you are a covered entity or
business associate under HIPAA, and how access is restricted. Have your BAA
and privacy policy URL ready — Google asks for both.

### 2.7 Sensitive permissions

The app requests `ACCESS_FINE_LOCATION`. Play requires a declaration and a
short video showing the in-app flow that uses it.

The honest description: location is captured **only** when a clinician
explicitly taps "Use my location" while enrolling a patient, to record where
that person was found so the outreach team can locate them again for
follow-up care. There is no background location, no tracking, and the
`ACCESS_BACKGROUND_LOCATION` permission is not requested.

The app also declares `android.hardware.location.gps` as
`required="false"` — it works from a typed location when GPS is unavailable,
which keeps it installable on devices without GPS.

### 2.8 Target API level

Play enforces a rolling minimum target API level. Flutter 3.47 targets a
current level by default; if an upload is rejected for this, raise
`targetSdk` in `app/android/app/build.gradle.kts` and rebuild. Check the
current requirement before each annual deadline (usually August).

### 2.9 Build and upload

```sh
cd app
flutter build appbundle --release --dart-define-from-file=config/prod.json
# → build/app/outputs/bundle/release/app-release.aab
```

Upload to the **internal testing** track first. CI does this automatically —
see [`CI.md`](CI.md).

---

## Part 3 — Secrets for CI

Set these as GitHub Actions secrets. None should ever be committed.

### Apple

| Secret | What it is |
|---|---|
| `APP_STORE_CONNECT_KEY_ID` | Key ID from §1.5 |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID from §1.5 |
| `APP_STORE_CONNECT_KEY_P8` | Contents of the `.p8`, base64 |
| `IOS_DIST_CERT_P12` | Distribution certificate, base64 |
| `IOS_DIST_CERT_PASSWORD` | Its export password |
| `IOS_PROVISIONING_PROFILE` | `.mobileprovision`, base64 |

### Google

| Secret | What it is |
|---|---|
| `PLAY_SERVICE_ACCOUNT_JSON` | Service account key JSON from §2.4 |
| `ANDROID_KEYSTORE_BASE64` | Upload keystore, base64 |
| `ANDROID_KEYSTORE_PASSWORD` | Store password |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | Key password |

Base64 a file for a secret with:

```sh
base64 -i AuthKey_ABC123.p8 | pbcopy       # macOS
base64 -w0 AuthKey_ABC123.p8               # Linux
```

### AWS

Deployment uses **OIDC**, so there are no AWS keys to store. See
[`CI.md`](CI.md) §2.

---

## Part 4 — Before you submit either store

- [ ] Built and run on a **real device**, both platforms. Neither store build
      has been verified in this repository — no platform SDK was available in
      the environment it was developed in.
- [ ] Privacy policy published at a stable URL. Both stores require one, and
      for a HIPAA-regulated app it must be consistent with your Notice of
      Privacy Practices.
- [ ] Demo account provisioned in a **non-production** pool with synthetic
      data only.
- [ ] Screenshots taken from the demo build — never from one showing real
      patients.
- [ ] `SINEOBEX_DEMO_SEED` confirmed absent from the production build.
- [ ] Encryption compliance determination confirmed (§1.7).
- [ ] BAA signed with AWS, and with any other vendor touching PHI.
