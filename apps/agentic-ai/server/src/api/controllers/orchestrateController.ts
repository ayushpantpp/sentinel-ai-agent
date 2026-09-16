import type { Request, Response, NextFunction } from "express";
import { questionSchema } from "../../models/schemas.js";
import type { OrchestratorService } from "../../services/OrchestratorService.js";
export const createOrchestrateController = (service: OrchestratorService) => async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const { question } = questionSchema.parse(req.body); res.json(await service.run(question)); } catch (error: unknown) { next(error); } };
