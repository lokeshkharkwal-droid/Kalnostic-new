// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // Guard-rail (CLAUDE.md §4.3): array-form `$transaction([...])` bypasses
      // the per-op RLS extension in PrismaService — the `app.current_tenant_id`
      // GUC is never set, so on a tenant-scoped model the batch silently returns
      // zero rows (reads) or violates WITH CHECK (writes) under enforced RLS on
      // the server. Use `prisma.withTenant(tenantId, (tx) => …)` for
      // tenant-scoped work, or the callback form `$transaction((tx) => …)`.
      // Platform-level (non-RLS) tables may opt out with an annotated
      // `// eslint-disable-next-line no-restricted-syntax`.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='$transaction'] > ArrayExpression",
          message:
            'Array-form $transaction([...]) bypasses the RLS tenant-context extension and returns empty on tenant-scoped tables under enforced RLS. Use prisma.withTenant(tenantId, (tx) => ...) or the callback form $transaction((tx) => ...). Platform-level (non-RLS) tables may opt out with an annotated // eslint-disable-next-line no-restricted-syntax.',
        },
      ],
      // Allow deliberately-unused identifiers when underscore-prefixed (the
      // standard convention) — e.g. a public method that must keep a parameter
      // for its signature/contract but does not consume it (`_dto`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // PrismaService itself uses array-form `$transaction` internally to set the
    // tenant GUC and run the op in one transaction — that IS the RLS mechanism,
    // so the guard-rail above must not fire on it.
    files: ['src/prisma/prisma.service.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);
