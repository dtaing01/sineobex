import '../local/database.dart';
import '../models/models.dart';
import '../seed/demo_seed.dart' as seed;

/// Team roster, tasks, and the day's outreach plan.
///
/// Membership is authoritative in Cognito; this mirrors it for display and
/// queues permission changes for the admin API.
class TeamRepository {
  TeamRepository(this._db);

  final AppDatabase _db;

  static const _membersKey = 'team.members';
  static const _tasksKey = 'team.tasks';
  static const _actionsKey = 'team.outreachActions';

  Future<List<TeamMember>> members() async {
    final raw = await _db.getKeyValue<List<dynamic>>(_membersKey);
    if (raw == null) return const [];
    return raw
        .map((e) => TeamMember.fromJson(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<void> saveMembers(List<TeamMember> members) =>
      _db.putKeyValue(_membersKey, members.map((m) => m.toJson()).toList());

  /// Toggles a member's active status. The signed-in admin cannot deactivate
  /// themselves — locking yourself out of the roster mid-shift helps no one.
  Future<List<TeamMember>> toggleStatus(String id) async {
    final current = await members();
    final updated = current
        .map((m) => (m.id == id && !m.isSelf)
            ? m.copyWith(
                status: m.isActive ? MemberStatus.inactive : MemberStatus.active)
            : m)
        .toList(growable: false);
    await saveMembers(updated);
    return updated;
  }

  Future<List<TeamTask>> tasks() async {
    final raw = await _db.getKeyValue<List<dynamic>>(_tasksKey);
    if (raw == null) return const [];
    return raw
        .map((e) => TeamTask.fromJson(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<void> saveTasks(List<TeamTask> tasks) =>
      _db.putKeyValue(_tasksKey, tasks.map((t) => t.toJson()).toList());

  Future<List<TeamTask>> toggleTask(String id) async {
    final current = await tasks();
    final updated = current
        .map((t) => t.id == id
            ? t.copyWith(
                status:
                    t.isPending ? TaskStatus.completed : TaskStatus.pending)
            : t)
        .toList(growable: false);
    await saveTasks(updated);
    return updated;
  }

  Future<List<OutreachAction>> outreachActions() async {
    final raw = await _db.getKeyValue<List<dynamic>>(_actionsKey);
    if (raw == null) return const [];
    return raw
        .map((e) => OutreachAction.fromJson(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<void> saveOutreachActions(List<OutreachAction> actions) =>
      _db.putKeyValue(_actionsKey, actions.map((a) => a.toJson()).toList());

  Future<bool> get isEmpty async => (await members()).isEmpty;

  /// The demo user. In a configured deployment this comes from the Cognito
  /// ID token instead.
  AppUser get placeholderUser => seed.demoUser;
}
