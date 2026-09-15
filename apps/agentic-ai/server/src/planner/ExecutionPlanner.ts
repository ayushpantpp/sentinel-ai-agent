import type { ApiRegistry } from "../registry/ApiRegistry.js";
import type { ExecutionPlan, IntentAnalysis, PlanStep } from "../types/domain.js";
export class ExecutionPlanner {
  constructor(private readonly registry: ApiRegistry) {}
  create(analysis: IntentAnalysis, question: string): ExecutionPlan {
    const customer = analysis.entities.customer ?? analysis.entities.company;
    const canUse = (id: string): boolean =>
      id !== "aircraft-detail" || Boolean(analysis.entities.id);
    const candidates = new Set(
      analysis.candidateApis.filter((id) => this.registry.find(id) && canUse(id))
    );
    const terms = question.toLowerCase().match(/[a-z]+/g) ?? [];
    const isCustomerFleetQuestion = Boolean(customer)
      && /\b(aircraft|fleet|owned|operated|planes)\b/i.test(question);
    if (isCustomerFleetQuestion) {
      candidates.clear();
      candidates.add("fleet-by-customer");
    }
    // The registry is the planner's discovery mechanism, but an LLM-selected
    // capability set is more precise than a broad keyword match.
    if (candidates.size === 0) {
      for (const item of this.registry.search(terms)) {
        if (canUse(item.id)) candidates.add(item.id);
      }
    }
    for (const id of [...candidates]) for (const dependency of this.registry.find(id)?.dependencies ?? []) candidates.add(dependency);
    const ordered = [...candidates].sort((a, b) => (this.registry.find(a)?.dependencies.length ?? 0) - (this.registry.find(b)?.dependencies.length ?? 0));
    const steps: PlanStep[] = ordered.map((apiId) => {
      const input: Record<string, string> = apiId === "customer-search" && customer
        ? { q: customer }
        : apiId === "aircraft-detail" && analysis.entities.id
          ? { id: analysis.entities.id }
          : {};
      return { apiId, input, dependsOn: this.registry.find(apiId)?.dependencies ?? [] };
    });
    return { intent: analysis.intent, steps, rationale: `Selected from registry for ${analysis.intent}; dependencies are executed first.` };
  }
}
