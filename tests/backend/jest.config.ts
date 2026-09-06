import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '../../',
  testMatch: ['<rootDir>/tests/backend/**/*.test.ts', '<rootDir>/tests/shared/**/*.test.ts'],
  moduleNameMapper: {
    '^@blast-arena/shared$': '<rootDir>/shared/src',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'backend/tsconfig.json',
        diagnostics: {
          // ts-jest's option is `ignoreCodes` (the previous `ignoreDiagnostics` key was not one
          // and was silently ignored). 1378: top-level await. 6133/6196/6192: unused locals and
          // imports — the workspace tsconfigs enable noUnusedLocals/noUnusedParameters for src
          // (audit DEAD-CODE-1); test files are exempt so a leftover import cannot fail a suite.
          ignoreCodes: [1378, 6133, 6196, 6192],
        },
      },
    ],
  },
};

export default config;
