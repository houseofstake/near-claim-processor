import { Storage } from '@google-cloud/storage';
import * as fs from 'fs';
import * as path from 'path';
import { StorageError, ConfigurationError } from './errors';

export interface GCSConfig {
  projectId?: string;
  bucketName: string;
  credentials?: any;
}

export interface StorageItem {
  key: string;
  data: any;
  timestamp: number;
}

export class GCSStorage {
  private storage: Storage;
  private bucketName: string;

  constructor(config: GCSConfig) {
    this.bucketName = config.bucketName;

    let storageConfig: any = {
      projectId: config.projectId,
    };

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      try {
        const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
        storageConfig.credentials = credentials;
      } catch (error) {
        throw new ConfigurationError('Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON format', error as Error);
      }
    }

    this.storage = new Storage(storageConfig);
  }

  async initialize(): Promise<void> {
    try {
      // Verify bucket exists
      const [exists] = await this.storage.bucket(this.bucketName).exists();
      if (!exists) {
        throw new ConfigurationError(`GCS bucket ${this.bucketName} does not exist`);
      }
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }
      throw new StorageError('bucket verification', error as Error);
    }
  }

  async storeData(key: string, data: any): Promise<void> {
    try {
      const storageItem: StorageItem = {
        key,
        data,
        timestamp: Date.now()
      };

      const file = this.storage.bucket(this.bucketName).file(key);
      await file.save(JSON.stringify(storageItem), {
        metadata: {
          contentType: 'application/json',
        },
      });
    } catch (error) {
      throw new StorageError(`store data with key '${key}'`, error as Error);
    }
  }

  async retrieveData(key: string): Promise<any> {
    try {
      const file = this.storage.bucket(this.bucketName).file(key);
      const [exists] = await file.exists();
      
      if (!exists) {
        return null;
      }

      const [contents] = await file.download();
      const storageItem: StorageItem = JSON.parse(contents.toString());
      return storageItem.data;
    } catch (error) {
      console.error(`Failed to retrieve data for key ${key}:`, error);
      return null;
    }
  }

  async listKeys(prefix?: string): Promise<string[]> {
    try {
      const options: any = {};
      if (prefix) {
        options.prefix = prefix;
      }
      
      const [files] = await this.storage.bucket(this.bucketName).getFiles(options);
      return files.map(file => file.name);
    } catch (error) {
      console.error(`Failed to list keys:`, error);
      return [];
    }
  }

  async deleteData(key: string): Promise<void> {
    try {
      const file = this.storage.bucket(this.bucketName).file(key);
      await file.delete();
    } catch (error) {
      throw new StorageError(`delete data with key '${key}'`, error as Error);
    }
  }

  // Batch operations for efficiency
  async storeBatch(items: Array<{ key: string; data: any }>): Promise<void> {
    try {
      const uploadPromises = items.map(item => {
        const storageItem: StorageItem = {
          key: item.key,
          data: item.data,
          timestamp: Date.now()
        };
        
        const file = this.storage.bucket(this.bucketName).file(item.key);
        return file.save(JSON.stringify(storageItem), {
          metadata: {
            contentType: 'application/json',
          },
        });
      });
      
      await Promise.all(uploadPromises);
    } catch (error) {
      throw new StorageError(`batch store ${items.length} items`, error as Error);
    }
  }

  // Utility methods for common patterns
  async storeJSON(key: string, data: object): Promise<void> {
    await this.storeData(key, data);
  }

  async retrieveJSON(key: string): Promise<object | null> {
    return await this.retrieveData(key);
  }

  async storeBlob(key: string, data: Buffer): Promise<void> {
    const base64Data = data.toString('base64');
    await this.storeData(key, { type: 'blob', data: base64Data });
  }

  async retrieveBlob(key: string): Promise<Buffer | null> {
    const result = await this.retrieveData(key);
    if (!result || result.type !== 'blob') {
      return null;
    }
    return Buffer.from(result.data, 'base64');
  }
}

// Local file storage fallback for development
export class LocalStorage {
  private basePath: string;

  constructor(basePath: string = './data') {
    this.basePath = basePath;
    this.ensureDirectory(this.basePath);
  }

  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async storeData(key: string, data: any): Promise<void> {
    const filePath = this.getFilePath(key);
    const dir = path.dirname(filePath);
    this.ensureDirectory(dir);

    const storageItem: StorageItem = {
      key,
      data,
      timestamp: Date.now()
    };

    fs.writeFileSync(filePath, JSON.stringify(storageItem, null, 2));
  }

  async retrieveData(key: string): Promise<any> {
    const filePath = this.getFilePath(key);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const storageItem: StorageItem = JSON.parse(content);
      return storageItem.data;
    } catch (error) {
      console.error(`Failed to read file ${filePath}:`, error);
      return null;
    }
  }

  async listKeys(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    
    if (!fs.existsSync(this.basePath)) {
      return keys;
    }

    const entries = fs.readdirSync(this.basePath);
    
    for (const entry of entries) {
      if (entry.endsWith('.json')) {
        // Convert back from file naming convention
        const keyWithoutExt = entry.slice(0, -5); // Remove .json extension
        const originalKey = keyWithoutExt.replace(/_/g, '/');
        
        if (!prefix || originalKey.startsWith(prefix)) {
          keys.push(originalKey);
        }
      }
    }
    
    return keys;
  }

  async deleteData(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async storeBatch(items: Array<{ key: string; data: any }>): Promise<void> {
    const promises = items.map(item => this.storeData(item.key, item.data));
    await Promise.all(promises);
  }

  private getFilePath(key: string): string {
    return path.join(this.basePath, `${key.replace(/[\/\\]/g, '_')}.json`);
  }

  // Utility methods
  async storeJSON(key: string, data: object): Promise<void> {
    await this.storeData(key, data);
  }

  async retrieveJSON(key: string): Promise<object | null> {
    return await this.retrieveData(key);
  }

  async storeBlob(key: string, data: Buffer): Promise<void> {
    const base64Data = data.toString('base64');
    await this.storeData(key, { type: 'blob', data: base64Data });
  }

  async retrieveBlob(key: string): Promise<Buffer | null> {
    const result = await this.retrieveData(key);
    if (!result || result.type !== 'blob') {
      return null;
    }
    return Buffer.from(result.data, 'base64');
  }
}

// Storage interface for easy swapping between implementations
export interface IStorage {
  storeData(key: string, data: any): Promise<void>;
  retrieveData(key: string): Promise<any>;
  listKeys(prefix?: string): Promise<string[]>;
  deleteData(key: string): Promise<void>;
  storeBatch(items: Array<{ key: string; data: any }>): Promise<void>;
  storeJSON(key: string, data: object): Promise<void>;
  retrieveJSON(key: string): Promise<object | null>;
  storeBlob(key: string, data: Buffer): Promise<void>;
  retrieveBlob(key: string): Promise<Buffer | null>;
}