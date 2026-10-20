import { z } from 'zod';

const AppEnv = z.enum(['local', 'test', 'preview', 'pilot', 'production']);
export type AppEnv = z.infer<typeof AppEnv>;

/** Environments that may only ever hold made-up patients. */
export const DEMO_ENVS: readonly AppEnv[] = ['local', 'test', 'preview'];

const ConfigSchema = z
  .object({
    APP_ENV: AppEnv,
    DATABASE_URL: z.string().min(1),
    /** Connection pool size. Edge functions want 1; Fargate tasks a few. */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    /** Supabase's transaction pooler doesn't support prepared statements. */
    DATABASE_PREPARE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    OIDC_ISSUER: z.string().url(),
    OIDC_AUDIENCE: z.string().min(1),
    OIDC_JWKS_URL: z.string().url(),
    /**
     * How MFA is proven for admin and Billing/Data actions:
     *  - aal:  the token must carry aal=aal2 (Supabase Auth)
     *  - pool: the identity provider requires MFA for every user (Cognito pool setting)
     *  - none: no check; refused outside local and test
     */
    MFA_MODE: z.enum(['aal', 'pool', 'none']).default('aal'),
    /** Comma-separated origins allowed to call the API from a browser (the portal). */
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    /** Where invitations create sign-in identities. `memory` is for local and test only. */
    IDENTITY_ADMIN: z.enum(['supabase', 'memory']).default('supabase'),
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    /** Where Supabase's invitation email sends people to set a password (the portal). */
    INVITE_REDIRECT_URL: z.string().url().optional(),
    PORT: z.coerce.number().int().default(8787),
    RELEASE: z.string().default('dev'),
  })
  .superRefine((c, ctx) => {
    if (c.MFA_MODE === 'none' && !['local', 'test'].includes(c.APP_ENV)) {
      ctx.addIssue({ code: 'custom', message: 'MFA_MODE=none is only allowed in local and test' });
    }
    if (!c.OIDC_ISSUER.startsWith('https://') && !['local', 'test'].includes(c.APP_ENV)) {
      ctx.addIssue({ code: 'custom', message: 'OIDC_ISSUER must use https outside local and test' });
    }
    if (c.IDENTITY_ADMIN === 'memory' && !['local', 'test'].includes(c.APP_ENV)) {
      ctx.addIssue({ code: 'custom', message: 'IDENTITY_ADMIN=memory is only allowed in local and test' });
    }
    if (c.IDENTITY_ADMIN === 'supabase' && (!c.SUPABASE_URL || !c.SUPABASE_SERVICE_ROLE_KEY)) {
      ctx.addIssue({
        code: 'custom',
        message: 'IDENTITY_ADMIN=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names only, never values: DATABASE_URL carries a password.
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(config)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  return parsed.data;
}
