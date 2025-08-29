import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import * as fs from 'fs';
import { NearClaimProcessor } from '../src/processor';
import { LocalStorage } from '../src/storage';
import { DatabaseService } from '../src/database';
import { NearMerkleTree } from '../src/merkle-tree';
import { entitlementsToCSV } from '../src/utils';

// Mock Google Cloud Storage
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

// Mock Prisma client
const mockProjects = new Map();
const mockProofs = new Map();

const mockPrisma = {
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  project: {
    create: vi.fn().mockImplementation(({ data }) => {
      const project = { ...data, createdAt: new Date(), updatedAt: new Date() };
      mockProjects.set(data.id, project);
      return Promise.resolve(project);
    }),
    update: vi.fn().mockImplementation(({ where, data }) => {
      const project = mockProjects.get(where.id);
      if (project) {
        const updated = { ...project, ...data, updatedAt: new Date() };
        mockProjects.set(where.id, updated);
        return Promise.resolve(updated);
      }
      return Promise.resolve(null);
    }),
    findUnique: vi.fn().mockImplementation(({ where }) => {
      const project = mockProjects.get(where.id);
      return Promise.resolve(project || null);
    }),
    findMany: vi.fn().mockImplementation(() => {
      return Promise.resolve(Array.from(mockProjects.values()));
    }),
  },
  proof: {
    createMany: vi.fn().mockImplementation(({ data }) => {
      data.forEach((proof: any) => {
        const key = `${proof.projectId}:${proof.address}`;
        mockProofs.set(key, { ...proof, claimed: false, createdAt: new Date() });
      });
      return Promise.resolve({ count: data.length });
    }),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
    groupBy: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
  },
};

const clearMocks = () => {
  mockProjects.clear();
  mockProofs.clear();
};

vi.mock('../src/generated/prisma', () => ({
  PrismaClient: vi.fn().mockImplementation(() => mockPrisma),
}));

