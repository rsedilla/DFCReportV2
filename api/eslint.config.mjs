// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    // Tests assert on loosely typed HTTP payloads; the strictness that protects
    // production code here only produces noise.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // `test/setup/env.ts` reads `TEST_DATABASE_URL` once and copies it into
    // `DATABASE_URL` for the whole run. Everything else — the Nest application via
    // `AppConfig`, `createTestDb`, and every raw `pg.Client` a case opens to hold a
    // lock or race a write — reads `DATABASE_URL`, which is correct in both
    // environments.
    //
    // A case that reads `TEST_DATABASE_URL` directly works on a developer machine,
    // where it is set, and gets `undefined` in CI, where it is not: CI sets
    // `DATABASE_URL` alone and relies on the fallback. `pg` then falls through to its
    // own defaults, finds no password, and fails with a SASL error naming nothing
    // about the cause.
    //
    // Four concurrency probes did exactly that and were invisible until this branch
    // opened its first pull request, because CI runs only on `pull_request`. env.ts
    // already stated the contract — the substitution lives there so that it "catches
    // all of them" — and a documented contract that nothing enforces is the failure
    // this repository keeps recording. This is the thing that enforces it.
    files: ['test/**/*.ts'],
    ignores: ['test/setup/env.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='TEST_DATABASE_URL']",
          message:
            'Read DATABASE_URL, not TEST_DATABASE_URL. test/setup/env.ts copies one into the ' +
            'other for the whole run; TEST_DATABASE_URL is unset in CI, so reading it directly ' +
            'passes locally and fails there with an unrelated-looking SASL error.',
        },
      ],
    },
  },
);
