// Supabase Edge Function entry point (Deno), used only by the preview build with made-up patients.
// scripts/build.mjs bundles this file into supabase/functions/api/bundle.js.
import { Hono } from 'hono';
import { bootstrap, type Runtime } from './bootstrap.ts';

declare const Deno: {
  env: { toObject(): Record<string, string> };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

// Supabase routes /functions/v1/api/* to this function with the path starting at /api.
let runtime: Promise<Runtime> | undefined;
const getRuntime = () =>
  (runtime ??= bootstrap({ DATABASE_POOL_MAX: '1', DATABASE_PREPARE: 'false', ...Deno.env.toObject() }));

const outer = new Hono();
outer.all('/api/*', async (c) => {
  const { app } = await getRuntime();
  const url = new URL(c.req.url);
  url.pathname = url.pathname.replace(/^\/api/, '') || '/';
  return app.fetch(new Request(url, c.req.raw));
});

Deno.serve(outer.fetch);
