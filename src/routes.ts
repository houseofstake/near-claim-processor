import express from 'express';
import { IStorage } from './storage';
import { DatabaseService } from './database';
import { TreeProcessor, EntitlementEntry } from './tree-processor';

export interface RoutesConfig {
  storage: IStorage;
  database: DatabaseService;
  activeProcessors: Map<string, TreeProcessor>;
}

export function setupRoutes(app: express.Application, config: RoutesConfig): void {
  const { storage, database, activeProcessors } = config;

  const requireApiKey = (): express.RequestHandler => {
    return (req, res, next) => {
      const apiKey = process.env.API_KEY;
      
      if (!apiKey) {
        return res.status(500).json({ error: 'API key not configured' });
      }

      const providedKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
      
      if (!providedKey || providedKey !== apiKey) {
        return res.status(401).json({ error: 'Invalid or missing API key' });
      }

      next();
    };
  };

  const parseCSV = (csvData: string): EntitlementEntry[] => {
    const lines = csvData.trim().split('\n');
    const entitlements: EntitlementEntry[] = [];
    
    // Skip header if it exists (check if first line contains 'address' and 'amount')
    const startIndex = lines[0] && lines[0].toLowerCase().includes('address') ? 1 : 0;
    
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const [address, amount] = line.split(',').map(field => field.trim());
      
      if (!address || !amount) {
        throw new Error(`Invalid CSV format at line ${i + 1}: ${line}`);
      }
      
      // Validate amount is a valid number
      if (!/^\d+(\.\d+)?$/.test(amount)) {
        throw new Error(`Invalid amount format at line ${i + 1}: ${amount}`);
      }
      const numericAmount = parseFloat(amount);
      if (numericAmount < 0) {
        throw new Error(`Negative amount at line ${i + 1}: ${amount}`);
      }
      
      entitlements.push({ address, amount });
    }
    
    return entitlements;
  };

  // Health check
  app.get('/health', (_, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // Process root endpoint
  app.get('/root', requireApiKey(), async (req, res) => {
    const projectId = req.query.project_id as string;
    
    if (!projectId) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    try {
      // Check if processor is currently active
      const activeProcessor = activeProcessors.get(projectId);
      if (activeProcessor) {
        return res.json(activeProcessor.getResult());
      }

      // Check if project exists in database
      const existingProject = await database.getProject(projectId);
      if (!existingProject) {
        return res.status(404).json({ 
          error: 'Project not found. Please upload entitlements first using POST /upload/:projectId'
        });
      }

      // Check if entitlements file exists
      const entitlementsData = await storage.retrieveData(`user-entitlement-file/${projectId}.csv`);
      if (!entitlementsData) {
        return res.status(404).json({ 
          error: 'Entitlements file not found. Please upload entitlements first using POST /upload/:projectId'
        });
      }

      // If project is in error state, allow restart
      if (existingProject.status === 'error') {
        const processor = new TreeProcessor(storage, database, projectId);
        activeProcessors.set(projectId, processor);
        
        // Start processing in background
        processor.run().finally(() => {
          // Clean up after completion or error
          setTimeout(() => {
            activeProcessors.delete(projectId);
          }, 300000); // Keep for 5 minutes after completion
        });

        return res.json(processor.getResult());
      }

      // Return existing project status
      const statusData = await database.getProjectStatus(projectId);
      res.json(statusData || { 
        status: 'unknown', 
        projectId, 
        startTime: existingProject.startTime.toISOString()
      });
    } catch (error) {
      console.error(`Error processing project ${projectId}:`, error);
      res.status(500).json({ 
        error: 'Internal server error', 
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get proof for specific address
  app.get('/proof/:projectId/:address', requireApiKey(), async (req, res) => {
    const { projectId, address } = req.params;
    
    try {
      const proofData = await storage.retrieveJSON(`v1/proof/${projectId}/${address.toLowerCase()}.json`);
      
      if (!proofData) {
        return res.status(404).json({ error: 'Proof not found for address' });
      }

      res.json(proofData);
    } catch (error) {
      console.error(`Error retrieving proof for ${address} in project ${projectId}:`, error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Create project without uploading entitlements
  app.post('/create/:projectId', requireApiKey(), async (req, res) => {
    const { projectId } = req.params;
    
    try {
      // Check if project already exists
      const existingProject = await database.getProject(projectId);
      if (existingProject) {
        return res.status(409).json({ 
          error: 'Project already exists',
          currentStatus: existingProject.status
        });
      }

      // Create project record only - no processing until entitlements are uploaded
      await database.createProject({
        id: projectId,
        status: 'created',
        startTime: new Date(),
      });

      res.json({ 
        success: true, 
        message: `Project ${projectId} created. Upload entitlements to start processing.`,
        projectId,
        status: 'created'
      });
    } catch (error) {
      console.error(`Error creating project ${projectId}:`, error);
      res.status(500).json({ 
        error: 'Failed to create project',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Upload entitlements file (CSV only)
  app.post('/upload/:projectId', requireApiKey(), async (req, res) => {
    const { projectId } = req.params;
    
    try {
      const csvData = req.body as string;
      if (!csvData || typeof csvData !== 'string' || csvData.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid CSV data' });
      }
      
      const entitlements = parseCSV(csvData);

      // Validate entitlements format
      for (const entry of entitlements) {
        if (!entry.address || !entry.amount) {
          throw new Error('Each entitlement must have address and amount');
        }
      }

      // Check if project already exists
      const existingProject = await database.getProject(projectId);
      if (existingProject) {
        // Allow upload if project is in 'created', 'error' state, or if re-uploading to same project
        if (!['created', 'error'].includes(existingProject.status)) {
          return res.status(409).json({ 
            error: 'Project already exists and is not in error or created state',
            currentStatus: existingProject.status
          });
        }
      }

      // Store entitlements
      await storage.storeJSON(`user-entitlement-file/${projectId}.csv`, entitlements);
      
      // Auto-create project and start tree processing
      let processor = activeProcessors.get(projectId);
      
      if (!processor) {
        // Create new processor
        processor = new TreeProcessor(storage, database, projectId);
        activeProcessors.set(projectId, processor);
        
        // Start processing in background
        processor.run().finally(() => {
          // Clean up after completion or error
          setTimeout(() => {
            activeProcessors.delete(projectId);
          }, 300000); // Keep for 5 minutes after completion
        });
      }

      res.json({ 
        success: true, 
        message: `Uploaded ${entitlements.length} entitlements for project ${projectId}`,
        processing: processor.getResult()
      });
    } catch (error) {
      console.error(`Error uploading entitlements for project ${projectId}:`, error);
      res.status(500).json({ 
        error: 'Failed to upload entitlements',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get tree data
  app.get('/tree/:projectId', requireApiKey(), async (req, res) => {
    const { projectId } = req.params;
    
    try {
      const treeData = await storage.retrieveJSON(`project-tree/${projectId}.json`);
      
      if (!treeData) {
        return res.status(404).json({ error: 'Tree not found for project' });
      }

      res.json(treeData);
    } catch (error) {
      console.error(`Error retrieving tree for project ${projectId}:`, error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get cached status without triggering refresh
  app.get('/status/:projectId', requireApiKey(), async (req, res) => {
    const { projectId } = req.params;
    
    try {
      // First check if processor is currently active
      const activeProcessor = activeProcessors.get(projectId);
      if (activeProcessor) {
        const result = activeProcessor.getResult();
        const treeData = await storage.retrieveJSON(`project-tree/${projectId}.json`);
        return res.json({
          ...result,
          treeData: treeData || null
        });
      }

      // Get status from database
      const statusData = await database.getProjectStatus(projectId);
      
      if (!statusData) {
        return res.status(404).json({ error: 'No status found for project' });
      }

      // Get tree data if available
      const treeData = await storage.retrieveJSON(`project-tree/${projectId}.json`);

      res.json({
        ...statusData,
        treeData: treeData || null
      });
    } catch (error) {
      console.error(`Error retrieving status for project ${projectId}:`, error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // List projects
  app.get('/projects', requireApiKey(), async (_, res) => {
    try {
      const projects = await database.listProjects();
      res.json({ projects });
    } catch (error) {
      console.error('Error listing projects:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get project statistics
  app.get('/stats/:projectId', requireApiKey(), async (req, res) => {
    const { projectId } = req.params;
    
    try {
      const stats = await database.getProjectStats(projectId);
      
      if (!stats) {
        return res.status(404).json({ error: 'Project not found' });
      }

      res.json(stats);
    } catch (error) {
      console.error(`Error retrieving stats for project ${projectId}:`, error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Mark proof as claimed
  app.post('/claim/:projectId/:address', requireApiKey(), async (req, res) => {
    const { projectId, address } = req.params;
    const { txHash } = req.body;
    
    if (!txHash) {
      return res.status(400).json({ error: 'txHash is required' });
    }

    try {
      const proof = await database.markProofClaimed(projectId, address, txHash);
      res.json(proof);
    } catch (error) {
      console.error(`Error marking proof claimed for ${address} in project ${projectId}:`, error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}