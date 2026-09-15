/**
 * Purpose: Express Airbus Intelligence Hub's manual ReAct loop as a LangGraph StateGraph.
 * Architecture: Domain functions remain in the agent module; LangGraph owns
 * state transitions, named nodes, conditional routing, and loop termination.
 * AI concept: Graph orchestration makes stateful agent control flow explicit
 * without replacing prompts, tools, policies, or model infrastructure.
 * Possible improvements: persistent checkpointer, node retries, interrupts,
 * streaming state updates, subgraphs, and graph-level tests.
 */
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  decide,
  execute,
  reflect,
  requiresCombinedKnowledgeAndApi,
  requiredEvidenceDecision,
  type AgentDecision,
  type AgentEvent,
  type AgentOptions,
  type AgentStep,
  type Reflection,
  type ToolDecision
} from "../agent/react-agent.js";

const defaultMaximumIterations = 5;

const GraphState = Annotation.Root({
  goal: Annotation<string>,
  iteration: Annotation<number>,
  steps: Annotation<AgentStep[]>,
  decision: Annotation<AgentDecision | null>,
  observation: Annotation<unknown>,
  reflection: Annotation<Reflection | null>,
  answer: Annotation<string>
});

type AirbusIntelligenceHubGraphState = typeof GraphState.State;

function parsedMcpModelResponse(value: unknown): Record<string, unknown> {
  const raw = String(value ?? "").trim();
  const normalized = raw.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(normalized) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { value: parsed };
  } catch {
    return { answer: raw };
  }
}

export interface GraphWorkflowOptions extends AgentOptions {
  onEvent: (event: AgentEvent) => void;
}

/**
 * Builds a compiled graph. Closures inject guardrails and event recording while
 * graph state remains serializable workflow data.
 */
