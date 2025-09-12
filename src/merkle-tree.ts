import keccak from 'keccak';
import BN from 'bn.js';
import { PerformanceMonitor } from './performance-monitor';
import { CHUNK_SIZES, DATASET_THRESHOLDS, FORMATS, REGEX_PATTERNS } from './constants';

export interface MerkleValue {
  value: [string, string]; // [address, amount]
  treeIndex: number;
}

export interface MerkleTreeDump {
  format: string;
  tree: string[];
  values: MerkleValue[];
  leafEncoding: string[];
}

export class NearMerkleTree {
  private tree: string[];
  public values: MerkleValue[];
  private leafEncoding: string[];

  constructor(tree: string[], values: MerkleValue[], leafEncoding: string[]) {
    this.tree = tree;
    this.values = values;
    this.leafEncoding = leafEncoding;
  }

  static async of(values: Array<[string, string]>, leafEncoding: string[]): Promise<NearMerkleTree> {
    const monitor = new PerformanceMonitor();
    monitor.setStage('initialization');
    
    // Adaptive chunk size based on dataset size for better performance
    const chunkSize = values.length > DATASET_THRESHOLDS.LARGE 
      ? CHUNK_SIZES.LARGE 
      : values.length > DATASET_THRESHOLDS.SMALL 
      ? CHUNK_SIZES.MEDIUM 
      : CHUNK_SIZES.SMALL;
    const leaves: Array<[number, Buffer, [string, string]]> = [];
    
    if (values.length > DATASET_THRESHOLDS.SMALL) {
      console.log(`🚀 Processing ${values.length} entries with chunk size ${chunkSize}...`);
    }

    // Pre-allocate array for better performance with large datasets
    if (values.length > DATASET_THRESHOLDS.SMALL) {
      leaves.length = values.length;
    }
    
    // Process leaves in chunks for async behavior
    monitor.setStage('processing-leaves');
    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);
      
      for (let j = 0; j < chunk.length; j++) {
        const value = chunk[j];
        const originalIndex = i + j;
        
        // Convert to NEAR-compatible format
        const convertedValue = this.convertValue(value);
        
        // Encode the value for NEAR (using keccak256)
        const encoded = this.encodeValue(convertedValue);
        
        const leafHash = keccak('keccak256').update(encoded).digest();
        
        if (values.length > DATASET_THRESHOLDS.SMALL) {
          leaves[originalIndex] = [originalIndex, leafHash, value];
        } else {
          leaves.push([originalIndex, leafHash, value]);
        }
      }

