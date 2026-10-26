import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Engine-dependent maths and locale formatting may differ between browsers in the last bit, which
 * would split a shared city apart (SPEC-4.md, M29): src/sim and src/data use src/sim/dmath.ts.
 */
const DMATH_ONLY = [
  'hypot',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'pow',
  'cbrt',
];
const DETERMINISM = {
  properties: [
    ...DMATH_ONLY.map((property) => ({
      object: 'Math',
      property,
      message: `Math.${property} may differ between browsers: use DMath from src/sim/dmath.ts`,
    })),
    {
      property: 'toLocaleString',
      message: 'Locale formatting may differ between browsers: use formatInt (src/sim/dmath.ts)',
    },
    {
      property: 'localeCompare',
      message: 'Locale order may differ between browsers: compare strings with < and >',
    },
  ],
  syntax: [
    { selector: "BinaryExpression[operator='**']", message: '** may differ between browsers: use DMath.pow' },
    {
      selector: "AssignmentExpression[operator='**=']",
      message: '**= may differ between browsers: use DMath.pow',
    },
    { selector: "MemberExpression[object.name='Intl']", message: 'Keep Intl out of the sim' },
  ],
};

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-test',
      'dist-e2e',
      'dist-e2e-next',
      '**/.wrangler/**',
      '.cache',
      'dist-base',
      // Other builds kept for comparisons (dist-before, …).
      'dist-*',
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
        ...DETERMINISM.properties,
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'The sim must not read the wall clock' },
        ...DETERMINISM.syntax,
      ],
    },
  },
  {
    // Balancing data feeds the sim too: the same deterministic maths (phase 4).
    files: ['src/data/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...DETERMINISM.properties],
      'no-restricted-syntax': ['error', ...DETERMINISM.syntax],
    },
  },
);
