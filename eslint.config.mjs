// eslint-config-next@16.3.3 ships native ESM flat config arrays under these
// subpaths, so they're imported directly rather than through the legacy
// @eslint/eslintrc FlatCompat shim (which the Payload blank template uses by
// default) — compat.extends() expects eslintrc-shaped shareable configs and
// crashes with a circular-JSON error when handed an already-flat config.
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^(_|ignore)',
        },
      ],
    },
  },
  {
    // ADR 0005 (supplier data secrecy), layer 3: /api/public/* endpoint
    // handlers may only read data through src/server/public/*. Direct access
    // to collection/global configs would bypass overrideAccess and
    // field-level access control.
    files: ['src/endpoints/public/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/collections/*', '@/globals/*'],
              message: 'Use @/server/public (ADR 0005)',
            },
          ],
        },
      ],
    },
  },
  {
    // ADR 0012 §3: src/shared is copied verbatim into samkvetlo by
    // `pnpm shared:sync`, so it may depend on nothing but zod.
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'payload', message: 'src/shared is copied to the frontend (ADR 0012)' },
            {
              name: '@payload-config',
              message: 'src/shared is copied to the frontend (ADR 0012)',
            },
          ],
          patterns: [
            {
              group: ['@payloadcms/*', '@/collections/*', '@/server/*', 'node:*'],
              message: 'src/shared is copied to the frontend (ADR 0012)',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['.next/', 'src/payload-types.ts', 'src/payload-generated-schema.ts'],
  },
]

export default eslintConfig
