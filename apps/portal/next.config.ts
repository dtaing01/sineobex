import type { NextConfig } from 'next';

const config: NextConfig = {
  // A self-contained server for the container image on AWS (phase 12). Vercel ignores this.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // The contract package ships TypeScript source.
  transpilePackages: ['@sineobex/contract'],
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default config;
