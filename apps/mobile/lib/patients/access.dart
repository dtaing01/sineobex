/// The derived access rules of phase 3 (design 1.6, 4.1; D37), over the permission list the phone
/// caches per team (`TeamRef.permissions`, from `/v1/me`).
///
/// No permission key is added in phase 3: each rule combines keys of the existing catalog. The
/// server's services/api/src/auth/permissions.ts holds the same three, and both are pinned by
/// packages/contract/test-vectors/access.json. The phone uses them to hide what a role can't use
/// offline; the server still decides.
library;

/// The permissions of people who meet patients in person.
const fieldPermissions = ['patients.edit', 'encounters.chart', 'checkins.create'];

/// Holds at least one field permission.
bool hasFieldAccess(Iterable<String> permissions) => fieldPermissions.any(permissions.contains);

/// May hold the team search index on this phone: field roles only. Billing/Data and view-only roles
/// never do (D38); the phone then doesn't ask for it and searches only charts it has opened.
///
/// PLAN-OPEN: a way for a team to keep the index off a field role (design 14.1, #11). None in
/// phase 3: the index follows patients.view plus a field permission; a later team setting may add one.
bool mayHoldTeamIndex(Iterable<String> permissions) =>
    permissions.contains('patients.view') && hasFieldAccess(permissions);

/// May see the problem list (titles, codes, statuses, history, notes). Billing/Data sees codes; the
/// community health worker preset sees none.
bool mayViewProblems(Iterable<String> permissions) =>
    permissions.contains('patients.view') &&
    (permissions.contains('encounters.chart') || permissions.contains('billing.view_codes'));
