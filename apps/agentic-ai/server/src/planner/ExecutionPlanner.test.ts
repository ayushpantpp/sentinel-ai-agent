import { describe, expect, it } from "vitest";
import { ApiRegistry } from "../registry/ApiRegistry.js";
import { ExecutionPlanner } from "./ExecutionPlanner.js";

describe("ExecutionPlanner", () => {
  it("uses the customer-specific fleet even when the model selects fleet-all", () => {
    const planner = new ExecutionPlanner(new ApiRegistry());
    const plan = planner.create({
      intent: "fleet-info",
      entities: { company: "Lufthansa" },
      candidateApis: ["fleet-all"]
    }, "Show all aircraft owned by Lufthansa.");

    expect(plan.steps).toEqual([
      { apiId: "customer-search", input: { q: "Lufthansa" }, dependsOn: [] },
      {
        apiId: "fleet-by-customer",
        input: {},
        dependsOn: ["customer-search"]
      }
    ]);
  });

  it("does not call aircraft-detail without an aircraft id during registry fallback", () => {
    const planner = new ExecutionPlanner(new ApiRegistry());
    const plan = planner.create({
      intent: "aircraft-operation",
      entities: { company: "Luftasa" },
      candidateApis: ["fleet-by-company"]
    }, "Tell me aircraft operated by Luftasa");

    expect(plan.steps).toEqual([
      { apiId: "customer-search", input: { q: "Luftasa" }, dependsOn: [] },
      {
        apiId: "fleet-by-customer",
        input: {},
        dependsOn: ["customer-search"]
      }
    ]);
  });
});
