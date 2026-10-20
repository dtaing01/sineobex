import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * An error the client is meant to see. `code` is stable and machine-readable; `message` is plain
 * English for staff. Neither may contain patient details: messages are written here, never built
 * from request input.
 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const unauthorized = (message = 'Sign in again to continue.') => new ApiError(401, 'unauthorized', message);

export const forbidden = (message = 'Your role does not allow this.', code = 'forbidden') =>
  new ApiError(403, code, message);

export const notFound = (what = 'record') => new ApiError(404, 'not_found', `That ${what} was not found.`);

export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(409, code, message, details);

export const invalid = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(422, code, message, details);

export interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
