# Module 9: AI Observability

## Why ordinary application logs are insufficient

Traditional service logs answer questions such as which endpoint failed and how
long a database query took. An AI agent adds probabilistic decisions, prompts,
retrieval, tool proposals, policy decisions, and multi-step execution.

One agent run therefore needs a correlation ID connecting:

```text
prompt
-> decision
-> tool request
-> authorization
-> observation/retrieved documents
-> reflection
-> final answer
```

## Trace model

Every guarded run creates a UUID `traceId`. Each event records:

- schema version;
- trace ID;
- monotonically increasing sequence;
- timestamp;
- event type;
- iteration and component source;
- measured duration;
- redacted event data.

Events are appended locally to `data/observability/traces.jsonl`.

## What is measured

| Requirement | Trace event |
| --- | --- |
| Prompt | `prompt-guard` and `agent.prompt` |
| Retrieved documents | `agent.observation` after knowledge tools |
| Tool calls | `agent.action` |
| Tool output | `agent.observation` |
| Agent decisions | `agent.thought` |
| Guardrails | `agent.guardrail` |
| Reflection | `agent.reflection` |
| Final answer | `agent.answer` |
| Latency | `metadata.durationMs` |
| Full execution | duration on `agent.answer` |

## Timing boundaries

Different timers answer different operational questions:

- model decision time measures local LLM inference;
- policy time measures authorization and possible human waiting;
- tool time measures capability execution;
- reflection time is model inference and contributes to model time;
- total run time includes all components.

Human approval latency belongs to policy time because waiting is part of the
authorization boundary, not tool execution.

## Redaction

Trace data may contain prompts, retrieved documents, and tool arguments.
`TraceRecorder` redacts sensitive key names such as `password`, `token`,
`secret`, `authorization`, and API keys. It also masks common inline credential
forms.

Redaction is not a substitute for data classification. Production systems also
need access control, encryption, retention limits, regional storage rules, and
field-specific policies.

## Why JSONL

JSONL keeps one structured event per line. It is append-friendly, readable with
standard shell tools, and requires no new infrastructure for this learning
module. It is not a production observability backend.

Production evolution could export the same event model to OpenTelemetry,
Loki, Elasticsearch, CloudWatch, or a governed analytics platform.

## Trace viewer

`npm run traces` reads one trace and calculates deterministic metrics:

- event count;
- model decision time;
- tool execution time;
- policy time;
- tool-call count;
- observations;
- denied actions;
- ordered event timeline.

The viewer defaults to the latest trace. Pass a trace ID to inspect an older
run.

## Current limitations

- Events are buffered until the run completes.
- A process crash can lose the current buffer.
- JSONL writes are not coordinated across multiple processes.
- Token counts are not yet captured.
- Retrieved-document quality is logged but not evaluated.
- Trace files have no retention or rotation policy.
- Prompt content may contain regulated data even after basic redaction.
