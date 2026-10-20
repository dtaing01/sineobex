import createClient, { type Client } from 'openapi-fetch';
import type { components, paths } from './generated/api.ts';

export type { components, paths };
export type Schemas = components['schemas'];
export type ApiClient = Client<paths>;

/**
 * Typed client for the portal's server side. Every request carries the user's bearer token and the
 * team they are acting for; the API checks both.
 */
export function createApiClient(options: {
  baseUrl: string;
  token?: string;
  teamId?: string;
  fetch?: typeof fetch;
}): ApiClient {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.teamId) headers['x-team-id'] = options.teamId;
  return createClient<paths>({
    baseUrl: options.baseUrl,
    headers,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
