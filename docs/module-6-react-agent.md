# Module 6: How the manual ReAct agent decides

## The short version

The LLM does not execute tools. The TypeScript controller owns the loop and
gives the LLM two choices: request one approved tool or return a final answer.
The controller validates the choice, executes the tool, records its output, and
sends the accumulated evidence back to the LLM.

## Responsibility split

| Decision | Owner |
| --- | --- |
| Maximum of five iterations | TypeScript controller |
| Tools available to the agent | TypeScript allowlist |
| `remember` excluded from autonomous use | TypeScript allowlist |
| Logs required when the goal says "logs" | TypeScript evidence rule |
| Runbook required for documented guidance | TypeScript evidence rule |
| Which additional approved tool may help | LLM decision call |
| Tool input arguments | LLM proposal, then tool validation |
| Actual tool execution | TypeScript controller |
| Whether evidence appears sufficient | LLM reflection, normalized by controller |
| Final response wording | LLM decision call |

## Agent state

Each completed tool call becomes one `AgentStep` containing:

```text
decision    tool name, input, and brief rationale
observation exact success/error returned by application code
reflection  evidence summary, sufficiency, and suggested next step
```

The `steps` array is equivalent to workflow-instance state. It is passed back
to the next model decision so the model can see what has already happened and
avoid repeating the same action.

## One complete iteration

1. `runReactAgent()` checks deterministic evidence requirements.
2. If no policy-required action exists, `decide()` asks Phi for the next action.
3. Phi receives the user goal, approved tool definitions, and previous steps.
4. Phi must return structured JSON describing a tool request or final answer.
5. TypeScript parses and normalizes the JSON.
6. `execute()` rejects unapproved tools, then calls the selected implementation.
7. The tool validates its own arguments and returns structured data or an error.
8. `reflect()` asks Phi to evaluate the observation together with previous steps.
9. The complete step is appended to state and the loop starts again.

## Payment-latency example

Goal:

```text
Investigate the payment API latency using local logs and recommend the
documented next action.
```

Before asking Phi, `requiredEvidenceDecision()` sees the word `logs`. Because
`searchLogs` has not run, the controller selects it. This is deterministic.

After that observation is stored, the next loop sees `documented next action`.
Because no knowledge tool has run, the controller selects `searchRunbook`.
This is also deterministic.

Once both evidence classes are present, the controller calls `decide()`. Phi
receives the logs and runbook results and may now return an answer. In the
validated run, it connected database-pool saturation in the logs with the
documented checks and approved mitigation in the runbook.

## How Phi sees tools

The application converts each tool definition into a catalog containing:

```json
{
  "name": "searchLogs",
  "description": "Search local operations logs for matching service names, errors, or incident terms.",
  "inputSchema": {
    "type": "object",
    "required": ["query"],
    "properties": { "query": { "type": "string" } }
  }
}
```

Descriptions tell the model when a capability is useful. The schema tells it
which arguments to propose. The actual TypeScript tool still validates those
arguments because model output is untrusted.

## Why structured JSON is required

Free-form text such as "I should search the logs" is difficult to execute
safely. The controller requires a machine-readable envelope:

```json
{
  "type": "tool",
  "rationale": "Payment latency requires log evidence.",
  "toolName": "searchLogs",
  "input": { "query": "payment API latency" },
  "answer": ""
}
```

Ollama receives a JSON Schema as its response format. The controller still
normalizes known local-model variations and rejects unknown decision types.

## Reflection

Reflection is a second model call with a narrower responsibility. It does not
execute anything. It evaluates accumulated evidence and returns:

```json
{
  "sufficient": false,
  "summary": "Logs confirm latency and pool saturation.",
  "nextStep": "Retrieve the documented response procedure."
}
```

Reflection can be wrong because it is still LLM output. Therefore controller
rules, not reflection alone, enforce mandatory evidence.

## Loop protection

The loop runs at most five times. Without this circuit breaker, a model could
repeat searches indefinitely, consume CPU and memory, or repeatedly request a
side-effecting operation. When the limit is reached, the controller returns a
safe incomplete-result message.

## Current limitations

- Evidence requirements use simple keyword rules rather than a formal plan.
- Tool search uses lexical matching; RAG uses semantic retrieval separately.
- Reflection quality depends on the small local model.
- The loop has no retry policy for malformed model output.
- Human approval and permission policies arrive in the guardrails module.
- Durable checkpoints and recovery arrive with workflow state management.
