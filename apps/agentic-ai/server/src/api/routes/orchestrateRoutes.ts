import { Router } from "express";
import type { OrchestratorService } from "../../services/OrchestratorService.js";
import { createOrchestrateController } from "../controllers/orchestrateController.js";
export const createOrchestrateRouter = (service: OrchestratorService): Router => { const router = Router(); router.post("/orchestrate", createOrchestrateController(service)); return router; };
