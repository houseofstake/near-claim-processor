import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.ts'
    ],
    // Include all tests, including heavy/scale tests
    testTimeout: 1800000, // 30 minutes for heavy tests
    hookTimeout: 60000,   // 1 minute for setup/teardown
    teardownTimeout: 60000,
    globals: true,
    environment: 'node',
    // Allow longer tests for local development
    bail: 1, // Stop on first failure to save time during development
    reporters: ['verbose']
  }
});