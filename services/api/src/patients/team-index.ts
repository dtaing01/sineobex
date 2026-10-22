import type { TeamScope } from '../auth/context.ts';
import { notImplemented } from './pending.ts';
import type { TeamIndexInput, TeamIndexPageValue } from './schemas.ts';

/**
 * POST /v1/patients/index (phase 3 design 6.1, 6.2): the team search index for a phone, keyset-paged.
 * `have` equal to the current version answers `unchanged`; the first page carries the team's
 * complete redirect list. The route has already checked mayHoldTeamIndex. Each page is audited as
 * `patient.index_downloaded {version, after, next, count}` (D33); `unchanged` writes nothing.
 */
export async function teamIndexPage(_scope: TeamScope, _input: TeamIndexInput): Promise<TeamIndexPageValue> {
  throw notImplemented();
}
