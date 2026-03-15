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
);
