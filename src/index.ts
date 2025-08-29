import { NearClaimProcessor } from './processor';
import { GCSStorage, LocalStorage, IStorage } from './storage';
import { DatabaseService } from './database';

async function main() {
  // Parse GCS credentials from environment
  let credentials;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    } catch (error) {
      console.error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:', error);
      process.exit(1);
    }
  }

  const config = {
    // GCS configuration
    projectId: process.env.GCS_PROJECT_ID,
    bucketName: process.env.GCS_BUCKET || 'near-claim-processor',
    credentials: credentials,
  };

  let storage: IStorage;

  // Determine storage backend
  const useLocalStorage = process.env.USE_LOCAL_STORAGE === 'true' || 
    (!config.bucketName && !process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  
  if (useLocalStorage) {
    console.log('Using local file storage');
    storage = new LocalStorage(process.env.DATA_PATH || './data');
  } else {
    console.log('Using Google Cloud Storage');
    const gcsStorage = new GCSStorage(config);
    await gcsStorage.initialize();
    storage = gcsStorage;
  }

  const database = new DatabaseService();
  await database.initialize();

  // Create processor
  const processor = new NearClaimProcessor({
    storage,
    database,
    gcsConfig: config,
    useLocalStorage
  });

  // Start server
  const port = parseInt(process.env.PORT || '8000');
  const host = process.env.HOST || '0.0.0.0';

  await processor.start(port, host);
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// Start the application
main().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});