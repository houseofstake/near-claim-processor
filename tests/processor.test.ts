import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import * as fs from 'fs';
import { NearClaimProcessor } from '../src/processor';
import { LocalStorage } from '../src/storage';
import { DatabaseService } from '../src/database';
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
    findMany: vi.fn().mockImplementation(({ where }) => {
      const proofs = Array.from(mockProofs.values()).filter((proof: any) => {
        if (where?.projectId && proof.projectId !== where.projectId) return false;
        if (where?.claimed !== undefined && proof.claimed !== where.claimed) return false;
        return true;
      });
      return Promise.resolve(proofs);
    }),
    update: vi.fn().mockImplementation(({ where, data }) => {
      const key = `${where.projectId_address.projectId}:${where.projectId_address.address}`;
      const proof = mockProofs.get(key);
      if (proof) {
        const updated = { ...proof, ...data };
        mockProofs.set(key, updated);
        return Promise.resolve(updated);
      }
      return Promise.resolve(null);
    }),
    groupBy: vi.fn().mockImplementation(({ where, by }) => {
      const proofs = Array.from(mockProofs.values()).filter((proof: any) => {
        if (where?.projectId && proof.projectId !== where.projectId) return false;
        return true;
      });
      
      const groups: any = {};
      proofs.forEach((proof: any) => {
        const key = proof.claimed;
        if (!groups[key]) {
          groups[key] = { claimed: key, _count: { claimed: 0 }, _sum: { amount: '0' } };
        }
        groups[key]._count.claimed++;
        groups[key]._sum.amount = (BigInt(groups[key]._sum.amount) + BigInt(proof.amount)).toString();
      });
      
      return Promise.resolve(Object.values(groups));
    }),
    findUnique: vi.fn().mockImplementation(({ where }) => {
      const key = `${where.projectId_address.projectId}:${where.projectId_address.address}`;
      const proof = mockProofs.get(key);
      return Promise.resolve(proof || null);
    }),
  },
};

// Clear mocks before each test
const clearMocks = () => {
  mockProjects.clear();
  mockProofs.clear();
};

vi.mock('../src/generated/prisma', () => ({
  PrismaClient: vi.fn().mockImplementation(() => mockPrisma),
}));

