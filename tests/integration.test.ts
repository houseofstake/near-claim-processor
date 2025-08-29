import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { NearMerkleTree } from '../src/merkle-tree';
import { LocalStorage } from '../src/storage';

describe('Integration Tests', () => {
  let storage: LocalStorage;
  const testDataPath = './test-integration-data';

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

  describe('End-to-End Claim Processing', () => {
    const projectId = 'integration-test';
    const entitlements: Array<[string, string]> = [
      ['alice.near', '1000000000000000000000'],
      ['bob.near', '2000000000000000000000'],
      ['charlie.near', '3000000000000000000000'],
      ['dave.near', '4000000000000000000000'],
      ['eve.near', '5000000000000000000000']
    ];

    it('should complete full processing workflow', async () => {
      // Step 1: Create Merkle tree
      const tree = await NearMerkleTree.of(entitlements, ['address', 'uint256']);
      
      // Step 2: Store tree data
      await storage.storeJSON(`project-tree/${projectId}.json`, tree.dump());
      
      // Step 3: Generate and store all proofs
      const proofTasks = [];
      for (const valueEntry of tree.values) {
        const address = valueEntry.value[0];
        const proof = tree.getProof(valueEntry.treeIndex);
        
        const proofData = {
          ...valueEntry,
          proof
        };

        proofTasks.push({
          key: `v1/proof/${projectId}/${address.toLowerCase()}.json`,
          data: proofData
        });
      }
      
      await storage.storeBatch(proofTasks);
      
      // Step 4: Verify tree can be loaded
      const storedTreeData = await storage.retrieveJSON(`project-tree/${projectId}.json`);
      expect(storedTreeData).toBeDefined();
      
      const loadedTree = NearMerkleTree.load(storedTreeData as any);
      expect(loadedTree.getRoot()).toBe(tree.getRoot());
      
      // Step 5: Verify all proofs can be retrieved and validated
      for (const entitlement of entitlements) {
        const [address, amount] = entitlement;
        const proofData = await storage.retrieveJSON(`v1/proof/${projectId}/${address.toLowerCase()}.json`);
        
        expect(proofData).toBeDefined();
        expect((proofData as any).value).toEqual([address, amount]);
        expect(Array.isArray((proofData as any).proof)).toBe(true);
        
        // Verify proof with loaded tree
        const isValid = loadedTree.verify((proofData as any).proof, [address, amount]);
        expect(isValid).toBe(true);
      }
    });

    it('should handle large-scale processing', async () => {
      const largeEntitlements: Array<[string, string]> = [];
      for (let i = 0; i < 500; i++) {
        largeEntitlements.push([`user${i}.near`, (BigInt(i) * BigInt('1000000000000000000')).toString()]);
      }

      // Create tree
      const tree = await NearMerkleTree.of(largeEntitlements, ['address', 'uint256']);
      
      // Store tree
      await storage.storeJSON(`project-tree/large-${projectId}.json`, tree.dump());
      
      // Generate proofs in batches
      const batchSize = 50;
      for (let i = 0; i < tree.values.length; i += batchSize) {
        const batch = tree.values.slice(i, i + batchSize);
        const batchProofs = batch.map(valueEntry => {
          const address = valueEntry.value[0];
          const proof = tree.getProof(valueEntry.treeIndex);
          
          return {
            key: `v1/proof/large-${projectId}/${address.toLowerCase()}.json`,
            data: { ...valueEntry, proof }
          };
        });
        
        await storage.storeBatch(batchProofs);
      }
      
      // Verify random subset
      const randomIndices = [0, 50, 100, 250, 499];
      for (const i of randomIndices) {
        const [address, amount] = largeEntitlements[i];
        const proofData = await storage.retrieveJSON(`v1/proof/large-${projectId}/${address.toLowerCase()}.json`);
        
        expect(proofData).toBeDefined();
        const isValid = tree.verify((proofData as any).proof, [address, amount]);
        expect(isValid).toBe(true);
      }
    }, 20000);

    it('should maintain data integrity across operations', async () => {
      // Create initial tree
      const tree1 = await NearMerkleTree.of(entitlements, ['address', 'uint256']);
      const root1 = tree1.getRoot();
      
      // Store and reload
      await storage.storeJSON(`integrity-test.json`, tree1.dump());
      const loadedData = await storage.retrieveJSON(`integrity-test.json`);
      const tree2 = NearMerkleTree.load(loadedData as any);
      const root2 = tree2.getRoot();
      
      // Roots should be identical
      expect(root2).toBe(root1);
      
      // Generate proofs with both trees
      for (let i = 0; i < entitlements.length; i++) {
        const value = entitlements[i];
        const treeIndex1 = tree1.values[i].treeIndex;
        const treeIndex2 = tree2.values[i].treeIndex;
        
        expect(treeIndex2).toBe(treeIndex1);
        
        const proof1 = tree1.getProof(treeIndex1);
        const proof2 = tree2.getProof(treeIndex2);
        
        expect(proof2).toEqual(proof1);
        
        // Both proofs should verify against both trees
        expect(tree1.verify(proof1, value)).toBe(true);
        expect(tree2.verify(proof2, value)).toBe(true);
        expect(tree1.verify(proof2, value)).toBe(true);
        expect(tree2.verify(proof1, value)).toBe(true);
      }
    });
  });

  describe('Cross-Verification Tests', () => {
    it('should verify proofs generated by different tree instances', async () => {
      const entitlements: Array<[string, string]> = [
        ['alice.near', '1000000000000000000000'],
        ['bob.near', '2000000000000000000000']
      ];

      // Create two independent trees with same data
      const tree1 = await NearMerkleTree.of(entitlements, ['address', 'uint256']);
      const tree2 = await NearMerkleTree.of([...entitlements], ['address', 'uint256']);

      // Trees should have same root
      expect(tree2.getRoot()).toBe(tree1.getRoot());

      // Proofs from tree1 should verify against tree2 and vice versa
      for (let i = 0; i < entitlements.length; i++) {
        const value = entitlements[i];
        const proof1 = tree1.getProof(tree1.values[i].treeIndex);
        const proof2 = tree2.getProof(tree2.values[i].treeIndex);

        expect(tree1.verify(proof2, value)).toBe(true);
        expect(tree2.verify(proof1, value)).toBe(true);
      }
    });

    it('should detect tampering across different scenarios', async () => {
      const entitlements: Array<[string, string]> = [
        ['alice.near', '1000000000000000000000'],
        ['bob.near', '2000000000000000000000'],
        ['charlie.near', '3000000000000000000000']
      ];

      const tree = await NearMerkleTree.of(entitlements, ['address', 'uint256']);
      const validProof = tree.getProof(tree.values[0].treeIndex);
      const validValue = entitlements[0];

      // Test various tampering scenarios
      const tamperingTests = [
        // Wrong address
        { value: ['eve.near', validValue[1]], should: 'fail' },
        // Wrong amount
        { value: [validValue[0], '999999999999999999999'], should: 'fail' },
        // Both wrong
        { value: ['eve.near', '999999999999999999999'], should: 'fail' },
        // Correct value
        { value: validValue, should: 'pass' }
      ];

      for (const test of tamperingTests) {
        const result = tree.verify(validProof, test.value as any);
        if (test.should === 'pass') {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }
    });
  });

  describe('Storage Consistency Tests', () => {
    it('should maintain consistency across multiple storage operations', async () => {
      const baseKey = 'consistency-test';
      const data = { test: true, timestamp: Date.now() };

      // Store data
      await storage.storeData(baseKey, data);

      // Read multiple times
      const reads = await Promise.all([
        storage.retrieveData(baseKey),
        storage.retrieveData(baseKey),
        storage.retrieveData(baseKey)
      ]);

      reads.forEach(result => {
        expect(result).toEqual(data);
      });

      // Modify and store again
      const updatedData = { ...data, updated: true };
      await storage.storeData(baseKey, updatedData);

      // Verify update
      const finalResult = await storage.retrieveData(baseKey);
      expect(finalResult).toEqual(updatedData);
    });

    it('should handle concurrent batch operations', async () => {
      const batch1 = Array.from({ length: 50 }, (_, i) => ({
        key: `batch1-${i}`,
        data: { batch: 1, index: i }
      }));

      const batch2 = Array.from({ length: 50 }, (_, i) => ({
        key: `batch2-${i}`,
        data: { batch: 2, index: i }
      }));

      // Store batches concurrently
      await Promise.all([
        storage.storeBatch(batch1),
        storage.storeBatch(batch2)
      ]);

      // Verify all items were stored correctly
      const verificationPromises = [
        ...batch1.map(async item => {
          const result = await storage.retrieveData(item.key);
          expect(result).toEqual(item.data);
        }),
        ...batch2.map(async item => {
          const result = await storage.retrieveData(item.key);
          expect(result).toEqual(item.data);
        })
      ];

      await Promise.all(verificationPromises);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle increasing dataset sizes efficiently', async () => {
      const sizes = [10, 50, 100, 250];
      const results: Array<{ size: number; time: number }> = [];

      for (const size of sizes) {
        const entitlements: Array<[string, string]> = Array.from(
          { length: size },
          (_, i) => [`user${i}.near`, (BigInt(i) * BigInt('1000000000000000000')).toString()]
        );

        const startTime = Date.now();
        const tree = await NearMerkleTree.of(entitlements, ['address', 'uint256']);
        
        // Verify a few proofs to ensure correctness
        for (let i = 0; i < Math.min(5, size); i++) {
          const proof = tree.getProof(tree.values[i].treeIndex);
          const isValid = tree.verify(proof, entitlements[i]);
          expect(isValid).toBe(true);
        }
        
        const endTime = Date.now();
        results.push({ size, time: endTime - startTime });
      }

      // Performance should scale reasonably (not exponentially)
      for (let i = 1; i < results.length; i++) {
        const prevResult = results[i - 1];
        const currentResult = results[i];
        const sizeRatio = currentResult.size / prevResult.size;
        const timeRatio = prevResult.time > 0 ? currentResult.time / prevResult.time : 1;

        // Time should not grow more than quadratically with size (unless very fast)
        if (prevResult.time > 10 && currentResult.time > 10) {
          expect(timeRatio).toBeLessThan(sizeRatio * sizeRatio);
        }
      }
    }, 30000);

    it('should efficiently handle proof generation for large trees', async () => {
      const size = 1000;
      const entitlements: Array<[string, string]> = Array.from(
        { length: size },
        (_, i) => [`user${i}.near`, (BigInt(i) * BigInt('1000000000000000000')).toString()]
      );

      const tree = await NearMerkleTree.of(entitlements, ['address', 'uint256']);

      // Time proof generation for multiple addresses
      const proofTimes: number[] = [];
      const testIndices = [0, 100, 500, 900, 999];

      for (const index of testIndices) {
        const startTime = Date.now();
        const proof = tree.getProof(tree.values[index].treeIndex);
        const endTime = Date.now();
        
        proofTimes.push(endTime - startTime);
        
        // Verify proof correctness
        const isValid = tree.verify(proof, entitlements[index]);
        expect(isValid).toBe(true);
      }

      // All proof generations should be fast (under 100ms each)
      proofTimes.forEach(time => {
        expect(time).toBeLessThan(100);
      });

      // Proof times should be consistent regardless of position in tree
      const maxTime = Math.max(...proofTimes);
      const minTime = Math.min(...proofTimes);
      if (minTime > 0 && maxTime > 0) {
        expect(maxTime / minTime).toBeLessThan(10); // At most 10x difference
      }
    }, 15000);
  });
});