// ESLint flat config for the whole repository.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'data/**',
      'infra/.generated/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      // local, gitignored run state and check scripts (outside every tsconfig)
      'tests/.run/**',
      // approved restyle mockups (docs only, kept as the client approved them)
      'docs/portal-v2/restyle-mockups/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Unhandled promises are the commonest source of silent failures in server and player code.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/require-await': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
      'no-eval': 'error',
      'no-implied-eval': 'off',
      '@typescript-eslint/no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // Server-side code and tooling.
    files: [
      'apps/api/**/*.ts',
      'apps/media-worker/**/*.ts',
      'packages/**/*.ts',
      'scripts/**/*.ts',
      'tests/**/*.ts',
      '*.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The domain must stay free of platform code (prototype-m0.md section 3).
    files: ['packages/domain/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.test-support.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'crypto', 'http', 'https', 'net'],
              message: 'packages/domain must not use Node APIs.',
            },
            {
              group: ['@tinnox/*', '!@tinnox/contracts'],
              message: 'packages/domain may depend only on @tinnox/contracts.',
            },
            {
              group: ['react', 'react-dom', 'fastify', 'pg', 'idb'],
              message: 'packages/domain must stay framework-free.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'indexedDB',
        'caches',
        'localStorage',
        'sessionStorage',
        'fetch',
        'process',
      ],
    },
  },
  {
    files: [
      'apps/portal/**/*.{ts,tsx}',
      'apps/player-web/**/*.ts',
      // The shared app renderer runs in both of them.
      'packages/app-render/src/**/*.ts',
    ],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
    rules: {
      // Operator bearer tokens and session data must never be put in web storage (brief section 6).
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: 'Do not use localStorage; see the security rules in docs/dev-handoff.md.',
        },
        { name: 'sessionStorage', message: 'Do not use sessionStorage.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          property: 'innerHTML',
          message: 'Do not assign HTML strings; build DOM nodes or use textContent.',
        },
        { property: 'outerHTML', message: 'Do not assign HTML strings.' },
        { object: 'document', property: 'write', message: 'Do not use document.write.' },
      ],
    },
  },
  {
    files: ['apps/portal/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is not allowed.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test-support.ts', '**/test/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
