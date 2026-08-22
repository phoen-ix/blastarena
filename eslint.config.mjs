import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'data/**',
      'docker/**',
      'tests/**',
    ],
  },

  // Base TypeScript config for all workspaces
  ...tseslint.configs.recommended,

  // Prettier must come after other configs to override conflicting rules
  eslintConfigPrettier,

  // Shared rules for all TypeScript files
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
    },
  },

  // Backend-specific: prefer logger over console
  {
    files: ['backend/src/**/*.ts'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Frontend-specific: console is fine for dev
  {
    files: ['frontend/src/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // The CSP sets `require-trusted-types-for 'script'`, so assigning a string to innerHTML throws
  // at runtime in Chromium — and only there, and only in production. Catch it at lint time
  // instead. utils/html.ts is the single sanitising sink; everything else goes through setHtml().
  // (audit CSP-1)
  {
    files: ['frontend/src/**/*.ts'],
    ignores: ['frontend/src/utils/html.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "AssignmentExpression > MemberExpression[property.name=/^(innerHTML|outerHTML)$/]",
          message:
            'Assigning innerHTML/outerHTML violates the Trusted Types CSP. Use setHtml(el, html) from utils/html.',
        },
        {
          selector: "CallExpression > MemberExpression[property.name='insertAdjacentHTML']",
          message:
            'insertAdjacentHTML violates the Trusted Types CSP. Use insertHtml(el, position, html) from utils/html.',
        },
        {
          selector: "CallExpression[callee.name='eval']",
          message: 'eval is blocked by the CSP.',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'new Function is blocked by the CSP.',
        },
      ],
    },
  },
);
