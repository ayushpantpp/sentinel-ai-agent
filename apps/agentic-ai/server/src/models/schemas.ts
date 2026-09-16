import { z } from "zod";
export const intentAnalysisSchema = z.object({ intent: z.string().min(1), entities: z.record(z.string(), z.string()), candidateApis: z.array(z.string()).min(1) });
export const questionSchema = z.object({ question: z.string().trim().min(3).max(1000) });
