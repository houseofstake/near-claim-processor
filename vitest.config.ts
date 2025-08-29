import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    typecheck: {
      tsconfig: './tsconfig.test.json'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*'
      ]
    },
    testTimeout: 15000, // 15 seconds for standard tests
    hookTimeout: 10000,
    teardownTimeout: 10000,
    // Filter out heavy test patterns
    testNamePattern: '^(?!.*(large|massive|ultra|Dataset)).*$'
  },
  resolve: {
    alias: {
      '@': './src'
    }
  }
});