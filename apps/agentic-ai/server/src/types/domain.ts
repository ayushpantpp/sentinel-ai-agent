export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export interface ApiDefinition { id: string; name: string; description: string; endpoint: string; method: HttpMethod; requiredInputs: string[]; optionalInputs: string[]; keywords: string[]; dependencies: string[]; outputSchema: string; }
export interface IntentAnalysis { intent: string; entities: Record<string, string>; candidateApis: string[]; }
export interface PlanStep { apiId: string; input: Record<string, string>; dependsOn: string[]; }
export interface ExecutionPlan { intent: string; steps: PlanStep[]; rationale: string; }
export interface ApiCallResult { apiId: string; endpoint: string; status: number; durationMs: number; data: unknown; }
export interface LlmInteraction { stage: "intent_analysis" | "final_answer"; prompt: string; response: string; durationMs: number; }
export interface OrchestrationResult { question: string; analysis: IntentAnalysis; plan: ExecutionPlan; apiCalls: ApiCallResult[]; mergedResponse: Record<string, unknown>; llmInteractions: LlmInteraction[]; answer: string; durationMs: number; }
