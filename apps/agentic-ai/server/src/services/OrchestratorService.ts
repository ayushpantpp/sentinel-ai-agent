import type { Logger } from "pino";
import type { ILLMProvider } from "../llm/ILLMProvider.js";
import type { ApiCallResult, ExecutionPlan, LlmInteraction, OrchestrationResult, PlanStep } from "../types/domain.js";
import { ApiRegistry } from "../registry/ApiRegistry.js";
import { IntentAnalyzer } from "./IntentAnalyzer.js";
import { ExecutionPlanner } from "../planner/ExecutionPlanner.js";
import { ApiExecutor } from "../executor/ApiExecutor.js";
import { ResponseMapper } from "../mapper/ResponseMapper.js";

const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null) : [];

export class OrchestratorService {
  private readonly analyzer = new IntentAnalyzer();
  private readonly planner: ExecutionPlanner;

  constructor(
    private readonly llm: ILLMProvider,
    private readonly registry: ApiRegistry,
    private readonly executor: ApiExecutor,
    private readonly mapper: ResponseMapper,
    private readonly logger: Logger
  ) { this.planner = new ExecutionPlanner(registry); }

  async run(question: string): Promise<OrchestrationResult> {
    const started = performance.now();
    const llmInteractions: LlmInteraction[] = [];
    const intentPrompt = this.analyzer.buildPrompt(question);
    const intentRaw = await this.callOllama("intent_analysis", intentPrompt, llmInteractions);
    const analysis = this.analyzer.parse(intentRaw);
    const plan = this.planner.create(analysis, question);
    const apiCalls = await this.executePlan(plan);
    const mergedResponse = this.mapper.merge(apiCalls);
    const finalPrompt = [
      "Write a concise, professional answer to the question using only this JSON data. Do not mention APIs or JSON.",
      "Question: " + question,
      "Plan: " + JSON.stringify(plan),
      "Data: " + JSON.stringify(mergedResponse)
    ].join("\n");
    const answer = await this.callOllama("final_answer", finalPrompt, llmInteractions);
    return { question, analysis, plan, apiCalls, mergedResponse, llmInteractions, answer, durationMs: Math.round(performance.now() - started) };
  }

  async lookupAircraftByTailNumbers(tailNumbers: string[]): Promise<OrchestrationResult> {
    const started = performance.now();
    const requested = [...new Set(tailNumbers.map((value) => value.trim().toUpperCase()).filter(Boolean))];
    const fleetDefinition = this.registry.find("fleet-all");
    const customerDefinition = this.registry.find("customer-search");
    if (!fleetDefinition || !customerDefinition) throw new Error("Fleet or customer API is not registered.");

    const fleetCall = await this.executor.execute(fleetDefinition, {});
    const customerCall = await this.executor.execute(customerDefinition, { q: "" });
    const fleet = records(fleetCall.data);
    const customers = records(customerCall.data);
    const customerNames = new Map(customers.map((customer) => [String(customer.id), String(customer.name)]));
    const matches: Record<string, unknown>[] = fleet
      .filter((aircraft) => requested.includes(String(aircraft.tailNumber).toUpperCase()))
      .map((aircraft) => ({
        ...aircraft,
        owner: customerNames.get(String(aircraft.customerId)) ?? String(aircraft.customerId)
      }));
    const missing = requested.filter((tailNumber) =>
      !matches.some((aircraft) => String(aircraft["tailNumber"]).toUpperCase() === tailNumber)
    );
    const answer = [
      ...matches.map((aircraft) => `${String(aircraft["tailNumber"])} — ${String(aircraft["model"])}, owned by ${String(aircraft["owner"])}`),
      ...(missing.length ? [`No authoritative record found for: ${missing.join(", ")}`] : [])
    ].join("; ");
    const question = `Resolve owner and model for aircraft tail numbers: ${requested.join(", ")}.`;
    return {
      question,
      analysis: { intent: "aircraft-tail-lookup", entities: { tailNumbers: requested.join(",") }, candidateApis: ["fleet-all", "customer-search"] },
      plan: {
        intent: "aircraft-tail-lookup",
        steps: [
          { apiId: "fleet-all", input: {}, dependsOn: [] },
          { apiId: "customer-search", input: { q: "" }, dependsOn: [] }
        ],
        rationale: "Resolve supplied tail numbers against authoritative fleet records, then map customer IDs to owners."
      },
      apiCalls: [fleetCall, customerCall],
      mergedResponse: { "aircraft-by-tail": matches, customers, missingTailNumbers: missing },
      llmInteractions: [],
      answer,
      durationMs: Math.round(performance.now() - started)
    };
  }

  private async callOllama(stage: LlmInteraction["stage"], prompt: string, interactions: LlmInteraction[]): Promise<string> {
    const started = performance.now();
    try {
      const response = await this.llm.generate(prompt);
      const interaction: LlmInteraction = { stage, prompt, response, durationMs: Math.round(performance.now() - started) };
      interactions.push(interaction);
      this.logger.info({ ollama: interaction }, "Ollama call completed");
      return response;
    } catch (error: unknown) {
      this.logger.error({ err: error, ollama: { stage, prompt, durationMs: Math.round(performance.now() - started) } }, "Ollama call failed");
      throw error;
    }
  }

  private async executePlan(plan: ExecutionPlan): Promise<ApiCallResult[]> {
    const results: ApiCallResult[] = [];
    for (const step of plan.steps) {
      const definition = this.registry.find(step.apiId);
      if (!definition) continue;
      const inputs = this.resolveInputs(step, results);
      for (const input of inputs) results.push(await this.executor.execute(definition, input));
    }
    return results;
  }

  private resolveInputs(step: PlanStep, results: ApiCallResult[]): Record<string, string>[] {
    if (Object.keys(step.input).length > 0 || step.apiId === "fleet-all") return [step.input];
    const find = (id: string) => results.filter((result) => result.apiId === id);
    if (["fleet-by-customer", "deliveries-by-customer", "production-orders-by-customer", "pilot-training-by-customer"].includes(step.apiId)) return find("customer-search").flatMap((result) => records(result.data).map((item) => ({ customerId: String(item.id) })));
    if (step.apiId === "maintenance-by-aircraft") return find("fleet-all").flatMap((result) => records(result.data).map((item) => ({ aircraftId: String(item.id) })));
    return [step.input];
  }
}
