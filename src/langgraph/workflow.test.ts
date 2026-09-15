import assert from "node:assert/strict";
import test from "node:test";
import { runAirbusIntelligenceHubGraph } from "./workflow.js";
import {
  reflect,
  requiredEvidenceDecision,
  requiresCombinedKnowledgeAndApi,
  type AgentEvent,
  type AgentStep,
  type ToolDecision
} from "../agent/react-agent.js";

test("uses approved knowledge before generating a documented-procedure answer", async () => {
  const events: AgentEvent[] = [];

  const answer = await runAirbusIntelligenceHubGraph(
    "What is the documented procedure when an aircraft delivery forecast moves by more than seven days?",
    {
      onEvent: (event) => events.push(event),
      authorizeTool: async () => ({ allowed: true, reason: "Test read permission." })
    }
  );

  const toolCalls = events
    .filter((event) => event.stage === "action")
    .map((event) => (event.content as { tool: string }).tool);
  const runbookObservation = events.find((event) => event.stage === "observation");
  const finalAnswer = events.find((event) => event.stage === "answer");

  assert.deepEqual(toolCalls, ["searchRunbook"]);
  assert.doesNotMatch(toolCalls.join(" "), /orchestrateAirbusApis/);
  assert.match(JSON.stringify(runbookObservation?.content), /aircraft-delivery-escalation\.md/);
  assert.match(answer, /delivery-risk review within one business day/i);
  assert.match(answer, /programme manager approves/i);
  assert.equal(finalAnswer?.content, answer);
});

test("requires and combines Airbus API data with knowledge for a combined request", async () => {
  const question = "Find delayed aircraft using Airbus APIs, then use the documented procedure to explain the required action.";
  assert.equal(requiresCombinedKnowledgeAndApi(question), true);

  const knowledgeDecision = requiredEvidenceDecision(question, []);
  assert.equal(knowledgeDecision?.toolName, "searchRunbook");
  const knowledgeStep: AgentStep = {
    decision: knowledgeDecision as ToolDecision,
    observation: { success: true, data: [{ source: "aircraft-delivery-escalation.md" }] },
    reflection: {
      sufficient: true,
      summary: "The programme manager must open a delivery-risk review within one business day.",
      nextStep: "Answer from approved guidance."
    }
  };

  const apiDecision = requiredEvidenceDecision(question, [knowledgeStep]);
  assert.equal(apiDecision?.toolName, "orchestrateAirbusApis");
  assert.equal(apiDecision?.input.question, "Find delayed aircraft");
  const combined = await reflect(
    question,
    apiDecision as ToolDecision,
    { success: true, data: { answer: "MSN 1042 for KLM is delayed by 12 days." } },
    [knowledgeStep]
  );

  assert.match(combined.summary, /MSN 1042 for KLM is delayed by 12 days/);
  assert.match(combined.summary, /delivery-risk review within one business day/);
});