export function createAirbusIntelligenceHubGraph(options: GraphWorkflowOptions) {
  const iterationLimit = Math.min(
    defaultMaximumIterations,
    Math.max(1, options.maximumIterations ?? defaultMaximumIterations)
  );
  const runStartedAt = performance.now();

  const decideNode = async (state: AirbusIntelligenceHubGraphState) => {
    const iteration = state.iteration + 1;
    const requiredDecision = requiredEvidenceDecision(state.goal, state.steps);
    const startedAt = performance.now();
    const decision = requiredDecision ?? await decide(
      state.goal,
      state.steps,
      (prompt) => options.onEvent({
        stage: "llm-call",
        content: prompt,
        metadata: { iteration, source: "model" }
      }),
      (response) => options.onEvent({
        stage: "llm-response",
        content: response,
        metadata: { iteration, source: "model" }
      })
    );
    options.onEvent({
      stage: "thought",
      content: decision.rationale,
      metadata: {
        iteration,
        durationMs: performance.now() - startedAt,
        source: requiredDecision ? "controller" : "model"
      }
    });
    return { iteration, decision };
  };

  const executeNode = async (state: AirbusIntelligenceHubGraphState) => {
    const decision = state.decision as ToolDecision;
    options.onEvent({
      stage: "action",
      content: { iteration: state.iteration, tool: decision.toolName, input: decision.input },
      metadata: { iteration: state.iteration, source: "controller" }
    });
    const authorizationStartedAt = performance.now();
    const authorization = options.authorizeTool
      ? await options.authorizeTool({
        iteration: state.iteration,
        toolName: decision.toolName,
        input: decision.input,
        rationale: decision.rationale
      })
      : { allowed: true, reason: "No additional authorization policy configured." };
    options.onEvent({
      stage: "guardrail",
      content: authorization,
      metadata: {
        iteration: state.iteration,
        durationMs: performance.now() - authorizationStartedAt,
        source: "policy"
      }
    });
    const toolStartedAt = performance.now();
    const observation = authorization.allowed
      ? await execute(decision.toolName, decision.input)
      : { success: false, error: `Guardrail denied tool execution: ${authorization.reason}` };
    if (decision.toolName === "orchestrateAirbusApis"
      && typeof observation === "object"
      && observation !== null) {
      const data = (observation as { data?: unknown }).data;
      const interactions = typeof data === "object" && data !== null
        ? (data as { llmInteractions?: unknown }).llmInteractions
        : undefined;
      if (Array.isArray(interactions)) {
        for (const interaction of interactions) {
          if (typeof interaction !== "object" || interaction === null) continue;
          const item = interaction as Record<string, unknown>;
          options.onEvent({
            stage: "llm-call",
            content: {
              model: "Ollama via Airbus APIs MCP",
              temperature: 0,
              system: `Airbus APIs MCP · ${String(item.stage ?? "model call")}`,
              user: String(item.prompt ?? "")
            },
            metadata: { iteration: state.iteration, source: "model" }
          });
          options.onEvent({
            stage: "llm-response",
            content: {
              model: "Ollama via Airbus APIs MCP",
              raw: String(item.response ?? ""),
              parsed: parsedMcpModelResponse(item.response)
            },
            metadata: { iteration: state.iteration, source: "model" }
          });
        }
      }
    }
    options.onEvent({
      stage: "observation",
      content: observation,
      metadata: {
        iteration: state.iteration,
        durationMs: performance.now() - toolStartedAt,
        source: "tool"
      }
    });
    return { observation };
  };

  const reflectNode = async (state: AirbusIntelligenceHubGraphState) => {
    const decision = state.decision as ToolDecision;
    const startedAt = performance.now();
    const reflection = await reflect(
      state.goal,
      decision,
      state.observation,
      state.steps,
      (prompt) => options.onEvent({
        stage: "llm-call",
        content: prompt,
        metadata: { iteration: state.iteration, source: "model" }
      }),
      (response) => options.onEvent({
        stage: "llm-response",
        content: response,
        metadata: { iteration: state.iteration, source: "model" }
      })
    );
    options.onEvent({
      stage: "reflection",
      content: reflection,
      metadata: {
        iteration: state.iteration,
        durationMs: performance.now() - startedAt,
        source: "model"
      }
    });
    return {
      reflection,
      steps: [...state.steps, { decision, observation: state.observation, reflection }]
    };
  };

  const finishNode = (state: AirbusIntelligenceHubGraphState) => {
    const answer = state.decision?.type === "answer"
      ? state.decision.answer
      : state.reflection?.sufficient
        ? state.reflection.summary
      : `Stopped after ${iterationLimit} iterations without enough evidence.`;
    options.onEvent({
      stage: "answer",
      content: answer,
      metadata: {
        iteration: state.iteration,
        durationMs: performance.now() - runStartedAt,
        source: "controller"
      }
    });
    return { answer };
  };

  const routeDecision = (state: AirbusIntelligenceHubGraphState): "execute" | "finish" =>
    state.decision?.type === "tool" ? "execute" : "finish";
  const routeReflection = (state: AirbusIntelligenceHubGraphState): "decide" | "finish" => {
    if (state.reflection?.sufficient
      && state.decision?.type === "tool"
      && new Set(["searchRunbook", "searchKnowledge"]).has(state.decision.toolName)
      && !requiresCombinedKnowledgeAndApi(state.goal)) {
      return "finish";
    }
    const requiredTool = requiredEvidenceDecision(state.goal, state.steps);
    if (requiredTool && state.iteration < iterationLimit) return "decide";
    return state.reflection?.sufficient || state.iteration >= iterationLimit ? "finish" : "decide";
  };

  return new StateGraph(GraphState)
    .addNode("decide", decideNode)
    .addNode("execute", executeNode)
    .addNode("reflect", reflectNode)
    .addNode("finish", finishNode)
    .addEdge(START, "decide")
    .addConditionalEdges("decide", routeDecision, {
      execute: "execute",
      finish: "finish"
    })
    .addEdge("execute", "reflect")
    .addConditionalEdges("reflect", routeReflection, {
      decide: "decide",
      finish: "finish"
    })
    .addEdge("finish", END)
    .compile();
}

/** Invokes the compiled graph with explicit initial state. */
export async function runAirbusIntelligenceHubGraph(goal: string, options: GraphWorkflowOptions): Promise<string> {
  options.onEvent({ stage: "prompt", content: goal, metadata: { source: "controller" } });
  const graph = createAirbusIntelligenceHubGraph(options);
  const result = await graph.invoke({
    goal,
    iteration: 0,
    steps: [],
    decision: null,
    observation: null,
    reflection: null,
    answer: ""
  });
  return result.answer;
}
