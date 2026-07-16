# Module 7: Planning, Retry, and Recovery

## Why this module exists

The Module 6 ReAct agent chooses one action, executes it, observes the result,
and then chooses again. That is useful when the path is unknown, but it makes
the complete strategy difficult to inspect before execution.

Module 7 introduces a separate planning phase. It converts one high-level goal
into a bounded list of tasks before any tool executes.

```text
Goal
  -> proposed plan
  -> validated plan
  -> task execution
  -> retry or recovery
  -> final synthesis
```

This resembles Step Functions, Temporal, or a job orchestration engine. The LLM
proposes the workflow definition; deterministic application code owns runtime
execution.

## Main concepts

### Goal

A goal describes the desired outcome, not the implementation steps.

```text
Investigate payment API latency using local logs and recommend the documented
next action.
```

The goal contains two evidence requirements:

1. Local logs must be inspected.
2. Documented operational guidance must be retrieved.

### Task breakdown

The planner asks Phi to turn the goal into a small ordered task list. A task
contains:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier used in events and errors |
| `title` | Human-readable operation |
| `toolName` | Approved application capability to execute |
| `input` | Proposed JSON arguments for the tool |
| `successCriteria` | Description of useful output |
| `required` | Whether failure must stop the plan |
| `maxAttempts` | Maximum executions before failure |

An example task is:

```json
{
  "id": "task-1",
  "title": "Search payment API logs",
  "toolName": "searchLogs",
  "input": { "query": "payment API latency" },
  "successCriteria": "Relevant latency or error entries are returned.",
  "required": true,
  "maxAttempts": 2
}
```

### Execution plan

An execution plan combines the original goal with runtime tasks. Runtime fields
are added to every task:

```text
status: pending | running | completed | failed | skipped
attempts: number of executions already attempted
result: successful tool output
error: most recent failure
```

The plan is mutable workflow-instance state. The planner proposes static tasks;
the executor updates runtime status.

## Responsibility split

| Responsibility | Owner |
| --- | --- |
| Propose task breakdown | Phi |
| Limit plan to five tasks | JSON Schema and TypeScript |
| Allow only registered tools | TypeScript |
| Require logs when requested | TypeScript |
| Require runbooks when requested | TypeScript |
| Normalize retry count to 2-3 | TypeScript |
| Execute tool code | TypeScript |
| Validate tool arguments | Individual tool |
| Classify failures | TypeScript |
| Retry tasks | TypeScript |
| Synthesize completed results | Phi |

The LLM is used where language understanding helps. TypeScript is used where
repeatability, authorization, and correctness matter.

## Phase 1: Create the proposed plan

`createPlan()` sends Phi:

- the user goal;
- approved tool names;
- descriptions explaining when tools are useful;
- input schemas;
- rules such as avoiding conditional tasks.

Ollama receives a JSON Schema requiring a goal and task array. Temperature is
zero to reduce unnecessary plan variation.

Structured output improves reliability but does not make model output trusted.
The response still passes through TypeScript validation.

## Phase 2: Validate each task

`validateTask()` verifies:

1. The task is an object.
2. Required text fields are non-empty.
3. The requested tool exists in the autonomous allowlist.
4. Tool input is a JSON object.
5. Mock integration tasks cannot be required.
6. Attempts are bounded between two and three.

Argument-level validation happens later inside the selected tool. For example,
`calculateSeverity` rejects `null` when `errorRatePercent` must be numeric.

This creates two validation layers:

```text
Plan validation -> Is this a valid and approved task?
Tool validation -> Are these valid arguments for this capability?
```

### Why not validate every tool schema in the planner?

The tool is the authoritative owner of its input contract. Duplicating all
validation in the planner would create two implementations that could drift.

## Phase 3: Add mandatory evidence coverage

Phi might forget part of the goal. `addRequiredCoverage()` checks the task list
against explicit goal language.

If the goal mentions logs but has no `searchLogs` task, TypeScript adds one. If
the task already exists, it is marked required.