      // Record metrics periodically and show progress for large datasets
      if (values.length > DATASET_THRESHOLDS.MEDIUM && i > 0 && i % (chunkSize * 10) === 0) {
        const progress = Math.round((i / values.length) * 100);
        console.log(`Processed ${i}/${values.length} entries (${progress}%)`);
        monitor.recordMetrics(i);
      }
      await new Promise(resolve => setImmediate(resolve));
    }

    // Sort leaves by hash value
    monitor.setStage('sorting-leaves');
    if (values.length > DATASET_THRESHOLDS.MEDIUM) {
      console.log('Sorting leaves...');
    }
    const sortedLeaves = leaves.sort((a, b) => a[1].compare(b[1]));
    monitor.recordMetrics(values.length);

    // Build tree structure
    monitor.setStage('building-tree');
    const treeSize = 2 * leaves.length - 1;
    const tree: string[] = new Array(treeSize);
    const origToTreePos: { [key: number]: number } = {};

    if (values.length > DATASET_THRESHOLDS.MEDIUM) {
      console.log('Building tree structure...');
    }

    // Place leaves at bottom level with better chunking for large datasets
    const leafChunkSize = values.length > DATASET_THRESHOLDS.LARGE ? CHUNK_SIZES.EXTRA_LARGE : chunkSize;
    for (let i = 0; i < sortedLeaves.length; i++) {
      const [origIdx, leafHash] = sortedLeaves[i];
      const leafPos = treeSize - 1 - i;
      tree[leafPos] = '0x' + leafHash.toString('hex');
      origToTreePos[origIdx] = leafPos;

      if (values.length > DATASET_THRESHOLDS.MEDIUM && i > 0 && i % leafChunkSize === 0) {
        const progress = Math.round((i / sortedLeaves.length) * 100);
        console.log(`Placed ${i}/${sortedLeaves.length} leaves (${progress}%)`);
        monitor.recordMetrics(i);
        await new Promise(resolve => setImmediate(resolve));
      } else if (values.length <= DATASET_THRESHOLDS.MEDIUM && i % chunkSize === 0 && i > 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    // Create indexed values in original order
    monitor.setStage('indexing-values');
    const indexedValues: MerkleValue[] = [];
    for (let i = 0; i < values.length; i++) {
      indexedValues.push({
        value: values[i],
        treeIndex: origToTreePos[i]
      });

      if (i % chunkSize === 0 && i > 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    // Build internal nodes
    monitor.setStage('building-internal-nodes');
    for (let i = treeSize - 1 - leaves.length; i >= 0; i--) {
      if (i % chunkSize === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }

      const leftIdx = 2 * i + 1;
      const rightIdx = 2 * i + 2;

      const leftHash = Buffer.from(tree[leftIdx].substring(2), 'hex');
      const rightHash = rightIdx < tree.length 
        ? Buffer.from(tree[rightIdx].substring(2), 'hex')
        : leftHash;

      // Sort pair before hashing (NEAR requirement)
      const sortedPair = leftHash.compare(rightHash) <= 0 
        ? [leftHash, rightHash] 
        : [rightHash, leftHash];

      const nodeHash = keccak('keccak256').update(Buffer.concat(sortedPair)).digest();
      
      tree[i] = '0x' + nodeHash.toString('hex');
    }

    monitor.setStage('complete');
    monitor.recordMetrics(values.length);
    
    // Log performance summary for large datasets
    if (values.length > DATASET_THRESHOLDS.SMALL) {
      monitor.logSummary();
    }

    return new NearMerkleTree(tree, indexedValues, leafEncoding);
  }

  private static convertValue(value: [string, string]): [string, string] {
    const [address, amount] = value;
    
    // Ensure address is properly formatted for NEAR
    let formattedAddress = address.toLowerCase();
    
    // Check if it's a NEAR account (ends with .near, .testnet, etc.) or already a 64-char hex
    const isNearAccount = formattedAddress.includes('.') || formattedAddress.match(REGEX_PATTERNS.HEX_64_CHAR);
    
    if (!isNearAccount) {
      // If it's not a NEAR account ID and not a 64-char hex, assume it's an implicit account
      if (formattedAddress.startsWith('0x')) {
        formattedAddress = formattedAddress.substring(2);
      }
      // Pad to 64 chars if needed for implicit account
      formattedAddress = formattedAddress.padStart(FORMATS.NEAR_ACCOUNT_HEX_LENGTH, '0');
    }

    // Convert amount to string representation
    let formattedAmount: string;
    
    // Validate format - must be digits with optional decimal point
    if (!REGEX_PATTERNS.AMOUNT_VALIDATION.test(amount)) {
      throw new Error(`Invalid amount format: ${amount}`);
    }
    
    // Handle decimal strings by removing the decimal part (always use string splitting)
    const [integerPart] = amount.split('.');
    formattedAmount = new BN(integerPart, 10).toString();

    return [formattedAddress, formattedAmount];
  }

  private static encodeValue(value: [string, string]): Buffer {
    const [address, amount] = value;
    
    const accountBytes = Buffer.from(address, 'utf8');
    const accountLength = Buffer.alloc(4);
    accountLength.writeUInt32LE(accountBytes.length, 0);
    
    const amountBN = new BN(amount, 10);
    const amountBytes = Buffer.alloc(16);
    
    const amountArray = amountBN.toArray('le', 16);
    for (let i = 0; i < 16; i++) {
      amountBytes[i] = amountArray[i] || 0;
    }
    
    return Buffer.concat([accountLength, accountBytes, amountBytes]);
  }

  getProof(index: number): string[] {
    if (index < 0 || index >= this.tree.length) {
      throw new Error('Index out of range');
    }

    return this.getProofUnsafe(index);
  }

  private getProofUnsafe(index: number): string[] {
    const proof: string[] = [];
    let currentIndex = index;

    while (currentIndex > 0) {
      const isRight = currentIndex % 2 === 0;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < this.tree.length) {
        proof.push(this.tree[siblingIndex]);
      }

      currentIndex = Math.floor((currentIndex - 1) / 2);
    }

    return proof;
  }

  verify(proof: string[], leafValue: [string, string]): boolean {
    const convertedValue = NearMerkleTree.convertValue(leafValue);
    const encoded = NearMerkleTree.encodeValue(convertedValue);
    
    let current = keccak('keccak256').update(encoded).digest();

    // Process proof elements
    for (const sibling of proof) {
      const siblingHash = Buffer.from(sibling.substring(2), 'hex');
      
      // Sort pair before hashing
      const sortedPair = current.compare(siblingHash) <= 0 
        ? [current, siblingHash]
        : [siblingHash, current];

      current = keccak('keccak256').update(Buffer.concat(sortedPair)).digest();
    }

    const rootHash = Buffer.from(this.tree[0].substring(2), 'hex');
    return current.equals(rootHash);
  }

  getRoot(): string {
    return this.tree[0];
  }

  dump(): MerkleTreeDump {
    return {
      format: FORMATS.MERKLE_TREE_VERSION,
      tree: this.tree,
      values: this.values,
      leafEncoding: this.leafEncoding
    };
  }

  static load(data: MerkleTreeDump): NearMerkleTree {
    if (data.format !== FORMATS.MERKLE_TREE_VERSION) {
      throw new Error(`Unknown format '${data.format}'`);
    }
    if (!data.leafEncoding) {
      throw new Error('Expected leaf encoding');
    }
    return new NearMerkleTree(data.tree, data.values, data.leafEncoding);
  }
}