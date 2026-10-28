/// The named constants of search and duplicate matching (design 5.3). The server's
/// services/api/src/patients/match-constants.ts holds the same values, and match.json lists them
/// under `constants`; matching_test fails if the two differ. Constants only the server uses
/// (retrieval thresholds, the phonetic term) are here too, so the whole block compares.
///
/// PLAN-OPEN: tune on pilot data (module 2). Every value below is a default (design 14.1, #4).
library;

/// Lowest search score shown.
const searchMin = 0.50;

/// Results per search run, and with Show more.
const searchLimit = 20;
const searchMax = 50;

/// Intake shows "Possible match".
const matchPossible = 0.60;

/// The server queues the pair for review.
const queueThreshold = 0.70;

/// Intake shows "Likely the same person" and asks again on Create.
const matchLikely = 0.80;

/// Candidates per match check.
const matchLimit = 5;

/// Candidates scored per query on the phone (the server scores 200), cut only after ranking.
const candidateLimit = 300;

/// Server retrieval: keys per query string from each branch, and the `pg_trgm` thresholds.
const candidateBranchLimit = 100;
const candidateTrgm = 0.30;
const candidateWordTrgm = 0.50;

/// Token similarities.
const nicknameSim = 0.90;
const initialSim = 0.50;
const prefixSim = 0.80;

/// Server only: Double Metaphone is not on the phone (design 14.1, #10).
const phoneticSim = 0.80;

/// String weights: an alias counts less than a name (street names are shared), a description
/// less in search.
const aliasWeight = 0.90;
const descriptorWeight = 0.80;

/// Weights of a match's name and birth, of a birth in a search, and of a match with no birth.
const wName = 0.65;
const wDob = 0.35;
const searchDobWeight = 0.30;
const noDobFactor = 0.85;

/// Partial agreement of two full birth dates.
const dobSwapped = 0.85;
const dobMonthYear = 0.60;
const dobYearSlip = 0.60;
const dobYear = 0.40;

/// A year against a year or a date, and an estimate against anything.
const yearSame = 0.60;
const yearNear = 0.30;
const estimateNear = 0.40;
const estimateRange = 3;

/// Caps: one name each and no birth; two full dates that disagree; names too far apart; a birth
/// alone.
const singleNameCap = 0.60;
const dobConflictCap = 0.45;
const nameFloor = 0.35;
const dobOnlyCap = 0.40;
