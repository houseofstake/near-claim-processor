import keccak from "keccak";
import BN from "bn.js";
import { PerformanceMonitor } from "./performance-monitor";
import {
  CHUNK_SIZES,
  DATASET_THRESHOLDS,
  FORMATS,
  REGEX_PATTERNS,
} from "./constants";
import { MerkleTreeData, MerkleValue, MerkleTreeDump } from "./types";

export class NearMerkleTree {
  private tree: number[][];
  public values: MerkleValue[];
  private leafEncoding: string[];

  constructor(tree: number[][], values: MerkleValue[], leafEncoding: string[]) {
    this.tree = tree;
    this.values = values;
    this.leafEncoding = leafEncoding;
  }

  private static bufferToByteArray(buffer: Buffer): number[] {
    return Array.from(buffer);
  }

  private static byteArrayToBuffer(bytes: number[]): Buffer {
    return Buffer.from(bytes);
  }

  private static stringToByteArray(str: string): number[] {
    const hex = str.startsWith("0x") ? str.slice(2) : str;
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
      }
      return Array.from(bytes);
    }
    const base64 = btoa(str);
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return Array.from(bytes);
  }

  private static formatProofAsByteArrays(proof: number[][]): string {
    const formatted = proof.map(
      (bytes) => `    [\n${bytes.map((n) => `      ${n}`).join(",\n")}\n    ]`
    );
    return `[\n${formatted.join(",\n")}\n  ]`;
  }

  static async of(
    values: Array<MerkleTreeData>,
    leafEncoding: string[]
  ): Promise<NearMerkleTree> {
    const monitor = new PerformanceMonitor();
    monitor.setStage("initialization");

    // Adaptive chunk size based on dataset size for better performance
    const chunkSize =
      values.length > DATASET_THRESHOLDS.LARGE
        ? CHUNK_SIZES.LARGE
        : values.length > DATASET_THRESHOLDS.SMALL
        ? CHUNK_SIZES.MEDIUM
        : CHUNK_SIZES.SMALL;
    const leaves: Array<[number, Buffer, MerkleTreeData]> = [];

    if (values.length > DATASET_THRESHOLDS.SMALL) {
      console.log(
        `🚀 Processing ${values.length} entries with chunk size ${chunkSize}...`
      );
    }

    // Pre-allocate array for better performance with large datasets
    if (values.length > DATASET_THRESHOLDS.SMALL) {
      leaves.length = values.length;
    }

    // Process leaves in chunks for async behavior
    monitor.setStage("processing-leaves");
    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);

      for (let j = 0; j < chunk.length; j++) {
        const value = chunk[j];
        const originalIndex = i + j;

        // Convert to NEAR-compatible format
        const convertedValue = this.convertValue(value);

        // Encode the value for NEAR using Borsh serialization
        const encoded = this.encodeBorshValue(convertedValue);

        const leafHash = keccak("keccak256").update(encoded).digest();

        if (values.length > DATASET_THRESHOLDS.SMALL) {
          leaves[originalIndex] = [originalIndex, leafHash, value];
        } else {
          leaves.push([originalIndex, leafHash, value]);
        }
      }

      // Record metrics periodically and show progress for large datasets
      if (
        values.length > DATASET_THRESHOLDS.MEDIUM &&
        i > 0 &&
        i % (chunkSize * 10) === 0
      ) {
        const progress = Math.round((i / values.length) * 100);
        console.log(`Processed ${i}/${values.length} entries (${progress}%)`);
        monitor.recordMetrics(i);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }

    // Sort leaves by hash value
    monitor.setStage("sorting-leaves");
    if (values.length > DATASET_THRESHOLDS.MEDIUM) {
      console.log("Sorting leaves...");
    }
    const sortedLeaves = leaves.sort((a, b) => a[1].compare(b[1]));
    monitor.recordMetrics(values.length);

    // Build tree structure
    monitor.setStage("building-tree");
    const treeSize = 2 * leaves.length - 1;
    const tree: number[][] = new Array(treeSize);
    const origToTreePos: { [key: number]: number } = {};

    if (values.length > DATASET_THRESHOLDS.MEDIUM) {
      console.log("Building tree structure...");
    }

    // Place leaves at bottom level with better chunking for large datasets
    const leafChunkSize =
      values.length > DATASET_THRESHOLDS.LARGE
        ? CHUNK_SIZES.EXTRA_LARGE
        : chunkSize;
    for (let i = 0; i < sortedLeaves.length; i++) {
      const [origIdx, leafHash] = sortedLeaves[i];
      const leafPos = treeSize - 1 - i;
      tree[leafPos] = this.bufferToByteArray(leafHash);
      origToTreePos[origIdx] = leafPos;

      if (
        values.length > DATASET_THRESHOLDS.MEDIUM &&
        i > 0 &&
        i % leafChunkSize === 0
      ) {
        const progress = Math.round((i / sortedLeaves.length) * 100);
        console.log(`Placed ${i}/${sortedLeaves.length} leaves (${progress}%)`);
        monitor.recordMetrics(i);
        await new Promise((resolve) => setImmediate(resolve));
      } else if (
        values.length <= DATASET_THRESHOLDS.MEDIUM &&
        i % chunkSize === 0 &&
        i > 0
      ) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    // Create indexed values in original order
    monitor.setStage("indexing-values");
    const indexedValues: MerkleValue[] = [];
    for (let i = 0; i < values.length; i++) {
      indexedValues.push({
        value: values[i],
        treeIndex: origToTreePos[i],
      });

      if (i % chunkSize === 0 && i > 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    // Build internal nodes
    monitor.setStage("building-internal-nodes");
    for (let i = treeSize - 1 - leaves.length; i >= 0; i--) {
      if (i % chunkSize === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      const leftIdx = 2 * i + 1;
      const rightIdx = 2 * i + 2;

      const leftHash = this.byteArrayToBuffer(tree[leftIdx]);
      const rightHash =
        rightIdx < tree.length
          ? this.byteArrayToBuffer(tree[rightIdx])
          : leftHash;

      // Sort pair before hashing (NEAR requirement)
      const sortedPair =
        leftHash.compare(rightHash) <= 0
          ? [leftHash, rightHash]
          : [rightHash, leftHash];

      const nodeHash = keccak("keccak256")
        .update(Buffer.concat(sortedPair))
        .digest();

      tree[i] = this.bufferToByteArray(nodeHash);
    }

    monitor.setStage("complete");
    monitor.recordMetrics(values.length);

    // Log performance summary for large datasets
    if (values.length > DATASET_THRESHOLDS.SMALL) {
      monitor.logSummary();
    }

    return new NearMerkleTree(tree, indexedValues, leafEncoding);
  }

  private static convertValue(value: MerkleTreeData): MerkleTreeData {
    let account: string, lockup: string, amount: string;

    ({ account, lockup, amount } = value);

    // Ensure account is properly formatted for NEAR
    let formattedAccount = account.toLowerCase();

    let formattedLockup = lockup.toLowerCase();
    const isLockupNearAccount =
      formattedLockup.includes(".") ||
      formattedLockup.match(REGEX_PATTERNS.HEX_64_CHAR);

    if (!isLockupNearAccount) {
      if (formattedLockup.startsWith("0x")) {
        formattedLockup = formattedLockup.substring(2);
      }
      formattedLockup = formattedLockup.padStart(
        FORMATS.NEAR_ACCOUNT_HEX_LENGTH,
        "0"
      );
    }

    // Convert amount to string representation
    let formattedAmount: string;

    // Validate format - must be digits with optional decimal point
    if (!REGEX_PATTERNS.AMOUNT_VALIDATION.test(amount)) {
      throw new Error(`Invalid amount format: ${amount}`);
    }

    // Handle decimal strings by removing the decimal part (always use string splitting)
    const [integerPart] = amount.split(".");
    formattedAmount = new BN(integerPart, 10).toString();

    return {
      account: formattedAccount,
      lockup: formattedLockup,
      amount: formattedAmount,
    };
  }

  private static encodeBorshValue(value: MerkleTreeData): Buffer {
    const accountBytes = Buffer.from(value.account, "utf8");
    const lockupBytes = Buffer.from(value.lockup, "utf8");

    const accountLength = Buffer.alloc(4);
    accountLength.writeUInt32LE(accountBytes.length, 0);

    const lockupLength = Buffer.alloc(4);
    lockupLength.writeUInt32LE(lockupBytes.length, 0);

    const amountBN = new BN(value.amount, 10);
    const amountBytes = Buffer.alloc(16);

    const amountArray = amountBN.toArray("le", 16);
    for (let i = 0; i < 16; i++) {
      amountBytes[i] = amountArray[i] || 0;
    }

    return Buffer.concat([
      accountLength,
      accountBytes,
      lockupLength,
      lockupBytes,
      amountBytes,
    ]);
  }

  getProof(index: number): number[][] {
    if (index < 0 || index >= this.tree.length) {
      throw new Error("Index out of range");
    }

    return this.getProofUnsafe(index);
  }

  private getProofUnsafe(index: number): number[][] {
    const proof: number[][] = [];
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

  verify(proof: number[][], leafValue: MerkleTreeData): boolean {
    const convertedValue = NearMerkleTree.convertValue(leafValue);
    const encoded = NearMerkleTree.encodeBorshValue(convertedValue);

    let current = keccak("keccak256").update(encoded).digest();

    // Process proof elements
    for (const sibling of proof) {
      const siblingHash = NearMerkleTree.byteArrayToBuffer(sibling);

      // Sort pair before hashing
      const sortedPair =
        current.compare(siblingHash) <= 0
          ? [current, siblingHash]
          : [siblingHash, current];

      current = keccak("keccak256").update(Buffer.concat(sortedPair)).digest();
    }

    const rootHash = NearMerkleTree.byteArrayToBuffer(this.tree[0]);
    return current.equals(rootHash);
  }

  getRoot(): string {
    const bytes = this.tree[0];
    return JSON.stringify(bytes);
  }

  dump(): MerkleTreeDump {
    return {
      format: FORMATS.MERKLE_TREE_VERSION,
      tree: this.tree,
      values: this.values,
      leafEncoding: this.leafEncoding,
    };
  }

  static load(data: MerkleTreeDump): NearMerkleTree {
    if (data.format !== FORMATS.MERKLE_TREE_VERSION) {
      throw new Error(`Unknown format '${data.format}'`);
    }
    if (!data.leafEncoding) {
      throw new Error("Expected leaf encoding");
    }
    return new NearMerkleTree(data.tree, data.values, data.leafEncoding);
  }
}
