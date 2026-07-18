import { tools as registeredTools } from "../tools/operations.js";
import type { Tool } from "../tools/contracts.js";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const chatModel = process.env.OLLAMA_MODEL ?? "phi4-mini:latest";
const maximumIterations = 5;
const autonomousTools = registeredTools.filter((tool) => tool.definition.name !== "remember");

interface OllamaChatResponse {
  message: { content: string };
}

export interface ToolDecision {
  type: "tool";
  rationale: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface AnswerDecision {
  type: "answer";
  rationale: string;
  answer: string;
}

export type AgentDecision = ToolDecision | AnswerDecision;

export interface Reflection {
  sufficient: boolean;
  summary: string;
  nextStep: string;
}

export interface AgentStep {
  decision: ToolDecision;
  observation: unknown;
  reflection: Reflection;
}

export interface AgentEvent {
  stage: "prompt" | "llm-call" | "llm-response" | "thought" | "action" | "guardrail" | "observation" | "reflection" | "answer";
  content: unknown;
  metadata?: {
    iteration?: number;
    durationMs?: number;
    source?: "controller" | "model" | "policy" | "tool";
  };
}

export interface ToolAuthorizationRequest {
  iteration: number;
  toolName: string;
  input: Record<string, unknown>;
  rationale: string;
}

export interface ToolAuthorization {
  allowed: boolean;
  reason: string;
}

export interface AgentOptions {
  maximumIterations?: number;
  authorizeTool?: (request: ToolAuthorizationRequest) => Promise<ToolAuthorization>;
}

export interface LlmPrompt {
  model: string;
  temperature: number;
  system: string;
  user: string;
}

export interface LlmResponse {
  model: string;
  raw: string;
  parsed: Record<string, unknown>;
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

function firstNonEmptyText(values: unknown[], field: string): string {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim());
  return requiredText(value, field);
}

async function modelJson(
  system: string,
  user: string,
  format: Record<string, unknown>,
  onPrompt?: (prompt: LlmPrompt) => void,
  onResponse?: (response: LlmResponse) => void
): Promise<Record<string, unknown>> {
  onPrompt?.({ model: chatModel, temperature: 0, system, user });
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
  const raw = (await response.json() as OllamaChatResponse).message.content;
  const parsed = parseJsonObject(raw);
  onResponse?.({ model: chatModel, raw, parsed });
  return parsed;
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

export function requiredEvidenceDecision(question: string, steps: AgentStep[]): ToolDecision | undefined {
  const usedTools = new Set(steps.map((step) => step.decision.toolName));
  const jiraDenied = /\b(do not|don't|never)\b.{0,40}\b(create|open|file)\b.{0,40}\bjira\b/i.test(question);
  const slackDenied = /\b(do not|don't|never)\b.{0,40}\b(send|create|post)\b.{0,40}\bslack\b/i.test(question);
  if (!jiraDenied
    && /\b(create|open|file)\b.{0,40}\bjira\b/i.test(question)
    && !usedTools.has("createMockJira")) {
    return {
      type: "tool",
      rationale: "An explicit Jira creation request must pass through the approved Jira tool and human confirmation.",
      toolName: "createMockJira",
      input: {
        summary: question.slice(0, 120),
        description: question
      }
    };
  }
  if (!slackDenied
    && /\b(send|create|post)\b.{0,40}\bslack\b/i.test(question)
    && !usedTools.has("createMockSlackNotification")) {
    const channel = question.match(/#[a-z0-9_-]+/i)?.[0] ?? "#operations";
    return {
      type: "tool",
      rationale: "An explicit Slack notification request must pass through the approved Slack tool and human confirmation.",
      toolName: "createMockSlackNotification",
      input: {
        channel,
        message: question
      }
    };
  }
  if (/\b(calculate|determine|classify)\b.{0,40}\bseverity\b|\bseverity\b.{0,40}\b(calculate|determine|classify)\b/i.test(question)
    && !usedTools.has("calculateSeverity")) {
    const errorRateMatch = question.match(/(\d+(?:\.\d+)?)\s*(?:percent|%)/i);
    return {
      type: "tool",
      rationale: "Incident severity must come from the deterministic severity policy, not model judgment.",
      toolName: "calculateSeverity",
      input: {
        securityIncident: /\bsecurity incident\b/i.test(question),
        dataLoss: /\bdata loss\b/i.test(question),
        customerImpact: /\bcustomer impact\b/i.test(question),
        serviceUnavailable: /\b(service unavailable|outage)\b/i.test(question),
        errorRatePercent: errorRateMatch ? Number(errorRateMatch[1]) : 0
      }
    };
  }
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

export async function decide(
  question: string,
  steps: AgentStep[],
  onPrompt?: (prompt: LlmPrompt) => void,
  onResponse?: (response: LlmResponse) => void
): Promise<AgentDecision> {
  const value = await modelJson(
    `You are the decision component of Sentinel AI's manual ReAct loop.
Return one JSON object only.
To use a tool: {"type":"tool","rationale":"brief decision summary","toolName":"exact name","input":{...}}.
To finish: {"type":"answer","rationale":"brief evidence summary","answer":"grounded response with evidence"}.
Use tools when facts are required. Never invent tool results. Do not repeat a tool call that already produced the needed evidence.
When the latest reflection says evidence is sufficient, answer directly from its summary. Preserve numeric values and units exactly; do not introduce requirements the user did not ask about.
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
    },
    onPrompt,
    onResponse
  );

  const type = requiredText(value.type ?? value.action, "type");
  const rationale = typeof value.rationale === "string" && value.rationale.trim()
    ? value.rationale.trim()
    : `Selected ${type} based on the current goal and observations.`;
  if (type === "answer" || type === "final") {
    return {
      type: "answer",
      rationale,
      answer: firstNonEmptyText(
        [value.answer, value.response, value.content, value.finalAnswer, value.rationale],
        "answer"
      )
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

export async function reflect(
  question: string,
  decision: ToolDecision,
  observation: unknown,
  previousSteps: AgentStep[],
  onPrompt?: (prompt: LlmPrompt) => void,
  onResponse?: (response: LlmResponse) => void
): Promise<Reflection> {
  const deterministic = reflectOnExplicitLogThreshold(question, observation);
  if (deterministic) return deterministic;
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
    },
    onPrompt,
    onResponse
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

/**
 * Handles narrow numeric log questions deterministically so the model cannot
 * ignore an exact observation, add an unrequested consistency requirement, or
 * perform incorrect unit conversion.
 */
function reflectOnExplicitLogThreshold(question: string, observation: unknown): Reflection | undefined {
  const thresholdMatch = question.match(/\bp95\b.{0,50}\bexceed(?:ed)?\s+(\d+(?:\.\d+)?)\s*(seconds?|s)\b/i);
  if (!thresholdMatch) return undefined;
  if (typeof observation !== "object" || observation === null) return undefined;
  const result = observation as { success?: boolean; data?: unknown };
  if (!result.success || !Array.isArray(result.data)) return undefined;
  const threshold = Number(thresholdMatch[1]);
  const matchingLine = result.data
    .filter((entry): entry is string => typeof entry === "string")
    .find((line) => {
      const value = line.match(/\bp95 latency exceeded\s+(\d+(?:\.\d+)?)\s*seconds?\b/i);
      return value ? Number(value[1]) >= threshold : false;
    });
  if (!matchingLine) return undefined;
  return {
    sufficient: true,
    summary: `The local log explicitly states that payment API p95 latency exceeded ${threshold} seconds: ${matchingLine}`,
    nextStep: "Answer yes and cite the exact log entry without adding a consistency requirement."
  };
}

export async function execute(toolName: string, input: Record<string, unknown>): Promise<unknown> {
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
  onEvent: (event: AgentEvent) => void,
  options: AgentOptions = {}
): Promise<string> {
  const steps: AgentStep[] = [];
  const iterationLimit = Math.min(maximumIterations, Math.max(1, options.maximumIterations ?? maximumIterations));
  const runStartedAt = performance.now();
  onEvent({ stage: "prompt", content: question, metadata: { source: "controller" } });

  for (let iteration = 1; iteration <= iterationLimit; iteration += 1) {
    const requiredDecision = requiredEvidenceDecision(question, steps);
    const decisionStartedAt = performance.now();
    const decision = requiredDecision ?? await decide(question, steps);
    onEvent({
      stage: "thought",
      content: decision.rationale,
      metadata: {
        iteration,
        durationMs: performance.now() - decisionStartedAt,
        source: requiredDecision ? "controller" : "model"
      }
    });

    if (decision.type === "answer") {
      onEvent({
        stage: "answer",
        content: decision.answer,
        metadata: { iteration, durationMs: performance.now() - runStartedAt, source: "controller" }
      });
      return decision.answer;
    }

    onEvent({
      stage: "action",
      content: { iteration, tool: decision.toolName, input: decision.input },
      metadata: { iteration, source: "controller" }
    });
    const authorizationStartedAt = performance.now();
    const authorization = options.authorizeTool
      ? await options.authorizeTool({
        iteration,
        toolName: decision.toolName,
        input: decision.input,
        rationale: decision.rationale
      })
      : { allowed: true, reason: "No additional authorization policy configured." };
    onEvent({
      stage: "guardrail",
      content: authorization,
      metadata: {
        iteration,
        durationMs: performance.now() - authorizationStartedAt,
        source: "policy"
      }
    });
    const toolStartedAt = performance.now();
    const observation = authorization.allowed
      ? await execute(decision.toolName, decision.input)
      : { success: false, error: `Guardrail denied tool execution: ${authorization.reason}` };
    onEvent({
      stage: "observation",
      content: observation,
      metadata: {
        iteration,
        durationMs: performance.now() - toolStartedAt,
        source: "tool"
      }
    });
    const reflectionStartedAt = performance.now();
    const reflection = await reflect(question, decision, observation, steps);
    onEvent({
      stage: "reflection",
      content: reflection,
      metadata: {
        iteration,
        durationMs: performance.now() - reflectionStartedAt,
        source: "model"
      }
    });
    steps.push({ decision, observation, reflection });
  }

  const fallback = `Stopped after ${iterationLimit} iterations without enough evidence. Review the observations or refine the question.`;
  onEvent({
    stage: "answer",
    content: fallback,
    metadata: { durationMs: performance.now() - runStartedAt, source: "controller" }
  });
  return fallback;
}
