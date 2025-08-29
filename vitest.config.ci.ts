import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/storage.test.ts',
      'tests/merkle-tree.test.ts',  
      'tests/processor.test.ts',
      'tests/integration.test.ts',
      'tests/manual-verification.test.ts'
    ],
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 10000,
    testNamePattern: '^(?!.*(large|massive|ultra|Dataset)).*$',
    globals: true,
    environment: 'node'
  }
});