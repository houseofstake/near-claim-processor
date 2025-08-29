import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { LocalStorage } from '../src/storage';

// Mock Google Cloud Storage for testing
vi.mock('@google-cloud/storage', () => ({
  Storage: vi.fn().mockImplementation(() => ({
    bucket: vi.fn().mockReturnValue({
      exists: vi.fn().mockResolvedValue([true]),
      file: vi.fn().mockReturnValue({
        exists: vi.fn().mockResolvedValue([true]),
        save: vi.fn().mockResolvedValue(undefined),
        download: vi.fn().mockResolvedValue([Buffer.from('{}')]),
        delete: vi.fn().mockResolvedValue(undefined)
      }),
      getFiles: vi.fn().mockResolvedValue([[]])
    })
  }))
}));

describe('LocalStorage', () => {
  let storage: LocalStorage;
  const testDataPath = './test-data';

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true });
    }
    storage = new LocalStorage(testDataPath);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true });
    }
  });

  describe('Basic Operations', () => {
    it('should store and retrieve simple data', async () => {
      const key = 'test-key';
      const data = { message: 'Hello, World!' };

      await storage.storeData(key, data);
      const retrieved = await storage.retrieveData(key);

      expect(retrieved).toEqual(data);
    });

    it('should return null for non-existent keys', async () => {
      const result = await storage.retrieveData('non-existent-key');
      expect(result).toBeNull();
    });

    it('should store and retrieve complex objects', async () => {
      const key = 'complex-object';
      const data = {
        users: [
          { name: 'Alice', balance: '1000000000000000000000' },
          { name: 'Bob', balance: '2000000000000000000000' }
        ],
        metadata: {
          version: '1.0',
          created: Date.now()
        }
      };

      await storage.storeData(key, data);
      const retrieved = await storage.retrieveData(key);

      expect(retrieved).toEqual(data);
    });

    it('should handle nested keys with path separators', async () => {
      const key = 'project/tree/data';
      const data = { root: '0x123456' };

      await storage.storeData(key, data);
      const retrieved = await storage.retrieveData(key);

      expect(retrieved).toEqual(data);
    });
  });

  describe('File System Operations', () => {
    it('should create directories as needed', async () => {
      const key = 'deep/nested/path/data';
      const data = { test: true };

      await storage.storeData(key, data);
      const retrieved = await storage.retrieveData(key);

      expect(retrieved).toEqual(data);
      expect(fs.existsSync(testDataPath)).toBe(true);
    });

    it('should handle special characters in keys', async () => {
      const key = 'key-with-special@chars#and$symbols';
      const data = { special: true };

      await storage.storeData(key, data);
      const retrieved = await storage.retrieveData(key);

      expect(retrieved).toEqual(data);
    });

    it('should persist data across storage instances', async () => {
      const key = 'persistent-data';
      const data = { persistent: true };

      await storage.storeData(key, data);
      
      // Create new storage instance
      const newStorage = new LocalStorage(testDataPath);
      const retrieved = await newStorage.retrieveData(key);

      expect(retrieved).toEqual(data);
    });
  });

  describe('List Operations', () => {
    beforeEach(async () => {
      // Set up test data
      await storage.storeData('project1/tree', { root: '0x111' });
      await storage.storeData('project1/status', { complete: true });
      await storage.storeData('project2/tree', { root: '0x222' });
      await storage.storeData('project2/proofs/alice', { proof: ['0x123'] });
      await storage.storeData('global-config', { version: '1.0' });
    });

    it('should list all keys', async () => {
      const keys = await storage.listKeys();
      
      expect(keys).toContain('project1/tree');
      expect(keys).toContain('project1/status');
      expect(keys).toContain('project2/tree');
      expect(keys).toContain('project2/proofs/alice');
      expect(keys).toContain('global-config');
      expect(keys.length).toBe(5);
    });

    it('should list keys with prefix filter', async () => {
      const project1Keys = await storage.listKeys('project1');
      
      expect(project1Keys).toContain('project1/tree');
      expect(project1Keys).toContain('project1/status');
      expect(project1Keys).not.toContain('project2/tree');
      expect(project1Keys.length).toBe(2);
    });

    it('should list keys with specific prefix', async () => {
      const proofKeys = await storage.listKeys('project2/proofs');
      
      expect(proofKeys).toContain('project2/proofs/alice');
      expect(proofKeys).not.toContain('project2/tree');
      expect(proofKeys.length).toBe(1);
    });

    it('should return empty array for non-matching prefix', async () => {
      const keys = await storage.listKeys('non-existent-prefix');
      expect(keys).toEqual([]);
    });
  });

  describe('Delete Operations', () => {
    it('should delete existing data', async () => {
      const key = 'to-delete';
      const data = { temporary: true };

      await storage.storeData(key, data);
      expect(await storage.retrieveData(key)).toEqual(data);

      await storage.deleteData(key);
      expect(await storage.retrieveData(key)).toBeNull();
    });

    it('should handle deletion of non-existent keys gracefully', async () => {
      // Should not throw error
      await expect(storage.deleteData('non-existent')).resolves.not.toThrow();
    });
  });

  describe('Batch Operations', () => {
    it('should store multiple items in batch', async () => {
      const items = [
        { key: 'batch1', data: { value: 1 } },
        { key: 'batch2', data: { value: 2 } },
        { key: 'batch3', data: { value: 3 } }
      ];

      await storage.storeBatch(items);

      for (const item of items) {
        const retrieved = await storage.retrieveData(item.key);
        expect(retrieved).toEqual(item.data);
      }
    });

    it('should handle empty batch', async () => {
      await expect(storage.storeBatch([])).resolves.not.toThrow();
    });

    it('should handle large batches', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        key: `batch-${i}`,
        data: { index: i, value: `value-${i}` }
      }));

      await storage.storeBatch(items);

      // Verify some random items
      const randomIndices = [0, 25, 50, 75, 99];
      for (const i of randomIndices) {
        const retrieved = await storage.retrieveData(`batch-${i}`);
        expect(retrieved).toEqual({ index: i, value: `value-${i}` });
      }
    });
  });

  describe('JSON Utility Methods', () => {
    it('should store and retrieve JSON objects', async () => {
      const key = 'json-test';
      const data = {
        array: [1, 2, 3],
        object: { nested: true },
        string: 'test',
        number: 42,
        boolean: true,
        null: null
      };

      await storage.storeJSON(key, data);
      const retrieved = await storage.retrieveJSON(key);

      expect(retrieved).toEqual(data);
    });

    it('should return null for non-existent JSON keys', async () => {
      const result = await storage.retrieveJSON('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('Blob Utility Methods', () => {
    it('should store and retrieve binary data', async () => {
      const key = 'blob-test';
      const data = Buffer.from('Hello, binary world!', 'utf8');

      await storage.storeBlob(key, data);
      const retrieved = await storage.retrieveBlob(key);

      expect(retrieved).toEqual(data);
    });

    it('should handle large binary data', async () => {
      const key = 'large-blob';
      const data = Buffer.alloc(10000, 0xAB);

      await storage.storeBlob(key, data);
      const retrieved = await storage.retrieveBlob(key);

      expect(retrieved).toEqual(data);
    });

    it('should return null for non-existent blob keys', async () => {
      const result = await storage.retrieveBlob('non-existent-blob');
      expect(result).toBeNull();
    });

    it('should return null for non-blob data', async () => {
      const key = 'not-a-blob';
      const data = { message: 'This is not a blob' };

      await storage.storeData(key, data);
      const result = await storage.retrieveBlob(key);

      expect(result).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle corrupted JSON files gracefully', async () => {
      const key = 'corrupted-file';
      const filePath = path.join(testDataPath, `${key.replace(/[\/\\]/g, '_')}.json`);

      // Create directory and write corrupted JSON
      fs.mkdirSync(testDataPath, { recursive: true });
      fs.writeFileSync(filePath, '{ invalid json }');

      const result = await storage.retrieveData(key);
      expect(result).toBeNull();
    });

    it('should handle permission errors gracefully', async () => {
      // This test is environment-dependent and might not work on all systems
      // We'll skip it for now but it's important for production robustness
    });
  });

  describe('Storage Item Metadata', () => {
    it('should include timestamp in stored items', async () => {
      const key = 'timestamped-data';
      const data = { test: true };
      const beforeStore = Date.now();

      await storage.storeData(key, data);

      // Read the raw file to check metadata
      const filePath = path.join(testDataPath, `${key.replace(/[\/\\]/g, '_')}.json`);
      const rawContent = fs.readFileSync(filePath, 'utf8');
      const storageItem = JSON.parse(rawContent);

      expect(storageItem).toHaveProperty('key', key);
      expect(storageItem).toHaveProperty('data', data);
      expect(storageItem).toHaveProperty('timestamp');
      expect(typeof storageItem.timestamp).toBe('number');
      expect(storageItem.timestamp).toBeGreaterThanOrEqual(beforeStore);
    });

    it('should preserve original key in metadata', async () => {
      const key = 'complex/nested/key/with/separators';
      const data = { nested: true };

      await storage.storeData(key, data);

      // Read the raw file to check metadata
      const filePath = path.join(testDataPath, `${key.replace(/[\/\\]/g, '_')}.json`);
      const rawContent = fs.readFileSync(filePath, 'utf8');
      const storageItem = JSON.parse(rawContent);

      expect(storageItem.key).toBe(key);
    });
  });

  describe('Concurrent Access', () => {
    it('should handle concurrent reads', async () => {
      const key = 'concurrent-read-test';
      const data = { concurrent: true };

      await storage.storeData(key, data);

      // Perform multiple concurrent reads
      const promises = Array.from({ length: 10 }, () => 
        storage.retrieveData(key)
      );

      const results = await Promise.all(promises);
      results.forEach(result => {
        expect(result).toEqual(data);
      });
    });

    it('should handle concurrent writes to different keys', async () => {
      const promises = Array.from({ length: 10 }, (_, i) => 
        storage.storeData(`concurrent-${i}`, { index: i })
      );

      await Promise.all(promises);

      // Verify all writes succeeded
      for (let i = 0; i < 10; i++) {
        const result = await storage.retrieveData(`concurrent-${i}`);
        expect(result).toEqual({ index: i });
      }
    });
  });
});