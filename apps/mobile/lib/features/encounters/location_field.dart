import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/status_chip.dart';
import '../patients/patient_widgets.dart' show focusFollows, focusInView;
import 'encounter_labels.dart';

/// How long **Use my location** waits for the phone's fix before it says the phone couldn't find
/// one: long enough for a cold start in the open, short enough that the person isn't left waiting.
const locationTimeLimit = Duration(seconds: 30);

/// The most uncertain position the server takes (`accuracyM`, at most 100 km).
const maxAccuracyM = 100000;

/// A position this uncertain is said to be rough: a phone with precise location off gives a few
/// kilometres.
const roughAccuracyM = 1000;

/// Where **Use my location** has got to.
enum LocationState {
  /// Not asked, or removed.
  none,

  /// The phone is looking.
  finding,

  /// The phone gave a place, and the visit will take it.
  added,

  /// The person didn't allow it when asked.
  notAllowed,

  /// The phone won't ask again: it is allowed only in the phone's settings.
  blocked,

  /// Location is off for the whole phone.
  serviceOff,

  /// No fix in time, or none the server would take.
  notFound,

  /// The phone has no way to give one.
  unavailable,
}

/// **Use my location** (lifecycle 9.2): the place the phone gives, asked for only when the person
/// taps, kept until the visit is started with it. Nothing is asked of the phone before the tap, not
/// even whether it may: the permission is asked for then too. Owned by New encounter like the place
/// field's controller, it outlives the step that shows it, so a place that arrives after the person
/// has gone on to the kind still goes with the visit.
///
/// PLAN-OPEN: is the GPS position stored, and how exact (lifecycle 12.1 #15)? Only on the tap, from
/// the phone's high-accuracy fix, and stored as the phone gives it (`lat`, `lng`, `accuracyM`).
class PhoneLocation extends ChangeNotifier {
  LocationState _state = LocationState.none;
  Map<String, Object?>? _location;
  bool _disposed = false;

  /// Bumped by each ask and each Remove, so an answer that comes after either is dropped.
  int _asked = 0;

  LocationState get state => _state;

  /// The place as the domain layer takes it (`startEncounter(location:)`), or null.
  Map<String, Object?>? get location => _location;

  /// Whether the phone could tell only roughly where the person is.
  bool get rough => switch (_location?['accuracyM']) {
    final num a => a > roughAccuracyM,
    _ => false,
  };

  /// Asks the phone where it is: whether location is on, then the permission (asked for only now),
  /// then a fix within [locationTimeLimit].
  Future<void> locate() async {
    if (_state == LocationState.finding) return;
    final ask = ++_asked;
    _set(LocationState.finding, null);
    final (state, place) = await _find();
    if (_disposed || ask != _asked) return;
    _set(state, place);
  }

  /// **Remove**: the visit goes without the place, and a fix still on its way is dropped.
  void clear() {
    _asked++;
    _set(LocationState.none, null);
  }

  /// The phone's own settings, where location is turned on ([LocationState.serviceOff]) or allowed
  /// for this app ([LocationState.blocked]).
  Future<void> openSettings() async {
    try {
      await (_state == LocationState.serviceOff ? Geolocator.openLocationSettings() : Geolocator.openAppSettings());
    } on Exception {
      // The sentence already says where to go; a phone that can't open it leaves the person there.
    }
  }

  void _set(LocationState state, Map<String, Object?>? place) {
    _state = state;
    _location = place;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  static Future<(LocationState, Map<String, Object?>?)> _find() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return (LocationState.serviceOff, null);
      var allowed = await Geolocator.checkPermission();
      if (allowed == LocationPermission.denied || allowed == LocationPermission.unableToDetermine) {
        allowed = await Geolocator.requestPermission();
      }
      switch (allowed) {
        case LocationPermission.deniedForever:
          return (LocationState.blocked, null);
        case LocationPermission.denied || LocationPermission.unableToDetermine:
          return (LocationState.notAllowed, null);
        case LocationPermission.whileInUse || LocationPermission.always:
          break;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: locationTimeLimit),
      );
      return switch (placeOf(position)) {
        final place? => (LocationState.added, place),
        null => (LocationState.notFound, null),
      };
    } on TimeoutException {
      return (LocationState.notFound, null);
    } on LocationServiceDisabledException {
      return (LocationState.serviceOff, null);
    } on PermissionDeniedException {
      return (LocationState.notAllowed, null);
    } on Exception {
      // No plugin, no permission strings, a platform error: nothing the person can change here.
      return (LocationState.unavailable, null);
    }
  }
}