describe('NearClaimProcessor', () => {
  let processor: NearClaimProcessor;
  let storage: LocalStorage;
  let database: DatabaseService;
  const testDataPath = './test-processor-data';
  
  beforeEach(async () => {
    // Set up test API key
    process.env.API_KEY = 'test-api-key';
    
    // Clear mock data
    clearMocks();
    
    // Clean up test directory with better error handling
    if (fs.existsSync(testDataPath)) {
      try {
        fs.rmSync(testDataPath, { recursive: true, force: true });
      } catch (error) {
        // If removal fails, wait a bit and try again
        await new Promise(resolve => setTimeout(resolve, 100));
        try {
          fs.rmSync(testDataPath, { recursive: true, force: true });
        } catch (finalError) {
          console.warn('Could not fully clean test directory, continuing:', (finalError as Error).message);
        }
      }
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
    // Clean up test directory with better error handling
    if (fs.existsSync(testDataPath)) {
      try {
        fs.rmSync(testDataPath, { recursive: true, force: true });
      } catch (error) {
        // If removal fails, wait a bit and try again
        await new Promise(resolve => setTimeout(resolve, 100));
        try {
          fs.rmSync(testDataPath, { recursive: true, force: true });
        } catch (finalError) {
          console.warn('Could not fully clean test directory, continuing:', (finalError as Error).message);
        }
      }
    }
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await request(processor.getApp())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Project Management', () => {
    it('should list projects when none exist', async () => {
      const response = await request(processor.getApp())
        .get('/projects')
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      expect(response.body).toEqual({ projects: [] });
    });

    it('should upload entitlements for a project', async () => {
      const projectId = 'test-project';
      const entitlements = [
        { address: 'alice.near', amount: '1000000000000000000000' },
        { address: 'bob.near', amount: '2000000000000000000000' }
      ];

      const response = await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(entitlementsToCSV(entitlements))
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.message).toContain('2 entitlements');
    });

    it('should reject invalid entitlements format', async () => {
      const projectId = 'test-project';
      
      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send('alice.near,\nbob.near,1000')
        .expect(400);
    });

    it('should reject empty entitlements array', async () => {
      const projectId = 'test-project';

      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send('')
        .expect(400);
    });

    it('should reject non-array entitlements', async () => {
      const projectId = 'test-project';

      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send('invalid')
        .expect(400);
    });

    it('should list projects after upload', async () => {
      const projectId = 'test-project';
      const entitlements = [
        { address: 'alice.near', amount: '1000000000000000000000' }
      ];

      // Upload entitlements
      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(entitlementsToCSV(entitlements))
        .expect(200);

      // Start processing
      await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      // Wait a bit for processing to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      // List projects
      const response = await request(processor.getApp())
        .get('/projects')
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      const projectIds = response.body.projects.map((p: any) => p.id);
      expect(projectIds).toContain(projectId);
    });
  });

  describe('Processing Workflow', () => {
    const projectId = 'workflow-test';
    const entitlements = [
      { address: 'alice.near', amount: '1000000000000000000000' },
      { address: 'bob.near', amount: '2000000000000000000000' },
      { address: 'charlie.near', amount: '3000000000000000000000' }
    ];

    beforeEach(async () => {
      // Upload test entitlements
      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(entitlementsToCSV(entitlements))
        .expect(200);
    });

    it('should start processing when project_id is provided', async () => {
      const response = await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('projectId', projectId);
      expect(response.body).toHaveProperty('startTime');
      expect(['started', 'verifying', 'building', 'generating', 'publishing', 'complete'])
        .toContain(response.body.status);
    });

    it('should return error when project_id is missing', async () => {
      const response = await request(processor.getApp())
        .get('/root')
        .set('X-API-Key', 'test-api-key')
        .expect(400);

      expect(response.body).toHaveProperty('error', 'project_id is required');
    });

    it('should complete processing and generate root', async () => {
      // Start processing
      await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      // Poll until complete (with timeout)
      let attempts = 0;
      const maxAttempts = 20;
      let finalResponse: any;

      while (attempts < maxAttempts) {
        const response = await request(processor.getApp())
          .get(`/root?project_id=${projectId}`)
          .set('X-API-Key', 'test-api-key')
          .expect(200);

        finalResponse = response.body;

        if (finalResponse.status === 'complete' || finalResponse.status === 'error') {
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
      }

      expect(finalResponse.status).toBe('complete');
      expect(finalResponse).toHaveProperty('root');
      expect(finalResponse.root).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(finalResponse).toHaveProperty('numEntitlements', 3);
      expect(finalResponse).toHaveProperty('generated', 3);
    }, 15000);

    it('should allow multiple status checks during processing', async () => {
      // Start processing
      const response1 = await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      // Immediate second check should return current status
      const response2 = await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      expect(response1.body.projectId).toBe(response2.body.projectId);
      expect(response1.body.startTime).toBe(response2.body.startTime);
    });
  });

  describe('Tree and Proof Retrieval', () => {
    const projectId = 'retrieval-test';
    const entitlements = [
      { address: 'alice.near', amount: '1000000000000000000000' },
      { address: 'bob.near', amount: '2000000000000000000000' }
    ];

    beforeEach(async () => {
      // Upload and process entitlements
      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(entitlementsToCSV(entitlements))
        .expect(200);

      // Start processing and wait for completion
      await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      // Wait for processing to complete
      let attempts = 0;
      while (attempts < 20) {
        const response = await request(processor.getApp())
          .get(`/root?project_id=${projectId}`)
          .set('X-API-Key', 'test-api-key');
        
        if (response.body.status === 'complete') {
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
      }
    }, 15000);

    it('should retrieve tree data for completed project', async () => {
      const response = await request(processor.getApp())
        .get(`/tree/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      expect(response.body).toHaveProperty('format', 'near-v1');
      expect(response.body).toHaveProperty('tree');
      expect(response.body).toHaveProperty('values');
      expect(response.body).toHaveProperty('leafEncoding');
      expect(Array.isArray(response.body.tree)).toBe(true);
      expect(Array.isArray(response.body.values)).toBe(true);
      expect(response.body.values).toHaveLength(2);
    });

    it('should return 404 for non-existent tree', async () => {
      await request(processor.getApp())
        .get('/tree/non-existent-project')
        .set('X-API-Key', 'test-api-key')
        .expect(404);
    });

    it('should retrieve proof for specific address', async () => {
      const address = 'alice.near';
      const response = await request(processor.getApp())
        .get(`/proof/${projectId}/${address}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      expect(response.body).toHaveProperty('value');
      expect(response.body).toHaveProperty('treeIndex');
      expect(response.body).toHaveProperty('proof');
      expect(Array.isArray(response.body.proof)).toBe(true);
      expect(response.body.value[0]).toBe(address);
      expect(response.body.value[1]).toBe('1000000000000000000000');
    });

    it('should handle case-insensitive address lookup', async () => {
      const response = await request(processor.getApp())
        .get(`/proof/${projectId}/ALICE.NEAR`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      expect(response.body.value[0]).toBe('alice.near');
    });

    it('should return 404 for non-existent address proof', async () => {
      await request(processor.getApp())
        .get(`/proof/${projectId}/nonexistent.near`)
        .set('X-API-Key', 'test-api-key')
        .expect(404);
    });

    it('should return 404 for non-existent project proof', async () => {
      await request(processor.getApp())
        .get('/proof/non-existent-project/alice.near')
        .set('X-API-Key', 'test-api-key')
        .expect(404);
    });
  });

  describe('Error Handling', () => {
    it('should handle processing errors gracefully', async () => {
      const projectId = 'error-test';

      // Try to process without uploading entitlements first - should return 404
      const response = await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(404);

      expect(response.body.error).toContain('Project not found');
    });

    it('should handle malformed JSON requests', async () => {
      await request(processor.getApp())
        .post('/upload/test')
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send('invalid json')
        .expect(400);
    });

    it('should handle missing request body', async () => {
      await request(processor.getApp())
        .post('/upload/test')
        .set('X-API-Key', 'test-api-key')
        .expect(400);
    });
  });

  describe('Data Validation', () => {
    it('should validate entitlement addresses', async () => {
      const projectId = 'validation-test';

      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(',1000\nalice.near,2000')
        .expect(400);
    });

    it('should validate entitlement amounts', async () => {
      const projectId = 'validation-test';

      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send('alice.near,\nbob.near,2000')
        .expect(400);
    });

    it('should accept valid NEAR addresses', async () => {
      const projectId = 'address-test';
      const entitlements = [
        { address: 'alice.near', amount: '1000' },
        { address: 'bob.testnet', amount: '2000' },
        { address: 'contract.aurora', amount: '3000' },
        { address: 'abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab', amount: '4000' }
      ];

      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(entitlementsToCSV(entitlements))
        .expect(200);
    });
  });

  describe('Large Dataset Handling', () => {
    it('should handle large number of entitlements (10K)', async () => {
      const projectId = 'large-dataset-10k';
      const entitlements = Array.from({ length: 10000 }, (_, i) => ({
        address: `user${i.toString(16).padStart(8, '0')}.near`,
        amount: (BigInt(i) * BigInt('1000000000000000000')).toString()
      }));

      // Upload large dataset
      const uploadResponse = await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(entitlementsToCSV(entitlements))
        .expect(200);

      expect(uploadResponse.body.message).toContain('10000 entitlements');

      // Start processing
      await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      // Wait for completion (longer timeout for large dataset)
      let attempts = 0;
      const maxAttempts = 60;
      let completed = false;

      while (attempts < maxAttempts && !completed) {
        const response = await request(processor.getApp())
          .get(`/root?project_id=${projectId}`)
          .set('X-API-Key', 'test-api-key');
        
        if (response.body.status === 'complete') {
          expect(response.body.numEntitlements).toBe(10000);
          expect(response.body.generated).toBe(10000);
          completed = true;
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
      }

      expect(completed).toBe(true);
    }, 120000);

    it('should handle massive datasets (100K entries)', async () => {
      const projectId = 'massive-dataset-100k';
      const entitlements = Array.from({ length: 100000 }, (_, i) => ({
        address: `user${i.toString(16).padStart(8, '0')}.near`,
        amount: (BigInt(i) * BigInt('1000000000000000000')).toString()
      }));

      console.log('Uploading 100K entitlements...');
      // Upload massive dataset
      const uploadResponse = await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(entitlementsToCSV(entitlements))
        .expect(200);

      expect(uploadResponse.body.message).toContain('100000 entitlements');

      console.log('Starting processing...');
      // Start processing
      await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      // Wait for completion with longer timeout and progress monitoring
      let attempts = 0;
      const maxAttempts = 120; // 20 minutes
      let completed = false;
      let lastStatus = '';

      while (attempts < maxAttempts && !completed) {
        const response = await request(processor.getApp())
          .get(`/root?project_id=${projectId}`)
          .set('X-API-Key', 'test-api-key');
        
        if (response.body.status !== lastStatus) {
          console.log(`Status: ${response.body.status}`);
          lastStatus = response.body.status;
        }
        
        if (response.body.status === 'complete') {
          expect(response.body.numEntitlements).toBe(100000);
          expect(response.body.generated).toBe(100000);
          completed = true;
          console.log('Processing completed!');
        } else if (response.body.status === 'error') {
          throw new Error(`Processing failed: ${response.body.message || 'Unknown error'}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 10000)); // Check every 10 seconds
        attempts++;
      }

      expect(completed).toBe(true);
    }, 1200000); // 20 minute timeout

    it('should handle ultra-massive datasets (500K entries)', async () => {
      const projectId = 'ultra-massive-dataset-500k';
      
      console.log('Generating 500K test entitlements...');
      const entitlements = Array.from({ length: 500000 }, (_, i) => ({
        address: `${i.toString(16).padStart(8, '0')}.near`,
        amount: (BigInt(i) * BigInt('1000000000000000000')).toString()
      }));

      console.log('Uploading 500K entitlements...');
      // Upload ultra-massive dataset
      const uploadResponse = await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(entitlementsToCSV(entitlements))
        .expect(200);

      expect(uploadResponse.body.message).toContain('500000 entitlements');

      console.log('Starting processing of 500K entries...');
      // Start processing
      const startTime = Date.now();
      await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      // Wait for completion with long timeout and detailed progress monitoring  
      let attempts = 0;
      const maxAttempts = 120; // 20 minutes
      let completed = false;
      let lastStatus = '';
      let lastProgress = 0;

      while (attempts < maxAttempts && !completed) {
        const response = await request(processor.getApp())
          .get(`/root?project_id=${projectId}`)
          .set('X-API-Key', 'test-api-key');
        
        if (response.body.status !== lastStatus) {
          console.log(`Status changed: ${lastStatus} -> ${response.body.status}`);
          lastStatus = response.body.status;
        }
        
        // Show progress if available
        if (response.body.generated && response.body.generated !== lastProgress) {
          const progress = Math.round((response.body.generated / 500000) * 100);
          console.log(`Generated ${response.body.generated}/500000 proofs (${progress}%)`);
          lastProgress = response.body.generated;
        }
        
        if (response.body.status === 'complete') {
          const totalTime = Math.round((Date.now() - startTime) / 1000);
          console.log(`Processing completed in ${totalTime}s!`);
          
          expect(response.body.numEntitlements).toBe(500000);
          expect(response.body.generated).toBe(500000);
          expect(response.body.root).toMatch(/^0x[a-fA-F0-9]{64}$/);
          completed = true;
        } else if (response.body.status === 'error') {
          throw new Error(`Processing failed: ${response.body.message || 'Unknown error'}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 10000)); // Check every 10 seconds
        attempts++;
      }

      expect(completed).toBe(true);
    }, 1800000); // 30 minute timeout
  });

  describe('Status Progression', () => {
    const projectId = 'status-test';
    const entitlements = [
      { address: 'alice.near', amount: '1000000000000000000000' }
    ];

    it('should progress through expected statuses', async () => {
      // Upload entitlements
      await request(processor.getApp())
        .post(`/upload/${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .set('Content-Type', 'text/csv')
        .send(entitlementsToCSV(entitlements))
        .expect(200);

      const observedStatuses = new Set<string>();

      // Start processing
      await request(processor.getApp())
        .get(`/root?project_id=${projectId}`)
        .set('X-API-Key', 'test-api-key')
        .expect(200);

      // Monitor status progression
      let attempts = 0;
      let completed = false;
      while (attempts < 25) {
        const response = await request(processor.getApp())
          .get(`/root?project_id=${projectId}`)
          .set('X-API-Key', 'test-api-key');
        
        observedStatuses.add(response.body.status);
        
        if (response.body.status === 'complete') {
          completed = true;
          break;
        }
        
        if (response.body.status === 'error') {
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
        attempts++;
      }

      // Should have completed successfully
      expect(completed).toBe(true);
      
      // Should have observed at least one valid status
      const validStatuses = ['started', 'verifying', 'building', 'generating', 'publishing', 'complete'];
      const hasValidStatus = Array.from(observedStatuses).some(status => validStatuses.includes(status));
      expect(hasValidStatus).toBe(true);
      
      // Must have observed complete status
      expect(observedStatuses.has('complete')).toBe(true);
    }, 10000);
  });
});