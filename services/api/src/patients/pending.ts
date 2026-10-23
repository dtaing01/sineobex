import { ApiError } from '../lib/errors.ts';

/**
 * The answer of a patient module function whose implementation hasn't landed yet (phase 3 design,
 * section 15: routes delegate to module functions, and each unit fills in its own). A fixed string,
 * like every client-facing message. Deleted once no module calls it.
 */
export const notImplemented = () =>
  new ApiError(501, 'not_implemented', 'This part of the patient record is not available yet.');
