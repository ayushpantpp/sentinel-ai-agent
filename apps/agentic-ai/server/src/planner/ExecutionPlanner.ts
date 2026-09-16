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
      && /\b(aircraft|fleet|owned|operated|planes)\b/i.test(question)
      && !/\b(order|production|manufactur|assembly|delivery)\w*\b/i.test(question);
    if (isCustomerFleetQuestion) {
      candidates.clear();
      candidates.add("fleet-by-customer");
    }
    if (/\b(order|production|manufactur|assembly|ready for delivery|delayed|not started)\w*\b/i.test(question)) {
      if (customer) candidates.delete("production-orders-all");
      candidates.add(customer ? "production-orders-by-customer" : "production-orders-all");
    }
    if (/\b(pilots?|crew)\b.{0,60}\b(training|qualification|type rating|due|overdue)\b|\b(training|qualification)\b.{0,60}\b(pilots?|crew)\b/i.test(question)) {
      if (customer) candidates.delete("pilot-training-due");
      candidates.add(customer ? "pilot-training-by-customer" : "pilot-training-due");
    }
    if (/\b(aircraft|owner|customer)\b.{0,60}\b(update|notification|notify|milestone|status change)\w*\b|\bnotify\b.{0,60}\b(owner|customer|airline)\b/i.test(question)) {
      candidates.delete("aircraft-updates-all");
      if (!/\bpilots?\b|\bcrew\b/i.test(question)) {
        candidates.delete("pilot-training-due");
        candidates.delete("pilot-training-by-customer");
      }
      if (!/\bfleet\b|\bowned\b|\boperated\b/i.test(question)) {
        candidates.delete("fleet-all");
        candidates.delete("fleet-by-customer");
      }
      candidates.add("aircraft-updates-pending");
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
