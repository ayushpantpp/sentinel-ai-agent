import { tools as registeredTools } from "../tools/operations.js";
import type { Tool } from "../tools/contracts.js";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const chatModel = process.env.OLLAMA_MODEL ?? "phi4-mini:latest";
const maximumIterations = 5;
const autonomousTools = registeredTools.filter((tool) => tool.definition.name !== "remember");

interface OllamaChatResponse {
  message: { content: string };
}

interface ToolDecision {
  type: "tool";
  rationale: string;
  toolName: string;
  input: Record<string, unknown>;
}

interface AnswerDecision {
  type: "answer";
  rationale: string;
  answer: string;
}

type AgentDecision = ToolDecision | AnswerDecision;

interface Reflection {
  sufficient: boolean;
  summary: string;
  nextStep: string;
}

interface AgentStep {
  decision: ToolDecision;
  observation: unknown;
  reflection: Reflection;
}

export interface AgentEvent {
  stage: "thought" | "action" | "observation" | "reflection" | "answer";
  content: unknown;
}

function parseJsonObject(content: string): Record<string, unknown> {
  const normalized = content.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(normalized) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Model response must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Model field '${field}' must be a non-empty string.`);
  }
  return value.trim();
}

async function modelJson(
  system: string,
  user: string,
  format: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      stream: false,
      format,
      options: { temperature: 0 },
      messages: [{ role: "system", content: system }, { role: "user", content: user }]
    })
  });
  if (!response.ok) {
    throw new Error(`Agent model request failed: ${response.status} ${await response.text()}`);
  }
  return parseJsonObject((await response.json() as OllamaChatResponse).message.content);
}

function toolCatalog(tools: Tool[]): string {
  return JSON.stringify(tools.map((tool) => tool.definition), null, 2);
}

function transcript(steps: AgentStep[]): string {
  return JSON.stringify(steps.map((step) => ({
    action: { toolName: step.decision.toolName, input: step.decision.input },
    observation: step.observation,
    reflection: step.reflection
  })), null, 2).slice(-12000);
}

function requiredEvidenceDecision(question: string, steps: AgentStep[]): ToolDecision | undefined {
  const usedTools = new Set(steps.map((step) => step.decision.toolName));
  if (/\blogs?\b/i.test(question) && !usedTools.has("searchLogs")) {
    return {
      type: "tool",
      rationale: "The goal explicitly requires local log evidence, which has not been retrieved yet.",
      toolName: "searchLogs",
      input: { query: question }
    };
  }
  if (/\b(documented|runbook|procedure|next action)\b/i.test(question)
    && !usedTools.has("searchRunbook")
    && !usedTools.has("searchKnowledge")) {
    return {
      type: "tool",
      rationale: "The goal requests documented guidance, so a runbook must be retrieved before answering.",
      toolName: "searchRunbook",
      input: { query: question }
    };
  }
  return undefined;
}

async function decide(question: string, steps: AgentStep[]): Promise<AgentDecision> {
  const value = await modelJson(
    `You are the decision component of Sentinel AI's manual ReAct loop.
Return one JSON object only.
To use a tool: {"type":"tool","rationale":"brief decision summary","toolName":"exact name","input":{...}}.
To finish: {"type":"answer","rationale":"brief evidence summary","answer":"grounded response with evidence"}.
Use tools when facts are required. Never invent tool results. Do not repeat a tool call that already produced the needed evidence.
Available tools:\n${toolCatalog(autonomousTools)}`,
    `User goal: ${question}\n\nPrevious steps:\n${transcript(steps) || "None"}`,
    {
      type: "object",
      properties: {
        type: { type: "string", enum: ["tool", "answer"] },
        rationale: { type: "string" },
        toolName: { type: "string" },
        input: { type: "object" },
        answer: { type: "string" }
      },
      required: ["type", "rationale", "toolName", "input", "answer"]
    }
  );

  const type = requiredText(value.type ?? value.action, "type");
  const rationale = typeof value.rationale === "string" && value.rationale.trim()
    ? value.rationale.trim()
    : `Selected ${type} based on the current goal and observations.`;
  if (type === "answer" || type === "final") {
    return {
      type: "answer",
      rationale,
      answer: requiredText(value.answer ?? value.response ?? value.content ?? value.finalAnswer ?? value.rationale, "answer")
    };
  }
  const directTool = autonomousTools.find((tool) => tool.definition.name === type);
  const toolName = directTool ? type : requiredText(value.toolName, "toolName");
  if (type !== "tool" && !directTool) throw new Error(`Unknown decision type '${type}'.`);
  const rawInput = value.input ?? value.arguments;
  if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
    throw new Error("Tool decision input must be an object.");
  }
  return {
    type: "tool",
    rationale,
    toolName,
    input: rawInput as Record<string, unknown>
  };
}

async function reflect(
  question: string,
  decision: ToolDecision,
  observation: unknown,
  previousSteps: AgentStep[]
): Promise<Reflection> {
  const value = await modelJson(
    `You are the reflection component of Sentinel AI. Evaluate whether all parts of the user goal can now be answered. If the goal requests a documented action and only logs were retrieved, sufficient must be false. Return JSON only. Do not add facts absent from the observation.`,
    JSON.stringify({ question, previousSteps, action: decision, observation }),
    {
      type: "object",
      properties: {
        sufficient: { type: "boolean" },
        summary: { type: "string" },
        nextStep: { type: "string" }
      },
      required: ["sufficient", "summary", "nextStep"]
    }
  );
  if (typeof value.sufficient !== "boolean") throw new Error("Reflection field 'sufficient' must be boolean.");
  const nextStep = requiredText(value.nextStep, "nextStep");
  const canAnswerNow = /^(answer|respond|finish|provide)/i.test(nextStep);
  return {
    sufficient: value.sufficient && canAnswerNow,
    summary: requiredText(value.summary, "summary"),
    nextStep
  };
}

async function execute(toolName: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = autonomousTools.find((candidate) => candidate.definition.name === toolName);
  if (!tool) return { success: false, error: `Tool '${toolName}' is unavailable or not approved for autonomous use.` };
  try {
    return { success: true, data: await tool.execute(input) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown tool error" };
  }
}

export async function runReactAgent(
  question: string,
  onEvent: (event: AgentEvent) => void
): Promise<string> {
  const steps: AgentStep[] = [];

  for (let iteration = 1; iteration <= maximumIterations; iteration += 1) {
    const decision = requiredEvidenceDecision(question, steps) ?? await decide(question, steps);
    onEvent({ stage: "thought", content: decision.rationale });

    if (decision.type === "answer") {
      onEvent({ stage: "answer", content: decision.answer });
      return decision.answer;
    }

    onEvent({ stage: "action", content: { iteration, tool: decision.toolName, input: decision.input } });
    const observation = await execute(decision.toolName, decision.input);
    onEvent({ stage: "observation", content: observation });
    const reflection = await reflect(question, decision, observation, steps);
    onEvent({ stage: "reflection", content: reflection });
    steps.push({ decision, observation, reflection });
  }

  const fallback = `Stopped after ${maximumIterations} iterations without enough evidence. Review the observations or refine the question.`;
  onEvent({ stage: "answer", content: fallback });
  return fallback;
}
