import express from "express";
import { IStorage } from "./storage";
import { DatabaseService } from "./database";
import { TreeProcessor } from "./tree-processor";
import { HTTP_STATUS, TIMEOUTS } from "./constants";
import { ValidationUtils } from "./validation";
import { ValidationError, ErrorUtils } from "./errors";
import { parseCSVToEntitlements, checkForDuplicateAddresses } from "./utils";

export interface RoutesConfig {
  storage: IStorage;
  database: DatabaseService;
  activeProcessors: Map<string, TreeProcessor>;
}

export function setupRoutes(
  app: express.Application,
  config: RoutesConfig
): void {
  const { storage, database, activeProcessors } = config;

  const requireApiKey = (): express.RequestHandler => {
    return (req, res, next) => {
      const apiKey = process.env.API_KEY;

      if (!apiKey) {
        return res
          .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
          .json({ error: "API key not configured" });
      }

      const providedKey =
        (req.headers["x-api-key"] as string) ||
        (req.headers["authorization"] as string)?.replace("Bearer ", "");

      try {
        if (providedKey) {
          ValidationUtils.validateApiKey(providedKey);
        }

        if (!providedKey || providedKey !== apiKey) {
          return res
            .status(HTTP_STATUS.UNAUTHORIZED)
            .json({ error: "Invalid or missing API key" });
        }
      } catch (error) {
        if (error instanceof ValidationError) {
          return res
            .status(HTTP_STATUS.UNAUTHORIZED)
            .json({ error: error.message });
        }
        throw error;
      }

      next();
    };
  };

  // Health check
  app.get("/health", (_, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  // Process root endpoint
  app.get("/root", requireApiKey(), async (req, res) => {
    try {
      const projectId = req.query.project_id as string;

      if (!projectId) {
        throw new ValidationError("project_id is required");
      }

      ValidationUtils.validateProjectId(projectId);
      // Check if processor is currently active
      const activeProcessor = activeProcessors.get(projectId);
      if (activeProcessor) {
        return res.json(activeProcessor.getResult());
      }

      // Check if project exists in database
      const existingProject = await database.getProject(projectId);
      if (!existingProject) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error:
            "Project not found. Please upload entitlements first using POST /upload/:projectId",
        });
      }

      // Check if entitlements file exists
      const entitlementsData = await storage.retrieveData(
        `user-entitlement-file/${projectId}.csv`
      );
      if (!entitlementsData) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error:
            "Entitlements file not found. Please upload entitlements first using POST /upload/:projectId",
        });
      }

      // If project is in error state, allow restart
      if (existingProject.status === "error") {
        const processor = new TreeProcessor(storage, database, projectId);
        activeProcessors.set(projectId, processor);

        // Start processing in background
        processor.run().finally(() => {
          // Clean up after completion or error
          setTimeout(() => {
            activeProcessors.delete(projectId);
          }, TIMEOUTS.PROCESSOR_CLEANUP_MS);
        });

        return res.json(processor.getResult());
      }

      // Return existing project status
      const statusData = await database.getProjectStatus(projectId);
      res.json(
        statusData || {
          status: "unknown",
          projectId,
          startTime: existingProject.startTime.toISOString(),
        }
      );
    } catch (error) {
      ErrorUtils.logError(error as Error, "root endpoint");
      const statusCode =
        error instanceof ValidationError
          ? HTTP_STATUS.BAD_REQUEST
          : HTTP_STATUS.INTERNAL_SERVER_ERROR;
      res.status(statusCode).json({
        error: error instanceof Error ? error.message : "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get proof for specific address
  app.get("/proof/:projectId/:address", requireApiKey(), async (req, res) => {
    const { projectId, address } = req.params;

    try {
      const proofData = await storage.retrieveJSON(
        `v1/proof/${projectId}/${address.toLowerCase()}.json`
      );

      if (!proofData) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json({ error: "Proof not found for address" });
      }

      res.json(proofData);
    } catch (error) {
      console.error(
        `Error retrieving proof for ${address} in project ${projectId}:`,
        error
      );
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get all proofs for an address across projects
  app.get("/proofs/:address", requireApiKey(), async (req, res) => {
    const { address } = req.params;

    try {
      ValidationUtils.validateNearAddress(address);

      const proofs = await database.getProofsByAddress(address);

      if (!proofs || proofs.length === 0) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          error: "No proofs found for address across any projects",
          address: address.toLowerCase(),
        });
      }

      const enrichedProofs = await Promise.all(
        proofs.map(async (proof) => {
          try {
            console.log("proof", proof);
            const proofData = await storage.retrieveJSON(proof.gcsPath);
            console.log("proofData", proofData);
            return {
              projectId: proof.projectId,
              address: proof.address,
              amount: proof.amount,
              treeIndex: proof.treeIndex,
              claimed: proof.claimed,
              claimedAt: proof.claimedAt,
              claimedTxHash: proof.claimedTxHash,
              createdAt: proof.createdAt,
              proofData: proofData || null,
            };
          } catch {
            return {
              projectId: proof.projectId,
              address: proof.address,
              amount: proof.amount,
              treeIndex: proof.treeIndex,
              claimed: proof.claimed,
              claimedAt: proof.claimedAt,
              claimedTxHash: proof.claimedTxHash,
              createdAt: proof.createdAt,
              proofData: null,
            };
          }
        })
      );

      res.json({
        address: address.toLowerCase(),
        totalProofs: proofs.length,
        proofs: enrichedProofs,
      });
    } catch (error) {
      ErrorUtils.logError(error as Error, `get proofs for address ${address}`);
      const statusCode =
        error instanceof ValidationError
          ? HTTP_STATUS.BAD_REQUEST
          : HTTP_STATUS.INTERNAL_SERVER_ERROR;
      res.status(statusCode).json({
        error: error instanceof Error ? error.message : "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Create project without uploading entitlements
  app.post("/create/:projectId", requireApiKey(), async (req, res) => {
    const { projectId } = req.params;

    try {
      // Check if project already exists
      const existingProject = await database.getProject(projectId);
      if (existingProject) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          error: "Project already exists",
          currentStatus: existingProject.status,
        });
      }

      // Create project record only - no processing until entitlements are uploaded
      await database.createProject({
        id: projectId,
        status: "created",
        startTime: new Date(),
      });

      res.json({
        success: true,
        message: `Project ${projectId} created. Upload entitlements to start processing.`,
        projectId,
        status: "created",
      });
    } catch (error) {
      console.error(`Error creating project ${projectId}:`, error);
      res.status(500).json({
        error: "Failed to create project",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Upload entitlements file (CSV only)
  app.post("/upload", requireApiKey(), async (req, res) => {
    try {
      const csvData = req.body as string;
      if (
        !csvData ||
        typeof csvData !== "string" ||
        csvData.trim().length === 0
      ) {
        throw new ValidationError("Invalid CSV data");
      }

      const entitlements = parseCSVToEntitlements(csvData);

      // Check for duplicate addresses
      checkForDuplicateAddresses(entitlements);

      // Check if latest campaign is unpublished - if so, replace it
      const latestCampaign = await database.getLatestCampaign();
      let projectId: string;

      if (latestCampaign && !latestCampaign.publishedToChain) {
        // Replace the unpublished campaign
        projectId = latestCampaign.id;

        // Clean up any active processor for this campaign
        const existingProcessor = activeProcessors.get(projectId);
        if (existingProcessor) {
          activeProcessors.delete(projectId);
        }

        // Delete existing proofs for this campaign (cascade will handle this)
        // Update the project to reset it
        await database.updateProject(projectId, {
          status: "created",
          endTime: undefined,
          numEntitlements: undefined,
          totalClaimValue: undefined,
          rootHash: undefined,
          buildElapsed: undefined,
          totalElapsed: undefined,
          buildStartTime: undefined,
          endGenerateTime: undefined,
          generated: undefined,
          errorMessage: undefined,
        });

        // Delete all existing proofs
        await database.prisma.proof.deleteMany({
          where: { projectId },
        });
      } else {
        // Create a new sequential campaign
        projectId = await database.getNextCampaignId();
      }

      // Store entitlements
      await storage.storeJSON(
        `user-entitlement-file/${projectId}.csv`,
        entitlements
      );

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
          }, TIMEOUTS.PROCESSOR_CLEANUP_MS);
        });
      }

      res.json({
        success: true,
        message: `Uploaded ${entitlements.length} entitlements for campaign ${projectId}`,
        projectId,
        campaignId: projectId,
        replacedExisting: latestCampaign && !latestCampaign.publishedToChain,
        processing: processor.getResult(),
      });
    } catch (error) {
      ErrorUtils.logError(error as Error, `upload entitlements`);
      const statusCode =
        error instanceof ValidationError
          ? HTTP_STATUS.BAD_REQUEST
          : HTTP_STATUS.INTERNAL_SERVER_ERROR;
      res.status(statusCode).json({
        error: error instanceof Error ? error.message : "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get tree data
  app.get("/tree/:projectId", requireApiKey(), async (req, res) => {
    const { projectId } = req.params;

    try {
      const treeData = await storage.retrieveJSON(
        `project-tree/${projectId}.json`
      );

      if (!treeData) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json({ error: "Tree not found for project" });
      }

      res.json(treeData);
    } catch (error) {
      console.error(`Error retrieving tree for project ${projectId}:`, error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get cached status without triggering refresh
  app.get("/status/:projectId", requireApiKey(), async (req, res) => {
    const { projectId } = req.params;

    try {
      // First check if processor is currently active
      const activeProcessor = activeProcessors.get(projectId);
      if (activeProcessor) {
        const result = activeProcessor.getResult();
        const treeData = await storage.retrieveJSON(
          `project-tree/${projectId}.json`
        );
        return res.json({
          ...result,
          treeData: treeData || null,
        });
      }

      // Get status from database
      const statusData = await database.getProjectStatus(projectId);

      if (!statusData) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json({ error: "No status found for project" });
      }

      // Get tree data if available
      const treeData = await storage.retrieveJSON(
        `project-tree/${projectId}.json`
      );

      res.json({
        ...statusData,
        treeData: treeData || null,
      });
    } catch (error) {
      console.error(`Error retrieving status for project ${projectId}:`, error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // List projects
  app.get("/projects", requireApiKey(), async (_, res) => {
    try {
      const projects = await database.listProjects();
      res.json({ projects });
    } catch (error) {
      console.error("Error listing projects:", error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get project statistics
  app.get("/stats/:projectId", requireApiKey(), async (req, res) => {
    const { projectId } = req.params;

    try {
      const stats = await database.getProjectStats(projectId);

      if (!stats) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json({ error: "Project not found" });
      }

      res.json(stats);
    } catch (error) {
      console.error(`Error retrieving stats for project ${projectId}:`, error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Mark proof as claimed
  app.post("/claim/:projectId/:address", requireApiKey(), async (req, res) => {
    try {
      const { projectId, address } = req.params;
      const { txHash } = req.body;

      ValidationUtils.validateProjectId(projectId);
      ValidationUtils.validateNearAddress(address);

      if (!txHash) {
        throw new ValidationError("txHash is required");
      }

      ValidationUtils.validateTxHash(txHash);

      const proof = await database.markProofClaimed(projectId, address, txHash);
      res.json(proof);
    } catch (error) {
      ErrorUtils.logError(
        error as Error,
        `mark proof claimed for ${req.params.address} in project ${req.params.projectId}`
      );
      const errorResponse = ErrorUtils.toErrorResponse(error as Error);
      const statusCode =
        errorResponse.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
      res.status(statusCode).json({
        error:
          error instanceof ValidationError
            ? error.message
            : errorResponse.error,
        message: errorResponse.message,
      });
    }
  });

  // Toggle project published to chain status
  app.post("/publish/:projectId", requireApiKey(), async (req, res) => {
    try {
      const { projectId } = req.params;

      ValidationUtils.validateProjectId(projectId);

      const updatedProject = await database.toggleProjectPublishedStatus(
        projectId
      );
      res.json({
        success: true,
        projectId: updatedProject.id,
        publishedToChain: updatedProject.publishedToChain,
        updatedAt: updatedProject.updatedAt,
      });
    } catch (error) {
      ErrorUtils.logError(
        error as Error,
        `toggle published status for project ${req.params.projectId}`
      );
      const errorResponse = ErrorUtils.toErrorResponse(error as Error);
      const statusCode =
        errorResponse.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
      res.status(statusCode).json({
        error: errorResponse.error,
        message: errorResponse.message,
      });
    }
  });
}
