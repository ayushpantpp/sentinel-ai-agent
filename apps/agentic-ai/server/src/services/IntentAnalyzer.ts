import { intentAnalysisSchema } from "../models/schemas.js";
import type { IntentAnalysis } from "../types/domain.js";
import { extractJson } from "../utils/json.js";

export class IntentAnalyzer {
  buildPrompt(question: string): string {
    return `You classify aircraft manufacturing and airline operations requests. Return ONLY JSON: {"intent":"string","entities":{},"candidateApis":["customer-search","fleet-by-customer","fleet-all","maintenance-by-aircraft","deliveries-by-customer","production-orders-all","production-orders-by-customer","pilot-training-due","pilot-training-by-customer","aircraft-updates-all","aircraft-updates-pending"]}. Add entities.customer only when the question names a real company. Select every API needed for a cross-service question. Question: ${question}`;
  }

  parse(raw: string): IntentAnalysis {
    const parsed = intentAnalysisSchema.parse(extractJson(raw));
    const entities = Object.fromEntries(Object.entries(parsed.entities).filter(([, value]) =>
      !/^(optional|unknown|none|n\/a|null|not specified)(\s+company)?$/i.test(value.trim())
    ));
    return { ...parsed, entities };
  }
}
