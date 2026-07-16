import { tools as registeredTools } from "../tools/operations.js";
import type { Tool } from "../tools/contracts.js";
import type { ExecutionPlan, ExecutionTask, PlannedTask } from "./types.js";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const chatModel = process.env.OLLAMA_MODEL ?? "phi4-mini:latest";
export const planningTools = registeredTools.filter((tool) => tool.definition.name !== "remember");

interface OllamaChatResponse {
  message: { content: string };
}

function parseObject(content: string): Record<string, unknown> {
  const value = JSON.parse(content.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Planner response must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Plan field '${field}' must be text.`);
  return value.trim();
}

/** Converts untrusted model output into one approved, bounded task definition. */
function validateTask(value: unknown, index: number, tools: Tool[]): PlannedTask {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Task ${index + 1} must be an object.`);
  }
  const task = value as Record<string, unknown>;
  const toolName = text(task.toolName, "toolName");
  if (!tools.some((tool) => tool.definition.name === toolName)) {
    throw new Error(`Task ${index + 1} requested unapproved tool '${toolName}'.`);
  }
  if (typeof task.input !== "object" || task.input === null || Array.isArray(task.input)) {
    throw new Error(`Task ${index + 1} input must be an object.`);
  }
  return {
    id: text(task.id, "id"),
    title: text(task.title, "title"),
    toolName,
    input: task.input as Record<string, unknown>,
    successCriteria: text(task.successCriteria, "successCriteria"),
    required: !toolName.startsWith("createMock") && task.required !== false,
    maxAttempts: Math.min(3, Math.max(2, Number(task.maxAttempts) || 2))
  };
}

/** Enforces evidence requirements that the probabilistic planner may omit. */
function addRequiredCoverage(goal: string, tasks: PlannedTask[]): PlannedTask[] {
  const result = [...tasks];
  const hasTool = (name: string) => result.some((task) => task.toolName === name);
  if (/\blogs?\b/i.test(goal)) {
    for (const task of result.filter((candidate) => candidate.toolName === "searchLogs")) task.required = true;
  }
  if (/\b(documented|runbook|procedure|next action)\b/i.test(goal)) {
    for (const task of result.filter((candidate) => ["searchRunbook", "searchKnowledge"].includes(candidate.toolName))) {
      task.required = true;
    }
  }
  if (/\blogs?\b/i.test(goal) && !hasTool("searchLogs")) {
    result.unshift({
      id: "required-logs",
      title: "Retrieve required local log evidence",
      toolName: "searchLogs",
      input: { query: goal },
      successCriteria: "Relevant local log lines are returned.",
      required: true,
      maxAttempts: 2
    });
  }
  if (/\b(documented|runbook|procedure|next action)\b/i.test(goal)
    && !hasTool("searchRunbook")
    && !hasTool("searchKnowledge")) {
    result.push({
      id: "required-runbook",
      title: "Retrieve required documented guidance",
      toolName: "searchRunbook",
      input: { query: goal },
      successCriteria: "At least one applicable runbook is returned.",
      required: true,
      maxAttempts: 2
    });
  }
  return result.slice(0, 5);
}

/** Uses the LLM for decomposition, then validates and augments its proposed plan. */
export async function createPlan(goal: string): Promise<ExecutionPlan> {
  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      stream: false,
      options: { temperature: 0 },
      format: {
        type: "object",
        properties: {
          goal: { type: "string" },
          tasks: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                id: { type: "string" }, title: { type: "string" }, toolName: { type: "string" },
                input: { type: "object" }, successCriteria: { type: "string" },
                required: { type: "boolean" }, maxAttempts: { type: "integer" }
              },
              required: ["id", "title", "toolName", "input", "successCriteria", "required", "maxAttempts"]
            }
          }
        },
        required: ["goal", "tasks"]
      },
      messages: [{
        role: "system",
        content: `You are Sentinel AI's planner. Break the goal into only the directly necessary ordered tool tasks, maximum 5. Use only supplied tools. Do not include a final-answer task. Every task executes sequentially, so do not create conditional "if" tasks. Do not call the same search tool twice unless the queries seek clearly different evidence. Never invent factual inputs for calculation tools; use them only when required inputs are explicitly present in the goal. Do not create tickets or notifications unless the goal requests them. Do not search memory unless historical memory is requested. Mock notification or ticket tasks must be optional. Use short stable IDs such as task-1. Tools:\n${JSON.stringify(planningTools.map((tool) => tool.definition), null, 2)}`
      }, { role: "user", content: goal }]
    })
  });
  if (!response.ok) throw new Error(`Planner request failed: ${response.status} ${await response.text()}`);
  const value = parseObject((await response.json() as OllamaChatResponse).message.content);
  if (!Array.isArray(value.tasks)) throw new Error("Planner field 'tasks' must be an array.");
  const planned = value.tasks.map((task, index) => validateTask(task, index, planningTools));
  const ids = new Set(planned.map((task) => task.id));
  if (ids.size !== planned.length) throw new Error("Plan task IDs must be unique.");
  const tasks: ExecutionTask[] = addRequiredCoverage(goal, planned).map((task) => ({
    ...task,
    status: "pending",
    attempts: 0
  }));
  return { goal, tasks };
}

/** Produces a final response from execution state without rerunning any task. */
export async function synthesizePlan(plan: ExecutionPlan): Promise<string> {
  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      stream: false,
      options: { temperature: 0 },
      format: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"]
      },
      messages: [{
        role: "system",
        content: "Answer the goal using only completed task results. State failed required tasks and uncertainty. Distinguish observed evidence from recommended actions. Never claim that an action, approval, or mitigation occurred merely because a runbook recommends it. Do not invent missing evidence."
      }, { role: "user", content: JSON.stringify(plan) }]
    })
  });
  if (!response.ok) throw new Error(`Synthesis request failed: ${response.status} ${await response.text()}`);
  return text(parseObject((await response.json() as OllamaChatResponse).message.content).answer, "answer");
}
