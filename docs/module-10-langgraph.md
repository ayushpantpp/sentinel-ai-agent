# Module 10: Replacing Manual Orchestration with LangGraph

## Why LangGraph exists

Our manual ReAct loop owns state, iteration, branching, termination, and event
sequencing in one `for` loop. That implementation taught the mechanics, but
workflow complexity grows quickly when adding retries, approvals, checkpoints,
parallel branches, or resumability.

LangGraph provides a graph runtime for stateful, long-running workflows. It does
not replace our model, prompts, tools, RAG, memory, permissions, or observability.

## Manual-to-graph mapping

| Manual implementation | LangGraph implementation |
| --- | --- |
| Local `steps` array | Typed graph state |
| `for` loop | Conditional graph cycle |
| Function call | Named graph node |
| `if decision.type` | Conditional edge |
| `return answer` | Edge to `END` |
| Maximum iteration check | Reflection router |
| Manually passing state | Node state updates |

## Shared graph state

Every node receives the same typed state:

```text
goal
iteration
steps
decision
observation
reflection
answer
```

Nodes return partial updates. LangGraph merges those updates into the next state.

## Nodes

### Decide

Uses the same controller-required evidence rules and Phi decision function from
the manual agent. It writes `iteration` and `decision`.

### Execute

Runs role permission, human approval, and duplicate-call checks before invoking
the same trusted tool implementation. It writes `observation`.

### Reflect

Evaluates accumulated evidence and appends a complete `AgentStep` to `steps`.

### Finish

Writes and emits the final answer or bounded-loop fallback.

## Edges

```text
START -> decide

decide -- tool request --> execute
decide -- final answer --> finish

execute -> reflect

reflect -- iterations remain --> decide
reflect -- limit reached --> finish

finish -> END
```

This topology is compiled before invocation. Compilation validates basic graph
structure and creates the executable graph.

## What became easier

- Control flow is visible as named nodes and edges.
- State is defined once rather than passed manually through every call.
- Branching is isolated in router functions.
- Loop termination is represented as graph topology.
- Nodes can later receive framework retry policies.
- A checkpointer can later persist state between nodes.
- Human approval can evolve into graph interrupts and resume commands.
- Individual nodes can become reusable subgraphs.

## What did not become easier

- Prompt quality
- Local model reliability
- Tool argument validation
- Permission design
- Prompt-injection defense
- Retrieval quality
- Business rules
- Evaluation criteria

LangGraph orchestrates these concerns; it does not solve them.

## Why existing code is reused

The graph imports the manual agent's decision, execution, reflection, and
evidence functions. This prevents a framework migration from silently changing
business behavior. Only the orchestration owner changes.

## Current limitations

- No persistent checkpointer is configured yet.
- Human approval uses our CLI callback rather than LangGraph interrupts.
- The graph is rebuilt for each CLI invocation.
- Node-level retry policies are not configured.
- State contains raw observations and may grow large.
- We still use our own trace recorder rather than a graph-native tracer.

## Reflection is not automatically trustworthy

LangGraph controls when the reflection node runs, but it does not make the
reflection model correct. A focused log test initially found an exact
`p95 latency exceeded 2 seconds` entry, while Phi still marked evidence
insufficient and incorrectly interpreted `1800 ms`.

The application now handles this narrow numeric threshold check
deterministically. This illustrates the boundary: graph orchestration guarantees
execution order, while business-critical evidence interpretation still needs
rules or evaluation.

These are intentional so the first comparison stays focused on orchestration.
