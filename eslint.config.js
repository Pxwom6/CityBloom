import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-test',
      'dist-e2e',
      'dist-e2e-next',
      'dist-base',
      'node_modules',
      'test-results',
      'playwright-report',
      'docs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // The service worker template; the build fills in __FILES__ (scripts/vite-pwa.ts).
    files: ['src/pwa/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker, __FILES__: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // The simulation must stay pure and deterministic: no DOM, no Three.js, no wall clock, no Math.random.
    files: ['src/sim/**/*.ts'],
    ignores: ['src/sim/worker.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'src/sim must not import Three.js' },
            { group: ['preact', 'preact/*'], message: 'src/sim must not import UI code' },
            {
              group: ['**/render/**', '**/ui/**', '**/client/**', '**/tools/**', '**/audio/**'],
              message: 'src/sim must not import main-thread code',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'performance',
        'localStorage',
        'navigator',
        'requestAnimationFrame',
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded Rng in src/sim/rng.ts' },
        { object: 'Date', property: 'now', message: 'The sim must not read the wall clock' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'The sim must not read the wall clock' },
      ],
    },
  },
);
