export interface MerkleTreeData {
  account: string;
  lockup: string;
  amount: string;
}

export interface EntitlementEntry {
  address: string;
  lockup: string;
  amount: string;
}

export interface RewardCampaign {
  id: number;
  claimStart: string;
  claimEnd: string;
  merkleRoot: string;
}

export interface CampaignConfig {
  merkleRoot: string;
  claimEnd: string;
}

export interface MerkleValue {
  value: MerkleTreeData;
  treeIndex: number;
}

export interface MerkleTreeDump {
  format: string;
  tree: string[];
  values: MerkleValue[];
  leafEncoding: string[];
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
  campaignId?: number;
}