If the goal requests a documented procedure but has no knowledge-search task,
TypeScript adds `searchRunbook`. Existing runbook or knowledge tasks become
required.

This is a policy invariant:

```text
Goal requires evidence X -> plan cannot complete without task X
```

## Phase 4: Execute tasks sequentially

`executePlan()` processes tasks in order. Before execution:

```text
pending -> running
```

For every attempt:

1. Increment `attempts`.
2. Find the approved tool.
3. Execute it with the proposed input.
4. Store its result or error.
5. Decide whether to retry, recover, or continue.

On success:

```text
running -> completed
result = tool output
previous transient error = removed
```

## Retry

Retry is appropriate when repeating the same request might succeed without
changing its input. Examples include:

- temporary timeout;
- process temporarily unavailable;
- short-lived network interruption;
- dependency rate limit.

The learning flag `--simulate-transient-failure` makes the first task throw a
temporary timeout once. It proves that the state transition works:

```text
attempt 1 -> temporary timeout -> retry
attempt 2 -> success -> completed
```

Retries are bounded. An unbounded retry loop could consume resources forever.

## Permanent failure

Repeating malformed input does not help. The executor treats errors containing
contract failures such as `must be`, `unknown tool`, or `invalid JSON` as
permanent.

```text
errorRatePercent = null
  -> validation error
  -> permanent failure
  -> no retry
```

A production implementation would use typed error categories rather than text
matching. Text classification remains explicit here so the mechanics are easy
to see before introducing more infrastructure.

## Recovery

Recovery answers: what should the workflow do after retries are exhausted?

### Required task failure

If a required task fails:

1. Mark it `failed`.
2. Mark remaining pending tasks `skipped`.
3. Stop execution.
4. Produce a partial answer that clearly reports missing evidence.

Continuing could produce an authoritative-looking answer without mandatory
evidence.

### Optional task failure

If an optional task fails:

1. Mark it `failed`.
2. Record the error.
3. Emit a recovery event.
4. Continue with the next task.

This allows graceful degradation. For example, failure to create a mock ticket
should not discard valid incident evidence.

## Final synthesis

After execution, `synthesizePlan()` sends the complete plan state to Phi. The
prompt requires the model to:

- use only completed task results;
- mention failed required tasks;
- express uncertainty;
- distinguish observed evidence from recommendations;
- avoid claiming that a recommended action already happened.

This final distinction matters:

```text
Observation: waiting connections reached 86 percent.
Recommendation: inspect pool metrics and pause batch jobs after approval.
```

The recommendation came from a runbook. It is not proof that anyone performed
the action or granted approval.

## Complete payment example

```text
1. Goal received
2. Phi proposes searchLogs and searchRunbook
3. TypeScript validates both tools
4. Controller marks both tasks required
5. searchLogs attempt 1 times out
6. Executor classifies timeout as retryable
7. searchLogs attempt 2 succeeds
8. searchRunbook succeeds
9. Completed evidence is sent for synthesis
10. Phi returns observations and documented recommendations
```

## Planning versus ReAct

| Planning | ReAct |
| --- | --- |
| Produces tasks before execution | Chooses one action at a time |
| Easier to inspect expected work | Adapts naturally to each observation |
| Useful for predictable workflows | Useful for open-ended investigation |
| Can become stale after new evidence | Can wander or repeat actions |

Enterprise systems often combine both: a high-level plan defines milestones,
while a ReAct worker handles uncertainty inside an individual task.

## Current limitations

- Tasks are sequential; dependencies are implicit in array order.
- There is no conditional task evaluator.
- Retry classification currently examines error text.
- Plans are held in memory and cannot resume after process failure.
- Tool success criteria are descriptive and not programmatically evaluated.
- The planner can still propose unnecessary tasks; controller validation limits
  damage but cannot guarantee an optimal plan.

These limitations motivate later state-management, guardrail, observability,
and evaluation modules.
