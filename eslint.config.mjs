// Flat ESLint config for every TypeScript package. Flutter has its own analyzer (apps/mobile/analysis_options.yaml).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      '**/cdk.out/**',
      'apps/mobile/**',
      'apps/website/**',
      'packages/contract/src/generated/**',
      '**/next-env.d.ts',
      '**/supabase/functions/**/bundle.js',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The API must never write to stdout/stderr directly: the logger is the only path, and it accepts
    // allowlisted keys only, so patient details cannot reach logs by accident.
    files: ['services/api/src/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['apps/portal/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'jsx-a11y': jsxA11y, 'react-hooks': reactHooks, '@next/next': nextPlugin },
    settings: { next: { rootDir: 'apps/portal' } },
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // Browser console output can end up in screen recordings and support screenshots.
      'no-console': 'error',
    },
  },
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/test/**/*.ts',
      'tools/**/*.mjs',
      'db/**/*.ts',
      'infra/**/*.ts',
    ],
    rules: { 'no-console': 'off' },
  },
);
