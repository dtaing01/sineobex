/// The named constants of search and duplicate matching (design 5.3). The server's
/// services/api/src/patients/match-constants.ts holds the same values, and match.json lists them
/// under `constants`; matching_test fails if any differs. Constants only the server uses (retrieval
/// thresholds, the sound-alike term) are here too, so the whole block compares.
library;

/// Lowest search score shown.
const searchMin = 0.50; // PLAN-OPEN: tune on pilot data (module 2)

/// Results per search run, and with Show more.
const searchLimit = 20; // PLAN-OPEN: tune on pilot data (module 2)
const searchMax = 50; // PLAN-OPEN: tune on pilot data (module 2)

/// Intake shows "Possible match".
const matchPossible = 0.60; // PLAN-OPEN: tune on pilot data (module 2)

/// The server queues the pair for review.
const queueThreshold = 0.70; // PLAN-OPEN: tune on pilot data (module 2)

/// Intake shows "Likely the same person" and asks again on Create.
const matchLikely = 0.80; // PLAN-OPEN: tune on pilot data (module 2)

/// Candidates per match check.
const matchLimit = 5; // PLAN-OPEN: tune on pilot data (module 2)

/// Candidates scored per query on the phone (the server scores 200), cut only after ranking.
const candidateLimit = 300; // PLAN-OPEN: tune on pilot data (module 2)

/// Server retrieval: keys per query string from each branch, and the `pg_trgm` thresholds.
const candidateBranchLimit = 100; // PLAN-OPEN: tune on pilot data (module 2)
const candidateTrgm = 0.30; // PLAN-OPEN: tune on pilot data (module 2)
const candidateWordTrgm = 0.50; // PLAN-OPEN: tune on pilot data (module 2)

/// Token similarities.
const nicknameSim = 0.90; // PLAN-OPEN: tune on pilot data (module 2)
const initialSim = 0.50; // PLAN-OPEN: tune on pilot data (module 2)
const prefixSim = 0.80; // PLAN-OPEN: tune on pilot data (module 2)

/// Server only: Double Metaphone is not on the phone (design 14.1, #10).
const phoneticSim = 0.80; // PLAN-OPEN: tune on pilot data (module 2)

/// String weights: an alias counts less than a name (street names are shared), a description less
/// in search.
const aliasWeight = 0.90; // PLAN-OPEN: tune on pilot data (module 2)
const descriptorWeight = 0.80; // PLAN-OPEN: tune on pilot data (module 2)

/// Weights of a match's name and birth, of a birth in a search, and of a match with no birth.
const wName = 0.65; // PLAN-OPEN: tune on pilot data (module 2)
const wDob = 0.35; // PLAN-OPEN: tune on pilot data (module 2)
const searchDobWeight = 0.30; // PLAN-OPEN: tune on pilot data (module 2)
const noDobFactor = 0.85; // PLAN-OPEN: tune on pilot data (module 2)

/// Partial agreement of two full birth dates.
const dobSwapped = 0.85; // PLAN-OPEN: tune on pilot data (module 2)
const dobMonthYear = 0.60; // PLAN-OPEN: tune on pilot data (module 2)
const dobYearSlip = 0.60; // PLAN-OPEN: tune on pilot data (module 2)
const dobYear = 0.40; // PLAN-OPEN: tune on pilot data (module 2)

/// A year against a year or a date, and an estimate against anything.
const yearSame = 0.60; // PLAN-OPEN: tune on pilot data (module 2)
const yearNear = 0.30; // PLAN-OPEN: tune on pilot data (module 2)
const estimateNear = 0.40; // PLAN-OPEN: tune on pilot data (module 2)
const estimateRange = 3; // PLAN-OPEN: tune on pilot data (module 2)

/// Caps: one name each and no birth; two full dates that disagree; names too far apart; a birth
/// alone.
const singleNameCap = 0.60; // PLAN-OPEN: tune on pilot data (module 2)
const dobConflictCap = 0.45; // PLAN-OPEN: tune on pilot data (module 2)
const nameFloor = 0.35; // PLAN-OPEN: tune on pilot data (module 2)
const dobOnlyCap = 0.40; // PLAN-OPEN: tune on pilot data (module 2)
