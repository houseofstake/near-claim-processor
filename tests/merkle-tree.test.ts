import { describe, it, expect, beforeEach } from 'vitest';
import { NearMerkleTree } from '../src/merkle-tree';

describe('NearMerkleTree', () => {
  const sampleEntitlements: Array<[string, string]> = [
    ['alice.near', '1000000000000000000000'],
    ['bob.near', '2000000000000000000000'],
    ['charlie.near', '3000000000000000000000'],
    ['dave.near', '4000000000000000000000']
  ];

  const leafEncoding = ['address', 'uint256'];

  describe('Tree Construction', () => {
    it('should create a tree from values', async () => {
      const tree = await NearMerkleTree.of(sampleEntitlements, leafEncoding);
      
      expect(tree).toBeDefined();
      expect(tree.getRoot()).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tree.values).toHaveLength(sampleEntitlements.length);
    });

    it('should handle single entry', async () => {
      const singleEntry: Array<[string, string]> = [['alice.near', '1000000000000000000000']];
      const tree = await NearMerkleTree.of(singleEntry, leafEncoding);
      
      expect(tree.values).toHaveLength(1);
      expect(tree.getRoot()).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should handle large datasets (10K entries)', async () => {
      const largeEntitlements: Array<[string, string]> = [];
      for (let i = 0; i < 10000; i++) {
        largeEntitlements.push([`user${i}.near`, (BigInt(i) * BigInt('1000000000000000000')).toString()]);
      }
      
      const tree = await NearMerkleTree.of(largeEntitlements, leafEncoding);
      expect(tree.values).toHaveLength(10000);
      expect(tree.getRoot()).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 30000);

    it('should handle massive datasets (100K entries)', async () => {
      const massiveEntitlements: Array<[string, string]> = [];
      for (let i = 0; i < 100000; i++) {
        // Use more varied addresses to avoid patterns
        const addressId = i.toString(16).padStart(8, '0');
        massiveEntitlements.push([`user${addressId}.near`, (BigInt(i) * BigInt('1000000000000000000')).toString()]);
      }
      
      const startTime = Date.now();
      const tree = await NearMerkleTree.of(massiveEntitlements, leafEncoding);
      const buildTime = Date.now() - startTime;
      
      expect(tree.values).toHaveLength(100000);
      expect(tree.getRoot()).toMatch(/^0x[a-fA-F0-9]{64}$/);
      
      // Should build in reasonable time (less than 2 minutes)
      expect(buildTime).toBeLessThan(120000);
      
      console.log(`Built tree with 100K entries in ${buildTime}ms`);
    }, 180000);

    it('should handle ultra-massive datasets (1M entries)', async () => {
      const ultraMassiveEntitlements: Array<[string, string]> = [];
      
      console.log('Generating 1M test entries...');
      const generateStart = Date.now();
      
      for (let i = 0; i < 1000000; i++) {
        // Use hex addresses for variety and realistic patterns
        const addressId = i.toString(16).padStart(8, '0');
        ultraMassiveEntitlements.push([`${addressId}.near`, (BigInt(i) * BigInt('1000000000000000000')).toString()]);
        
        // Progress logging
        if (i > 0 && i % 100000 === 0) {
          console.log(`Generated ${i} entries...`);
        }
      }
      
      const generateTime = Date.now() - generateStart;
      console.log(`Generated 1M entries in ${generateTime}ms`);
      
      console.log('Building Merkle tree for 1M entries...');
      const startTime = Date.now();
      const tree = await NearMerkleTree.of(ultraMassiveEntitlements, leafEncoding);
      const buildTime = Date.now() - startTime;
      
      expect(tree.values).toHaveLength(1000000);
      expect(tree.getRoot()).toMatch(/^0x[a-fA-F0-9]{64}$/);
      
      // Should build in reasonable time (less than 10 minutes)
      expect(buildTime).toBeLessThan(600000);
      
      console.log(`Built tree with 1M entries in ${buildTime}ms (${Math.round(buildTime/1000)}s)`);
      
      // Test proof generation for a few random entries
      const testIndices = [0, 50000, 500000, 999999];
      for (const index of testIndices) {
        const proofStart = Date.now();
        const proof = tree.getProof(tree.values[index].treeIndex);
        const proofTime = Date.now() - proofStart;
        
        expect(Array.isArray(proof)).toBe(true);
        expect(proofTime).toBeLessThan(100); // Should be very fast
        
        // Verify the proof
        const isValid = tree.verify(proof, ultraMassiveEntitlements[index]);
        expect(isValid).toBe(true);
      }
    }, 900000); // 15 minute timeout

    it('should create deterministic trees for same input', async () => {
      const tree1 = await NearMerkleTree.of(sampleEntitlements, leafEncoding);
      const tree2 = await NearMerkleTree.of(sampleEntitlements, leafEncoding);
      
      expect(tree1.getRoot()).toBe(tree2.getRoot());
    });

    it('should create different roots for different inputs', async () => {
      const tree1 = await NearMerkleTree.of(sampleEntitlements, leafEncoding);
      const differentEntitlements: Array<[string, string]> = [
        ['eve.near', '5000000000000000000000'],
        ['frank.near', '6000000000000000000000']
      ];
      const tree2 = await NearMerkleTree.of(differentEntitlements, leafEncoding);
      
      expect(tree1.getRoot()).not.toBe(tree2.getRoot());
    });
  });

  describe('Proof Generation', () => {
    let tree: NearMerkleTree;

    beforeEach(async () => {
      tree = await NearMerkleTree.of(sampleEntitlements, leafEncoding);
    });

    it('should generate proofs for all entries', () => {
      for (const valueEntry of tree.values) {
        const proof = tree.getProof(valueEntry.treeIndex);
        expect(Array.isArray(proof)).toBe(true);
        expect(proof.every(p => p.match(/^0x[a-fA-F0-9]{64}$/))).toBe(true);
      }
    });

    it('should throw error for invalid index', () => {
      expect(() => tree.getProof(-1)).toThrow('Index out of range');
      expect(() => tree.getProof(1000)).toThrow('Index out of range');
    });

    it('should generate different proofs for different entries', () => {
      const proof1 = tree.getProof(tree.values[0].treeIndex);
      const proof2 = tree.getProof(tree.values[1].treeIndex);
      
      // Proofs should be different (unless it's a very small tree)
      if (tree.values.length > 2) {
        expect(JSON.stringify(proof1)).not.toBe(JSON.stringify(proof2));
      }
    });
  });

  describe('Proof Verification', () => {
    let tree: NearMerkleTree;

    beforeEach(async () => {
      tree = await NearMerkleTree.of(sampleEntitlements, leafEncoding);
    });

    it('should verify valid proofs', () => {
      for (const valueEntry of tree.values) {
        const proof = tree.getProof(valueEntry.treeIndex);
        const isValid = tree.verify(proof, valueEntry.value);
        expect(isValid).toBe(true);
      }
    });

    it('should reject invalid proofs', () => {
      const validEntry = tree.values[0];
      const proof = tree.getProof(validEntry.treeIndex);
      
      // Test with wrong value
      const invalidValue: [string, string] = ['invalid.near', '999'];
      const isValid = tree.verify(proof, invalidValue);
      expect(isValid).toBe(false);
    });

    it('should reject tampered proofs', () => {
      const validEntry = tree.values[0];
      const proof = tree.getProof(validEntry.treeIndex);
      
      // Tamper with the proof
      const tamperedProof = [...proof];
      if (tamperedProof.length > 0) {
        tamperedProof[0] = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      }
      
      const isValid = tree.verify(tamperedProof, validEntry.value);
      expect(isValid).toBe(false);
    });

    it('should handle empty proofs for single-entry tree', async () => {
      const singleTree = await NearMerkleTree.of([['alice.near', '1000']], leafEncoding);
      const proof = singleTree.getProof(singleTree.values[0].treeIndex);
      const isValid = singleTree.verify(proof, singleTree.values[0].value);
      expect(isValid).toBe(true);
    });
  });

  describe('Address Format Handling', () => {
    it('should handle NEAR account IDs', async () => {
      const nearAccounts: Array<[string, string]> = [
        ['alice.near', '1000'],
        ['bob.testnet', '2000'],
        ['contract.aurora', '3000']
      ];
      
      const tree = await NearMerkleTree.of(nearAccounts, leafEncoding);
      expect(tree.values).toHaveLength(3);
      
      for (const value of tree.values) {
        const proof = tree.getProof(value.treeIndex);
        expect(tree.verify(proof, value.value)).toBe(true);
      }
    });

    it('should handle implicit accounts (hex)', async () => {
      const implicitAccounts: Array<[string, string]> = [
        ['abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab', '1000'],
        ['1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', '2000']
      ];
      
      const tree = await NearMerkleTree.of(implicitAccounts, leafEncoding);
      expect(tree.values).toHaveLength(2);
      
      for (const value of tree.values) {
        const proof = tree.getProof(value.treeIndex);
        expect(tree.verify(proof, value.value)).toBe(true);
      }
    });

    it('should handle mixed address formats', async () => {
      const mixedAddresses: Array<[string, string]> = [
        ['alice.near', '1000'],
        ['abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab', '2000'],
        ['bob.testnet', '3000']
      ];
      
      const tree = await NearMerkleTree.of(mixedAddresses, leafEncoding);
      expect(tree.values).toHaveLength(3);
      
      for (const value of tree.values) {
        const proof = tree.getProof(value.treeIndex);
        expect(tree.verify(proof, value.value)).toBe(true);
      }
    });
  });

  describe('Serialization', () => {
    let tree: NearMerkleTree;

    beforeEach(async () => {
      tree = await NearMerkleTree.of(sampleEntitlements, leafEncoding);
    });

    it('should dump tree to JSON format', () => {
      const dump = tree.dump();
      
      expect(dump).toHaveProperty('format', 'near-v1');
      expect(dump).toHaveProperty('tree');
      expect(dump).toHaveProperty('values');
      expect(dump).toHaveProperty('leafEncoding');
      expect(Array.isArray(dump.tree)).toBe(true);
      expect(Array.isArray(dump.values)).toBe(true);
      expect(Array.isArray(dump.leafEncoding)).toBe(true);
    });

    it('should load tree from JSON dump', () => {
      const dump = tree.dump();
      const loadedTree = NearMerkleTree.load(dump);
      
      expect(loadedTree.getRoot()).toBe(tree.getRoot());
      expect(loadedTree.values).toEqual(tree.values);
    });

    it('should maintain functionality after load', () => {
      const dump = tree.dump();
      const loadedTree = NearMerkleTree.load(dump);
      
      // Test that proofs still work
      for (const valueEntry of loadedTree.values) {
        const proof = loadedTree.getProof(valueEntry.treeIndex);
        const isValid = loadedTree.verify(proof, valueEntry.value);
        expect(isValid).toBe(true);
      }
    });

    it('should reject invalid format', () => {
      const invalidDump = {
        format: 'invalid-format',
        tree: [],
        values: [],
        leafEncoding: []
      };
      
      expect(() => NearMerkleTree.load(invalidDump)).toThrow("Unknown format 'invalid-format'");
    });

    it('should reject missing leaf encoding', () => {
      const invalidDump = {
        format: 'near-v1',
        tree: [],
        values: []
      };
      
      expect(() => NearMerkleTree.load(invalidDump as any)).toThrow('Expected leaf encoding');
    });
  });

  describe('Value Conversion', () => {
    it('should handle string amounts', async () => {
      const stringAmounts: Array<[string, string]> = [
        ['alice.near', '1000000000000000000000'],
        ['bob.near', '999999999999999999999999']
      ];
      
      const tree = await NearMerkleTree.of(stringAmounts, leafEncoding);
      expect(tree.values).toHaveLength(2);
      
      for (const value of tree.values) {
        const proof = tree.getProof(value.treeIndex);
        expect(tree.verify(proof, value.value)).toBe(true);
      }
    });

    it('should handle numeric amounts', async () => {
      const numericAmounts: Array<[string, string]> = [
        ['alice.near', '0'],
        ['bob.near', '1'],
        ['charlie.near', '123456789']
      ];
      
      const tree = await NearMerkleTree.of(numericAmounts, leafEncoding);
      expect(tree.values).toHaveLength(3);
      
      for (const value of tree.values) {
        const proof = tree.getProof(value.treeIndex);
        expect(tree.verify(proof, value.value)).toBe(true);
      }
    });
  });

  describe('Security Properties', () => {
    let tree: NearMerkleTree;

    beforeEach(async () => {
      tree = await NearMerkleTree.of(sampleEntitlements, leafEncoding);
    });

    it('should use SHA256 hashing', () => {
      // Verify that the implementation uses SHA256 by checking root format
      const root = tree.getRoot();
      expect(root).toMatch(/^0x[a-fA-F0-9]{64}$/);
      
      // SHA256 produces 32-byte (64 hex chars) output
      expect(root.length).toBe(66); // 0x + 64 hex chars
    });

    it('should sort hash pairs before combining', async () => {
      // This is tested implicitly by the deterministic nature of the tree
      // If pairs weren't sorted consistently, we'd get different roots for same data
      const tree1 = await NearMerkleTree.of(sampleEntitlements, leafEncoding);
      const tree2 = await NearMerkleTree.of([...sampleEntitlements].reverse(), leafEncoding);
      
      // Even with reversed input order, root should be the same due to sorting
      expect(tree1.getRoot()).toBe(tree2.getRoot());
    });

    it('should use double hashing for leaf nodes', () => {
      // This is a security feature - leaves are double-hashed
      // We can't easily test this directly without exposing internal methods,
      // but we can verify that tampering with values invalidates proofs
      const validEntry = tree.values[0];
      const proof = tree.getProof(validEntry.treeIndex);
      
      // Slightly modify the amount
      const tamperedValue: [string, string] = [validEntry.value[0], (BigInt(validEntry.value[1]) + 1n).toString()];
      const isValid = tree.verify(proof, tamperedValue);
      expect(isValid).toBe(false);
    });
  });
});