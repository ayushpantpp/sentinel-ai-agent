/**
 * Purpose: Express Sentinel AI's manual ReAct loop as a LangGraph StateGraph.
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

type SentinelGraphState = typeof GraphState.State;

export interface GraphWorkflowOptions extends AgentOptions {
  onEvent: (event: AgentEvent) => void;
}

/**
 * Builds a compiled graph. Closures inject guardrails and event recording while
 * graph state remains serializable workflow data.
 */
export function createSentinelGraph(options: GraphWorkflowOptions) {
  const iterationLimit = Math.min(
    defaultMaximumIterations,
    Math.max(1, options.maximumIterations ?? defaultMaximumIterations)
  );
  const runStartedAt = performance.now();

  const decideNode = async (state: SentinelGraphState) => {
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

  const executeNode = async (state: SentinelGraphState) => {
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

  const reflectNode = async (state: SentinelGraphState) => {
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

  const finishNode = (state: SentinelGraphState) => {
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

  const routeDecision = (state: SentinelGraphState): "execute" | "finish" =>
    state.decision?.type === "tool" ? "execute" : "finish";
  const routeReflection = (state: SentinelGraphState): "decide" | "finish" =>
    state.reflection?.sufficient || state.iteration >= iterationLimit ? "finish" : "decide";

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
export async function runSentinelGraph(goal: string, options: GraphWorkflowOptions): Promise<string> {
  options.onEvent({ stage: "prompt", content: goal, metadata: { source: "controller" } });
  const graph = createSentinelGraph(options);
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
