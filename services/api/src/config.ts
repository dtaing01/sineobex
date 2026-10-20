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
    PORT: z.coerce.number().int().default(8787),
    RELEASE: z.string().default('dev'),
  })
  .superRefine((c, ctx) => {
    if (c.MFA_MODE === 'none' && !['local', 'test'].includes(c.APP_ENV)) {
      ctx.addIssue({ code: 'custom', message: 'MFA_MODE=none is only allowed in local and test' });
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
