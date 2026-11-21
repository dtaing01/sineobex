import 'server-only';
import { portalEnv } from '../env';
import { createDevAuth } from './dev';
import { createSupabaseAuth } from './supabase';
import type { AuthProvider } from './types';

let cached: AuthProvider | undefined;

export function authProvider(): AuthProvider {
  if (cached) return cached;
  const kind = process.env.AUTH_PROVIDER ?? 'supabase';
  if (kind === 'dev') {
    if (!['local', 'test'].includes(portalEnv()))
      throw new Error('AUTH_PROVIDER=dev is only allowed in local and test');
    cached = createDevAuth({ url: process.env.DEV_IDP_URL ?? 'http://localhost:8790' });
  } else if (kind === 'supabase') {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('AUTH_PROVIDER=supabase needs SUPABASE_URL and SUPABASE_ANON_KEY');
    cached = createSupabaseAuth({ url, anonKey });
  } else {
    // PLAN-OPEN (phase 12): Cognito hosted UI with authorization code + PKCE.
    throw new Error(`Unknown AUTH_PROVIDER ${kind}`);
  }
  return cached;
}

export * from './types';
