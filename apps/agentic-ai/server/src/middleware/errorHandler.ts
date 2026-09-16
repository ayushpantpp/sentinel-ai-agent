import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors.js";
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => { if (error instanceof ZodError) return res.status(400).json({ error: "Invalid request", details: error.flatten() }); const status = error instanceof AppError ? error.status : 500; return res.status(status).json({ error: error instanceof Error ? error.message : "Unexpected error" }); };
