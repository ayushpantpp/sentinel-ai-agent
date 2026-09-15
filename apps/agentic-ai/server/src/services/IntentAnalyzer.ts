import { intentAnalysisSchema } from "../models/schemas.js";
import type { IntentAnalysis } from "../types/domain.js";
import { extractJson } from "../utils/json.js";

export class IntentAnalyzer {
  buildPrompt(question: string): string {
    return `You classify aviation operations requests. Return ONLY JSON: {"intent":"string","entities":{"customer":"optional company"},"candidateApis":["customer-search","fleet-by-customer","fleet-all","maintenance-by-aircraft","deliveries-by-customer"]}. Question: ${question}`;
  }

  parse(raw: string): IntentAnalysis {
    return intentAnalysisSchema.parse(extractJson(raw));
  }
}
