/**
 * The named constants of search and duplicate matching (phase 3 design 5.3). The phone mirrors
 * them in lib/patients/match_constants.dart; packages/contract/test-vectors/match.json lists them
 * under `constants`, and a test on each side fails if its values differ.
 *
 * Every value is a default (design 14.1, #4). Every pair the server queues stores its score and
 * reasons, so tuning is measurable on pilot data without reading a name.
 */

// Thresholds and limits
/** Lowest search score shown. */
export const SEARCH_MIN = 0.5; // PLAN-OPEN: tune on pilot data (module 2)
/** Results per search. */
export const SEARCH_LIMIT = 20; // PLAN-OPEN: tune on pilot data (module 2)
/** Results with Show more; past this the screen asks for more letters or a birth year. */
export const SEARCH_MAX = 50; // PLAN-OPEN: tune on pilot data (module 2)
/** Intake shows "Possible match". */
export const MATCH_POSSIBLE = 0.6; // PLAN-OPEN: tune on pilot data (module 2)
/** The server queues the pair for a person to decide. */
export const QUEUE_THRESHOLD = 0.7; // PLAN-OPEN: tune on pilot data (module 2)
/** Intake shows "Likely the same person" and asks again on Create. */
export const MATCH_LIKELY = 0.8; // PLAN-OPEN: tune on pilot data (module 2)
/** Candidates per match check. */
export const MATCH_LIMIT = 5; // PLAN-OPEN: tune on pilot data (module 2)
/** Candidate groups scored per query on the server, cut only after ranking (the phone uses 300). */
export const CANDIDATE_LIMIT = 200; // PLAN-OPEN: tune on pilot data (module 2)
/** Keys per query string from the trigram branch, and from the token and code branch. */
export const CANDIDATE_BRANCH_LIMIT = 100; // PLAN-OPEN: tune on pilot data (module 2)
/** pg_trgm thresholds for retrieval (`%` and `<%`). */
export const CANDIDATE_TRGM = 0.3; // PLAN-OPEN: tune on pilot data (module 2)
export const CANDIDATE_WORD_TRGM = 0.5; // PLAN-OPEN: tune on pilot data (module 2)

// Token similarities
export const NICKNAME_SIM = 0.9; // PLAN-OPEN: tune on pilot data (module 2)
export const INITIAL_SIM = 0.5; // PLAN-OPEN: tune on pilot data (module 2)
/** Search only: the query token is the start of a stored token ("smi"). */
export const PREFIX_SIM = 0.8; // PLAN-OPEN: tune on pilot data (module 2)
/** Server only: the tokens share a Double Metaphone code. */
export const PHONETIC_SIM = 0.8; // PLAN-OPEN: tune on pilot data (module 2)

// String weights
/** Street names are shared, so an alias counts slightly less than a name. */
export const ALIAS_WEIGHT = 0.9; // PLAN-OPEN: tune on pilot data (module 2)
export const DESCRIPTOR_WEIGHT = 0.8; // PLAN-OPEN: tune on pilot data (module 2)

// Weights
export const W_NAME = 0.65; // PLAN-OPEN: tune on pilot data (module 2)
export const W_DOB = 0.35; // PLAN-OPEN: tune on pilot data (module 2)
export const SEARCH_DOB_WEIGHT = 0.3; // PLAN-OPEN: tune on pilot data (module 2)
export const NO_DOB_FACTOR = 0.85; // PLAN-OPEN: tune on pilot data (module 2)

// Partial birth dates
export const DOB_SWAPPED = 0.85; // PLAN-OPEN: tune on pilot data (module 2)
export const DOB_MONTH_YEAR = 0.6; // PLAN-OPEN: tune on pilot data (module 2)
export const DOB_YEAR_SLIP = 0.6; // PLAN-OPEN: tune on pilot data (module 2)
export const DOB_YEAR = 0.4; // PLAN-OPEN: tune on pilot data (module 2)

// Year-only and estimated births
export const YEAR_SAME = 0.6; // PLAN-OPEN: tune on pilot data (module 2)
export const YEAR_NEAR = 0.3; // PLAN-OPEN: tune on pilot data (module 2)
export const ESTIMATE_NEAR = 0.4; // PLAN-OPEN: tune on pilot data (module 2)
/** Years either side of an estimated birth; also how far a fill may refine an estimate (design 2.4). */
export const ESTIMATE_RANGE = 3; // PLAN-OPEN: tune on pilot data (module 2)

// Caps
/** Two people known only by one name each, with no birth date: possible at intake, never queued. */
export const SINGLE_NAME_CAP = 0.6; // PLAN-OPEN: tune on pilot data (module 2)
/** Two full birth dates that disagree. */
export const DOB_CONFLICT_CAP = 0.45; // PLAN-OPEN: tune on pilot data (module 2)
/** Below this name similarity, a birth date alone can't flag anyone (DOB_ONLY_CAP). */
export const NAME_FLOOR = 0.35; // PLAN-OPEN: tune on pilot data (module 2)
export const DOB_ONLY_CAP = 0.4; // PLAN-OPEN: tune on pilot data (module 2)

/**
 * Every constant by name, as match.json lists them. The phone's CANDIDATE_LIMIT is 300 (design
 * 5.5); the vectors carry the server's, and the phone's test names its own exception.
 */
export const MATCH_CONSTANTS = {
  SEARCH_MIN,
  SEARCH_LIMIT,
  SEARCH_MAX,
  MATCH_POSSIBLE,
  QUEUE_THRESHOLD,
  MATCH_LIKELY,
  MATCH_LIMIT,
  CANDIDATE_LIMIT,
  CANDIDATE_BRANCH_LIMIT,
  CANDIDATE_TRGM,
  CANDIDATE_WORD_TRGM,
  NICKNAME_SIM,
  INITIAL_SIM,
  PREFIX_SIM,
  PHONETIC_SIM,
  ALIAS_WEIGHT,
  DESCRIPTOR_WEIGHT,
  W_NAME,
  W_DOB,
  SEARCH_DOB_WEIGHT,
  NO_DOB_FACTOR,
  DOB_SWAPPED,
  DOB_MONTH_YEAR,
  DOB_YEAR_SLIP,
  DOB_YEAR,
  YEAR_SAME,
  YEAR_NEAR,
  ESTIMATE_NEAR,
  ESTIMATE_RANGE,
  SINGLE_NAME_CAP,
  DOB_CONFLICT_CAP,
  NAME_FLOOR,
  DOB_ONLY_CAP,
} as const;