describe('Manual Verification Tests', () => {
  let processor: NearClaimProcessor;
  let storage: LocalStorage;
  let database: DatabaseService;
  const testDataPath = './test-manual-verification';
  
  beforeEach(async () => {
    // Set up test API key
    process.env.API_KEY = 'test-api-key';
    
    // Clear mock data
    clearMocks();
    
    // Clean up test directory
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }
    
    storage = new LocalStorage(testDataPath);
    database = new DatabaseService();
    await database.initialize();
    
    processor = new NearClaimProcessor({
      storage,
      database,
      useLocalStorage: true
    });
  });

  afterEach(async () => {
    // Clean up test directory
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  describe('Simple 3-Address Test for Manual Verification', () => {
    it('should generate verifiable proofs for 3 addresses with known values', async () => {
      const projectId = 'simple-test';
      const entitlements = [
        { address: 'alice.near', amount: '100' },
        { address: 'bob.near', amount: '200' },
        { address: 'charlie.near', amount: '300' }
      ]; 

      console.log('\n🔍 MANUAL VERIFICATION TEST');
      console.log('============================');
      console.log('Project ID:', projectId);
      console.log('Entitlements:');
      entitlements.forEach((e, i) => {
        console.log(`  ${i}: ${e.address} -> ${e.amount}`);
      });

      // Upload entitlements
      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(entitlementsToCSV(entitlements))
        .expect(200);

      // Process
      await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      // Wait for completion
      let attempts = 0;
      let finalResponse: any;
      while (attempts < 20) {
        const response = await request(processor.getApp())
          .get(`/root?project_id=${projectId}`)
          .set('X-API-Key', 'test-api-key');
        
        finalResponse = response.body;
        if (finalResponse.status === 'complete') break;
        
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      expect(finalResponse.status).toBe('complete');
      
      console.log('\n📊 PROCESSING RESULTS:');
      console.log('Root Hash:', finalResponse.root);
      console.log('Total Entitlements:', finalResponse.numEntitlements);
      console.log('Total Claim Value:', finalResponse.totalClaimValue);

      // Get tree structure for manual verification
      const treeResponse = await request(processor.getApp())
        .get(`/tree/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      console.log('\n🌳 TREE STRUCTURE:');
      console.log('Format:', treeResponse.body.format);
      console.log('Tree layers:', treeResponse.body.tree.length);
      console.log('Tree nodes:');
      treeResponse.body.tree.forEach((node: string, i: number) => {
        console.log(`  [${i}]: ${node}`);
      });

      console.log('\n📝 VALUES:');
      treeResponse.body.values.forEach((val: any, i: number) => {
        console.log(`  [${i}]: Address=${val.value[0]}, Amount=${val.value[1]}, TreeIndex=${val.treeIndex}`);
      });

      // Get individual proofs for manual verification
      console.log('\n🔐 INDIVIDUAL PROOFS:');
      for (const entitlement of entitlements) {
        const proofResponse = await request(processor.getApp())
          .get(`/proof/${projectId}/${entitlement.address}`)
          .set('X-API-Key', 'test-api-key')
          .expect(200);

        console.log(`\n${entitlement.address}:`);
        console.log(`  Value: [${proofResponse.body.value[0]}, ${proofResponse.body.value[1]}]`);
        console.log(`  Tree Index: ${proofResponse.body.treeIndex}`);
        console.log(`  Proof (${proofResponse.body.proof.length} nodes):`);
        proofResponse.body.proof.forEach((p: string, i: number) => {
          console.log(`    [${i}]: ${p}`);
        });

        // Verify the proof matches expected values
        expect(proofResponse.body.value[0]).toBe(entitlement.address);
        expect(proofResponse.body.value[1]).toBe(entitlement.amount);
        expect(Array.isArray(proofResponse.body.proof)).toBe(true);
        expect(proofResponse.body.proof.length).toBeGreaterThan(0);
      }

      console.log('\n✅ All proofs generated successfully!');
      console.log('\nTo manually verify:');
      console.log('1. Check that root hash is consistent');
      console.log('2. For each address, verify proof leads to root');
      console.log('3. Hash leaf = keccak256(abi.encode(address, amount))');
      console.log('4. Walk up tree using proof siblings');
    }, 10000);
  });

  describe('Deterministic Results Test', () => {
    it('should produce identical results for same inputs', async () => {
      const projectId1 = 'deterministic-1';
      const projectId2 = 'deterministic-2';
      const entitlements = [
        { address: 'test1.near', amount: '1000' },
        { address: 'test2.near', amount: '2000' }
      ];

      console.log('\n🎯 DETERMINISTIC TEST');
      console.log('=====================');

      // Process same data twice with different project IDs
      for (const projectId of [projectId1, projectId2]) {
        await request(processor.getApp())
          .post(`/upload/${projectId}`)
          .set('X-API-Key', 'test-api-key')
          .set('Content-Type', 'text/csv')
          .send(entitlementsToCSV(entitlements))
          .expect(200);

        await request(processor.getApp())
          .get(`/root?project_id=${projectId}`)
          .set('X-API-Key', 'test-api-key')
          .expect(200);

        // Wait for completion
        let attempts = 0;
        while (attempts < 20) {
          const response = await request(processor.getApp())
            .get(`/root?project_id=${projectId}`)
            .set('X-API-Key', 'test-api-key');
          if (response.body.status === 'complete') break;
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
      }

      // Compare results
      const result1 = await request(processor.getApp()).get(`/root?project_id=${projectId1}`).set('X-API-Key', 'test-api-key');
      const result2 = await request(processor.getApp()).get(`/root?project_id=${projectId2}`).set('X-API-Key', 'test-api-key');

      console.log('Root 1:', result1.body.root);
      console.log('Root 2:', result2.body.root);

      expect(result1.body.root).toBe(result2.body.root);

      // Compare tree structures
      const tree1 = await request(processor.getApp()).get(`/tree/${projectId1}`);
      const tree2 = await request(processor.getApp()).get(`/tree/${projectId2}`);

      expect(tree1.body.tree).toEqual(tree2.body.tree);
      console.log('✅ Trees are identical - deterministic!');
    }, 10000);
  });

  describe('Empty Merkle Tree Edge Case', () => {
    it('should handle single entitlement correctly', async () => {
      const projectId = 'single-entry';
      const entitlements = [
        { address: 'only.near', amount: '42' }
      ];

      console.log('\n🔍 SINGLE ENTRY TEST');
      console.log('====================');
      console.log('Testing edge case with only one entitlement');

      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(entitlementsToCSV(entitlements))
        .expect(200);

      await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      // Wait for completion
      let attempts = 0;
      let finalResponse: any;
      while (attempts < 20) {
        const response = await request(processor.getApp())
          .get(`/root?project_id=${projectId}`)
          .set('X-API-Key', 'test-api-key');
        finalResponse = response.body;
        if (finalResponse.status === 'complete') break;
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      console.log('Root Hash:', finalResponse.root);
      console.log('Total Entitlements:', finalResponse.numEntitlements);

      // Get the proof
      const proofResponse = await request(processor.getApp())
        .get(`/proof/${projectId}/only.near`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      console.log('\nProof for single entry:');
      console.log('  Value:', proofResponse.body.value);
      console.log('  Tree Index:', proofResponse.body.treeIndex);
      console.log('  Proof length:', proofResponse.body.proof.length);

      expect(proofResponse.body.value[0]).toBe('only.near');
      expect(proofResponse.body.value[1]).toBe('42');
      expect(proofResponse.body.treeIndex).toBe(0);
      
      console.log('✅ Single entry handled correctly!');
    }, 10000);
  });

  describe('Powers of 2 Test', () => {
    it('should handle 4 addresses (perfect binary tree)', async () => {
      const projectId = 'power-of-2';
      const entitlements = [
        { address: 'addr0.near', amount: '10' },
        { address: 'addr1.near', amount: '20' },
        { address: 'addr2.near', amount: '30' },
        { address: 'addr3.near', amount: '40' }
      ];

      console.log('\n🌳 PERFECT BINARY TREE TEST');
      console.log('===========================');
      console.log('Testing with 4 addresses (2^2) for perfect tree structure');

      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(entitlementsToCSV(entitlements))
        .expect(200);

      await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      // Wait for completion
      let attempts = 0;
      let finalResponse: any;
      while (attempts < 20) {
        const response = await request(processor.getApp())
          .get(`/root?project_id=${projectId}`)
          .set('X-API-Key', 'test-api-key');
        finalResponse = response.body;
        if (finalResponse.status === 'complete') break;
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      // Get tree structure
      const treeResponse = await request(processor.getApp())
        .get(`/tree/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      console.log('Tree structure for 4 addresses:');
      console.log('Levels:', treeResponse.body.tree.length);
      console.log('Expected: 3 levels (4 leaves + 2 internal + 1 root)');

      // Perfect binary tree with 4 leaves should have 7 total nodes
      // Level 0 (leaves): 4 nodes
      // Level 1 (internal): 2 nodes  
      // Level 2 (root): 1 node
      expect(treeResponse.body.tree.length).toBe(7);

      // Check each address has a proof of length 2 (depth = 2)
      for (const entitlement of entitlements) {
        const proofResponse = await request(processor.getApp())
          .get(`/proof/${projectId}/${entitlement.address}`)
          .set('X-API-Key', 'test-api-key')
          .expect(200);

        console.log(`${entitlement.address}: proof length = ${proofResponse.body.proof.length}`);
        expect(proofResponse.body.proof.length).toBe(2); // Tree depth
      }

      console.log('✅ Perfect binary tree structure verified!');
    }, 10000);
  });

  describe('Raw Merkle Tree Verification', () => {
    it('should allow direct merkle tree construction for verification', async () => {
      const values: Array<[string, string]> = [
        ['manual1.near', '100'],
        ['manual2.near', '200']
      ];

      console.log('\n🔧 DIRECT MERKLE TREE TEST');
      console.log('==========================');
      console.log('Building tree directly for verification');

      const tree = await NearMerkleTree.of(values, ['address', 'uint256']);
      
      console.log('Root Hash:', tree.getRoot());
      console.log('Values count:', tree.values.length);
      
      tree.values.forEach((val, i) => {
        console.log(`Value ${i}: ${val.value[0]} = ${val.value[1]} (index: ${val.treeIndex})`);
      });

      // Get proofs for each value
      for (const val of tree.values) {
        const proof = tree.getProof(val.treeIndex);
        console.log(`\nProof for ${val.value[0]} (index ${val.treeIndex}):`);
        console.log(`  Siblings: ${proof.length}`);
        proof.forEach((sibling, i) => {
          console.log(`    [${i}]: ${sibling}`);
        });
      }

      // Verify basic properties
      expect(tree.getRoot()).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tree.values.length).toBe(2);

      console.log('✅ Direct tree construction successful!');
    }, 5000);
  });

  describe('Hash Consistency Test', () => {
    it('should produce consistent hashes for same leaf values', async () => {
      console.log('\n🔍 HASH CONSISTENCY TEST');
      console.log('========================');

      const tree1 = await NearMerkleTree.of([['test.near', '123']], ['address', 'uint256']);
      const tree2 = await NearMerkleTree.of([['test.near', '123']], ['address', 'uint256']);

      console.log('Tree 1 root:', tree1.getRoot());
      console.log('Tree 2 root:', tree2.getRoot());

      expect(tree1.getRoot()).toBe(tree2.getRoot());

      console.log('✅ Hash consistency verified!');
    }, 5000);
  });
});