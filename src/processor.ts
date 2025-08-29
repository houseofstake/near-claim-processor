import express from 'express';
import { IStorage, GCSConfig } from './storage';
import { DatabaseService } from './database';
import { TreeProcessor } from './tree-processor';
import { setupRoutes } from './routes';

export interface ProcessorConfig {
  storage: IStorage;
  database: DatabaseService;
  gcsConfig?: GCSConfig;
  useLocalStorage?: boolean;
}

export class NearClaimProcessor {
  private app: express.Application;
  private activeProcessors = new Map<string, TreeProcessor>();

  constructor(private config: ProcessorConfig) {
    this.app = express();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '500mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '500mb' }));
    this.app.use(express.text({ type: 'text/csv', limit: '500mb' }));
  }

  private setupRoutes(): void {
    setupRoutes(this.app, {
      storage: this.config.storage,
      database: this.config.database,
      activeProcessors: this.activeProcessors
    });
  }

  async start(port: number = 8000, host: string = '0.0.0.0'): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(port, host, () => {
        console.log(`NEAR Claim Processor running on http://${host}:${port}`);
        resolve();
      });
    });
  }

  getApp(): express.Application {
    return this.app;
  }
}