/// [position] as the visit keeps it (`lat`, `lng` and, when the phone says, `accuracyM`), or null
/// for one that isn't a place: out of range, no better than [maxAccuracyM], or the 0, 0 some phones
/// give with no fix.
Map<String, Object?>? placeOf(Position position) {
  final Position(latitude: lat, longitude: lng, accuracy: accuracy) = position;
  if (!lat.isFinite || !lng.isFinite || lat.abs() > 90 || lng.abs() > 180) return null;
  if (lat == 0 && lng == 0) return null;
  if (accuracy.isFinite && accuracy > maxAccuracyM) return null;
  // Android gives 0 and iOS a negative number when the phone doesn't know how close it is.
  return {'lat': lat, 'lng': lng, if (accuracy.isFinite && accuracy > 0) 'accuracyM': accuracy};
}

/// **Use my location** under the place's field (lifecycle 9.2), drawn from [location]: the button,
/// "Finding where you are…" while the phone looks, the place added with **Remove**, or why there is
/// none, in plain words. The place typed works with it or without it.
class LocationField extends StatefulWidget {
  const LocationField({super.key, required this.location, this.enabled = true, this.finding = findingLocation});

  final PhoneLocation location;

  /// False while the visit is being started.
  final bool enabled;

  /// What shows while the phone looks: on the step that starts the visit, that it would start
  /// without the place.
  final String finding;

  @override
  State<LocationField> createState() => _LocationFieldState();
}

class _LocationFieldState extends State<LocationField> {
  /// **Use my location** and **Remove**: when one goes, focus moves to the other.
  final _use = FocusNode();
  final _remove = FocusNode();

  @override
  void dispose() {
    _use.dispose();
    _remove.dispose();
    super.dispose();
  }

  Future<void> _locate() async {
    // The button stands disabled while the phone looks; someone moving by focus or a screen reader
    // is taken to what the answer puts there.
    final follow = focusFollows(context, _use);
    await widget.location.locate();
    if (!follow || !mounted) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) focusInView(widget.location.state == LocationState.added ? _remove : _use);
    });
  }

  void _clear() {
    final follow = focusFollows(context, _remove);
    widget.location.clear();
    if (!follow) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) focusInView(_use);
    });
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.location,
    builder: (context, _) {
      final location = widget.location;
      final state = location.state;
      if (state == LocationState.added) {
        return StatusBanner(
          icon: LucideIcons.mapPinCheck,
          tone: ChipTone.good,
          text: locationAdded,
          detail: location.rough ? locationRough : null,
          live: true,
          action: TextButton.icon(
            focusNode: _remove,
            onPressed: widget.enabled ? _clear : null,
            icon: const Icon(LucideIcons.x),
            label: Semantics(
              label: removeLocationSpoken,
              excludeSemantics: true,
              child: const Text(removeLocationAction),
            ),
          ),
        );
      }
      final why = switch (state) {
        LocationState.notAllowed => locationNotAllowed,
        LocationState.blocked => locationBlocked,
        LocationState.serviceOff => locationOff,
        LocationState.notFound => locationNotFound,
        LocationState.unavailable => locationUnavailable,
        LocationState.none || LocationState.finding || LocationState.added => null,
      };
      final settings = state == LocationState.blocked || state == LocationState.serviceOff;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // WideButton's look, with a focus node of its own for focus to come back to.
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              focusNode: _use,
              onPressed: widget.enabled && state != LocationState.finding ? () => unawaited(_locate()) : null,
              icon: const Icon(LucideIcons.locateFixed),
              label: const Text(useMyLocationAction, textAlign: TextAlign.center),
            ),
          ),
          if (state == LocationState.finding) ...[const SizedBox(height: FieldSpace.s2), _Finding(widget.finding)],
          if (why != null) ...[
            const SizedBox(height: FieldSpace.s2),
            StatusBanner(
              icon: LucideIcons.mapPinOff,
              tone: ChipTone.info,
              text: why,
              live: true,
              action: settings
                  ? OutlinedButton(
                      onPressed: () => unawaited(location.openSettings()),
                      child: const Text(openSettingsAction),
                    )
                  : null,
            ),
          ],
        ],
      );
    },
  );
}

/// "Finding where you are…" with a spinner, said as it appears.
class _Finding extends StatelessWidget {
  const _Finding(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    container: true,
    child: Row(
      children: [
        const ExcludeSemantics(
          child: SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.5)),
        ),
        const SizedBox(width: FieldSpace.s2),
        Expanded(
          child: Text(text, style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: context.field.ink)),
        ),
      ],
    ),
  );
}

/// What the kind step says of the place the phone is giving, if anything: the person may go on
/// while the phone looks, and the visit takes the place only once it has come.
class LocationNote extends StatelessWidget {
  const LocationNote({super.key, required this.location});

  final PhoneLocation location;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: location,
    builder: (context, _) => switch (location.state) {
      LocationState.finding => const Padding(
        padding: EdgeInsets.only(bottom: FieldSpace.s3),
        child: _Finding(stillFindingLocation),
      ),
      LocationState.added => Padding(
        padding: const EdgeInsets.only(bottom: FieldSpace.s3),
        child: Semantics(
          liveRegion: true,
          child: Text(locationAdded, style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: context.field.ink)),
        ),
      ),
      _ => const SizedBox.shrink(),
    },
  );
}
