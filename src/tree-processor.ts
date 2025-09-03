import { NearMerkleTree } from './merkle-tree';
import { IStorage } from './storage';
import { DatabaseService } from './database';
import { checkForDuplicateAddresses, calculateTotalClaimValue } from './utils';

export interface EntitlementEntry {
  address: string;
  amount: string;
}

export interface ProcessorStatus {
  status: 'started' | 'verifying' | 'building' | 'generating' | 'publishing' | 'complete' | 'error';
  projectId: string;
  startTime: string;
  message?: string;
  numEntitlements?: number;
  totalClaimValue?: string;
  buildStartTime?: string;
  buildElapsed?: number;
  totalElapsed?: number;
  endGenerateTime?: string;
  generated?: number;
  endTime?: string;
  root?: string;
}

export class TreeProcessor {
  private projectId: string;
  private status: ProcessorStatus['status'] = 'started';
  private merkleTree?: NearMerkleTree;
  private startTime: Date;
  private buildStartTime?: Date;
  private buildEndTime?: Date;
  private endTime?: Date;
  private numEntitlements = 0;
  private totalClaimValue = '0';
  private generated = 0;
  private message?: string;

  constructor(
    private storage: IStorage,
    private database: DatabaseService,
    projectId: string
  ) {
    this.projectId = projectId;
    this.startTime = new Date();
  }

  async run(): Promise<void> {
    try {
      // Create or update project record in database
      const existingProject = await this.database.getProject(this.projectId);
      
      if (!existingProject) {
        await this.database.createProject({
          id: this.projectId,
          status: 'started',
          startTime: this.startTime,
        });
      } else {
        // Update existing project to started status
        await this.database.updateProject(this.projectId, {
          status: 'started',
        });
      }

      this.status = 'verifying';

      // Load entitlements from storage
      const entitlementsData = await this.storage.retrieveData(`user-entitlement-file/${this.projectId}.csv`);
      if (!entitlementsData) {
        throw new Error(`Entitlements file not found for project ${this.projectId}`);
      }

      // Parse entitlements (assuming CSV data is stored as array)
      const entitlements: EntitlementEntry[] = entitlementsData;

      this.numEntitlements = entitlements.length;
      this.totalClaimValue = calculateTotalClaimValue(entitlements);

      // Check for duplicate addresses
      checkForDuplicateAddresses(entitlements);

      this.buildStartTime = new Date();
      this.status = 'building';

      // Update database with verifying -> building transition
      await this.database.updateProject(this.projectId, {
        status: 'building',
        numEntitlements: this.numEntitlements,
        totalClaimValue: this.totalClaimValue,
        buildStartTime: this.buildStartTime,
      });

      // Build Merkle tree
      const values: Array<[string, string]> = entitlements.map(e => [
        e.address, 
        e.amount.includes('.') ? e.amount.split('.')[0] : e.amount
      ]);
      this.merkleTree = await NearMerkleTree.of(values, ['address', 'uint256']);
      
      this.buildEndTime = new Date();

      // Store tree data
      await this.storage.storeJSON(`project-tree/${this.projectId}.json`, this.merkleTree.dump());

      // Store build completion event
      const buildResult = this.getResult();
      const dateStr = this.buildEndTime.toISOString().split('T')[0];
      await this.storage.storeJSON(`events/build-complete/${dateStr}/${this.projectId}.json`, buildResult);
      await this.storage.storeJSON(`project-build-complete/${this.projectId}.json`, buildResult);

      this.status = 'generating';

      // Update database with building -> generating transition
      await this.database.updateProject(this.projectId, {
        status: 'generating',
        rootHash: this.merkleTree.getRoot(),
        buildElapsed: this.buildEndTime ? (this.buildEndTime.getTime() - this.buildStartTime!.getTime()) / 1000 : undefined,
        totalElapsed: this.buildEndTime ? (this.buildEndTime.getTime() - this.startTime.getTime()) / 1000 : undefined,
        endGenerateTime: this.buildEndTime,
      });

      // Generate proofs
      const proofTasks: Array<{ key: string; data: any }> = [];
      const dbProofTasks: Array<{ projectId: string; address: string; amount: string; treeIndex: number; gcsPath: string }> = [];
      
      for (const valueEntry of this.merkleTree.values) {
        const address = valueEntry.value[0];
        const amount = valueEntry.value[1];
        const proof = this.merkleTree.getProof(valueEntry.treeIndex);
        
        const proofData = {
          ...valueEntry,
          proof
        };

        const gcsPath = `v1/proof/${this.projectId}/${address.toLowerCase()}.json`;
        
        proofTasks.push({
          key: gcsPath,
          data: proofData
        });

        dbProofTasks.push({
          projectId: this.projectId,
          address: address.toLowerCase(),
          amount: amount,
          treeIndex: valueEntry.treeIndex,
          gcsPath: gcsPath,
        });

        this.generated++;
      }

      this.status = 'publishing';

      // Update database with generating -> publishing transition
      await this.database.updateProject(this.projectId, {
        status: 'publishing',
        generated: this.generated,
      });

      // Batch store proofs to both storage and database
      await Promise.all([
        this.storage.storeBatch(proofTasks),
        this.database.createProofsBatch(dbProofTasks)
      ]);

      this.endTime = new Date();
      this.status = 'complete';

      // Final database update
      await this.database.updateProject(this.projectId, {
        status: 'complete',
        endTime: this.endTime,
      });

      // Store completion events
      const finalResult = this.getResult();
      const endDateStr = this.endTime.toISOString().split('T')[0];
      await this.storage.storeJSON(`events/publishing-complete/${endDateStr}/${this.projectId}.json`, finalResult);
      await this.storage.storeJSON(`project-publishing-complete/${this.projectId}.json`, finalResult);

    } catch (error) {
      this.status = 'error';
      this.message = error instanceof Error ? error.message : String(error);
      console.error(`Processing error for project ${this.projectId}:`, error);
      
      // Update database with error status
      try {
        await this.database.updateProject(this.projectId, {
          status: 'error',
          errorMessage: this.message,
        });
      } catch (dbError) {
        console.error(`Failed to update database with error status:`, dbError);
      }
    }
  }

  getResult(): ProcessorStatus {
    const result: ProcessorStatus = {
      status: this.status,
      projectId: this.projectId,
      startTime: this.formatDate(this.startTime)
    };

    if (this.status === 'error' && this.message) {
      result.message = this.message;
    }

    if (['building', 'generating', 'publishing', 'complete'].includes(this.status)) {
      result.numEntitlements = this.numEntitlements;
      result.totalClaimValue = this.totalClaimValue;
    }

    if (this.status === 'building' && this.buildStartTime) {
      result.buildStartTime = this.formatDate(this.buildStartTime);
      result.buildElapsed = (Date.now() - this.buildStartTime.getTime()) / 1000;
    }

    if (['generating', 'publishing', 'complete'].includes(this.status) && this.merkleTree) {
      result.root = this.merkleTree.getRoot();
      if (this.buildStartTime && this.buildEndTime) {
        result.buildElapsed = (this.buildEndTime.getTime() - this.buildStartTime.getTime()) / 1000;
        result.totalElapsed = (this.buildEndTime.getTime() - this.startTime.getTime()) / 1000;
        result.endGenerateTime = this.formatDate(this.buildEndTime);
      }
      result.generated = this.generated;
    }

    if (this.status === 'complete' && this.endTime) {
      result.endTime = this.formatDate(this.endTime);
    }

    return result;
  }

  private formatDate(date: Date): string {
    return date.toISOString().replace('T', ':').replace(/\.\d{3}Z$/, '');
  }
}