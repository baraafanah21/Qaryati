import type { Config } from 'jest';

/**
 * Three Jest projects, selected by the npm scripts with --selectProjects:
 * - unit:        src/**\/*.spec.ts and the reference module's domain tests
 *                (test/reference-module/**\/*.spec.ts), no framework, no database
 * - integration: test/**\/*.int-spec.ts, real PostGIS via Testcontainers, one
 *                container per test file
 * - e2e:         test/**\/*.e2e-spec.ts, the Nest app over HTTP with Supertest,
 *                one PostGIS container for the whole run
 *
 * Tests run under `node --experimental-vm-modules` because NestJS 12 ships as
 * ES modules while this project compiles to CommonJS (same as the official
 * Nest 12 template).
 */
const shared = {
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
} satisfies Config;

const config: Config = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/reference-module/**/*.spec.ts'],
    },
    { ...shared, displayName: 'integration', testMatch: ['<rootDir>/test/**/*.int-spec.ts'] },
    {
      ...shared,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      // One migrated PostGIS container for the whole e2e run (sets DATABASE_URL).
      globalSetup: '<rootDir>/test/support/e2e-global-setup.ts',
      globalTeardown: '<rootDir>/test/support/e2e-global-teardown.ts',
    },
  ],
  // Nest module classes and index.ts files are wiring, not logic; counting them
  // would make the coverage number say nothing about tested behaviour.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/generate-openapi.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.module.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
};

export default config;
