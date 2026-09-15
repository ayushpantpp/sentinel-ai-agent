import { describe, expect, it } from "vitest";
import { IntentAnalyzer } from "./IntentAnalyzer.js";

describe("IntentAnalyzer", () => {
  it("validates a structured Ollama response", () => {
    const analyzer = new IntentAnalyzer();
    expect(analyzer.parse(JSON.stringify({
      intent: "fleet_lookup",
      entities: { customer: "Lufthansa" },
      candidateApis: ["customer-search", "fleet-by-customer"]
    }))).toEqual({
      intent: "fleet_lookup",
      entities: { customer: "Lufthansa" },
      candidateApis: ["customer-search", "fleet-by-customer"]
    });
  });
});
