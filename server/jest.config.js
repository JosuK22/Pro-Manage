module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/globalSetup.js',
  globalTeardown: '<rootDir>/tests/globalTeardown.js',
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  // The in-memory server is shared across suites, so suites must not run in
  // parallel against the same database.
  maxWorkers: 1,
  testTimeout: 30000,
  clearMocks: true,
};
