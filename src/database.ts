import { PrismaClient } from './generated/prisma';
import { ProcessorStatus } from './tree-processor';

export class DatabaseService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async createProject(data: {
    id: string;
    status: string;
    startTime: Date;
    endTime?: Date;
    numEntitlements?: number;
    totalClaimValue?: string;
    rootHash?: string;
    buildElapsed?: number;
    totalElapsed?: number;
    buildStartTime?: Date;
    endGenerateTime?: Date;
    generated?: number;
    errorMessage?: string;
  }) {
    return await this.prisma.project.create({
      data: {
        id: data.id,
        status: data.status,
        startTime: data.startTime,
        endTime: data.endTime,
        numEntitlements: data.numEntitlements,
        totalClaimValue: data.totalClaimValue,
        rootHash: data.rootHash,
        buildElapsed: data.buildElapsed,
        totalElapsed: data.totalElapsed,
        buildStartTime: data.buildStartTime,
        endGenerateTime: data.endGenerateTime,
        generated: data.generated,
        errorMessage: data.errorMessage,
      },
    });
  }

  async updateProject(projectId: string, data: Partial<{
    status: string;
    endTime: Date;
    numEntitlements: number;
    totalClaimValue: string;
    rootHash: string;
    buildElapsed: number;
    totalElapsed: number;
    buildStartTime: Date;
    endGenerateTime: Date;
    generated: number;
    errorMessage: string;
  }>) {
    return await this.prisma.project.update({
      where: { id: projectId },
      data,
    });
  }

  async getProject(projectId: string) {
    return await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        proofs: {
          select: {
            address: true,
            amount: true,
            claimed: true,
            claimedAt: true,
            claimedTxHash: true,
          },
        },
      },
    });
  }

  async getProjectStatus(projectId: string): Promise<ProcessorStatus | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) return null;

    return {
      status: project.status as ProcessorStatus['status'],
      projectId: project.id,
      startTime: project.startTime.toISOString().replace('T', ':').replace(/\.\d{3}Z$/, ''),
      endTime: project.endTime?.toISOString().replace('T', ':').replace(/\.\d{3}Z$/, ''),
      numEntitlements: project.numEntitlements || undefined,
      totalClaimValue: project.totalClaimValue || undefined,
      root: project.rootHash || undefined,
      buildElapsed: project.buildElapsed || undefined,
      totalElapsed: project.totalElapsed || undefined,
      buildStartTime: project.buildStartTime?.toISOString().replace('T', ':').replace(/\.\d{3}Z$/, ''),
      endGenerateTime: project.endGenerateTime?.toISOString().replace('T', ':').replace(/\.\d{3}Z$/, ''),
      generated: project.generated || undefined,
      message: project.errorMessage || undefined,
    };
  }

  async createProof(data: {
    projectId: string;
    address: string;
    amount: string;
    treeIndex: number;
    gcsPath: string;
  }) {
    return await this.prisma.proof.create({
      data: {
        projectId: data.projectId,
        address: data.address.toLowerCase(),
        amount: data.amount,
        treeIndex: data.treeIndex,
        gcsPath: data.gcsPath,
      },
    });
  }

  async createProofsBatch(proofs: Array<{
    projectId: string;
    address: string;
    amount: string;
    treeIndex: number;
    gcsPath: string;
  }>) {
    // Process in smaller batches to avoid memory issues
    const BATCH_SIZE = 1000;
    const results = [];

    for (let i = 0; i < proofs.length; i += BATCH_SIZE) {
      const batch = proofs.slice(i, i + BATCH_SIZE);
      const batchData = batch.map(proof => ({
        projectId: proof.projectId,
        address: proof.address.toLowerCase(),
        amount: proof.amount,
        treeIndex: proof.treeIndex,
        gcsPath: proof.gcsPath,
      }));

      const result = await this.prisma.proof.createMany({
        data: batchData,
        skipDuplicates: true,
      });
      results.push(result);
    }

    return results;
  }

  async markProofClaimed(projectId: string, address: string, txHash: string) {
    const proof = await this.prisma.proof.update({
      where: {
        projectId_address: {
          projectId,
          address: address.toLowerCase(),
        },
      },
      data: {
        claimed: true,
        claimedAt: new Date(),
        claimedTxHash: txHash,
      },
    });

    await this.updateProjectTotalClaimed(projectId);
    
    return proof;
  }

  async updateProjectTotalClaimed(projectId: string) {
    const claimedProofs = await this.prisma.proof.findMany({
      where: {
        projectId,
        claimed: true,
      },
      select: {
        amount: true,
      },
    });

    const totalClaimed = claimedProofs.reduce((sum, proof) => {
      return sum + BigInt(proof.amount);
    }, 0n);

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        totalClaimed: totalClaimed.toString(),
      },
    });

    return totalClaimed.toString();
  }

  async getProof(projectId: string, address: string) {
    return await this.prisma.proof.findUnique({
      where: {
        projectId_address: {
          projectId,
          address: address.toLowerCase(),
        },
      },
    });
  }

  async listProjects() {
    return await this.prisma.project.findMany({
      select: {
        id: true,
        status: true,
        startTime: true,
        endTime: true,
        numEntitlements: true,
        totalClaimValue: true,
        totalClaimed: true,
        rootHash: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getProjectStats(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) return null;

    // Get counts by claimed status
    const proofStats = await this.prisma.proof.groupBy({
      by: ['claimed'],
      where: { projectId },
      _count: {
        _all: true,
      },
    });

    // Get claimed proofs to calculate sum manually (since amount is String)
    const claimedProofs = await this.prisma.proof.findMany({
      where: {
        projectId,
        claimed: true,
      },
      select: {
        amount: true,
      },
    });

    const unclaimedProofs = await this.prisma.proof.findMany({
      where: {
        projectId,
        claimed: false,
      },
      select: {
        amount: true,
      },
    });

    // Calculate sums manually
    const claimedTotal = claimedProofs.reduce((sum, proof) => {
      return sum + BigInt(proof.amount);
    }, 0n);

    const unclaimedTotal = unclaimedProofs.reduce((sum, proof) => {
      return sum + BigInt(proof.amount);
    }, 0n);

    const claimedCount = proofStats.find(stat => stat.claimed === true)?._count._all || 0;
    const unclaimedCount = proofStats.find(stat => stat.claimed === false)?._count._all || 0;

    return {
      project: {
        id: project.id,
        status: project.status,
        totalClaimValue: project.totalClaimValue,
        totalClaimed: project.totalClaimed,
        numEntitlements: project.numEntitlements,
      },
      claimed: {
        count: claimedCount,
        totalAmount: claimedTotal.toString(),
      },
      unclaimed: {
        count: unclaimedCount,
        totalAmount: unclaimedTotal.toString(),
      },
    };
  }
}