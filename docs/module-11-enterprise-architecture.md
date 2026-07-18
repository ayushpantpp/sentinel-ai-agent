# Module 11: Enterprise AI Architecture

## Executive summary

Sentinel AI is currently a modular TypeScript application with two local
inference/data sidecars:

```text
TypeScript process
├── CLI interfaces
├── manual and LangGraph orchestration
├── RAG pipeline
├── tools
├── memory
├── guardrails
└── observability

Local sidecars
├── Ollama: chat and embedding inference
└── ChromaDB: vector storage and similarity search
```

This is a good learning and development deployment. The code already contains
logical service boundaries, but most run inside one Node.js process.

Enterprise architecture starts by defining ownership and contracts. It does not
start by turning every folder into a network service.

## Target logical architecture

```text
                          ┌─────────────────────────────┐
                          │ CLI / Web / Operations UI   │
                          └──────────────┬──────────────┘
                                         │
                          ┌──────────────▼──────────────┐
                          │ API Gateway / Identity      │
                          │ authn, rate limit, tenant   │
                          └──────────────┬──────────────┘
                                         │
                 ┌───────────────────────▼───────────────────────┐
                 │ Agent Orchestrator                            │
                 │ LangGraph, state, planning, loop protection  │
                 └───────┬──────────┬──────────┬──────────┬──────┘
                         │          │          │          │
               ┌─────────▼───┐ ┌────▼─────┐ ┌──▼──────┐ ┌▼────────────┐
               │Model Gateway│ │RAG Service│ │Tool     │ │Memory       │
               │Ollama routes│ │retrieve   │ │Service  │ │Service      │
               └─────┬───────┘ └────┬─────┘ └──┬──────┘ └┬────────────┘
                     │              │           │          │
             ┌───────▼──────┐ ┌─────▼──────┐ ┌──▼──────┐ ┌▼────────────┐
             │Chat / Embed  │ │ChromaDB +  │ │Logs,    │ │Conversation,│
             │models        │ │documents   │ │Jira, etc│ │working, LTM │
             └──────────────┘ └────────────┘ └─────────┘ └─────────────┘

                 ┌──────────────────────────────────────────────┐
                 │ Cross-cutting control plane                  │
                 │ Policy, approval, evaluation, observability, │
                 │ model/prompt registry, governance            │
                 └──────────────────────────────────────────────┘
```

The boxes are logical components. They can remain modules in one process until
scale, security, team ownership, or release independence justifies separation.

## 1. Model Gateway

### Problem

Calling Ollama directly from every feature couples application code to model
names, endpoints, generation options, and error formats.

### Responsibilities

- Route chat and embedding requests.
- Validate approved model names and versions.
- Apply default temperature, timeout, and context limits.
- Normalize request and response formats.
- Enforce concurrency and queue limits.
- Record token estimates, latency, and failures.
- Support fallback between approved local models.
- Prevent unapproved models from entering production.

### Contract

```text
generate(ChatRequest) -> ChatResponse
embed(EmbeddingRequest) -> Vector[]
health() -> ModelReadiness
```

Application modules should depend on this contract rather than Ollama HTTP.

### Deployment

On one developer Mac, the gateway can be a TypeScript class. In a shared
on-premise environment, it may become a service in front of one or more
GPU-backed Ollama workers.

## 2. Embedding Service

### Problem

Documents and queries must use compatible embedding models. Uncoordinated model
changes can make existing vectors incomparable.

### Responsibilities

- Own the approved embedding model and vector dimension.
- Attach model/version metadata to every vector.
- Batch embedding requests.
- Cache identical text embeddings.
- Normalize text consistently.
- Trigger re-indexing when models change.
- Reject mixed embedding versions inside one collection.

### Versioning rule

```text
collection identity =
tenant + corpus + embedding model + model version + chunking version
```

Changing the embedding or chunking strategy creates a new index version. It
should not silently overwrite the production collection.

## 3. RAG Service

### Pipeline

```text
ingestion:
source -> load -> classify -> authorize -> chunk -> embed -> index

query:
identity -> query rewrite -> metadata filter -> embed -> retrieve
-> rerank -> context budget -> grounded generation -> citations
```

### Responsibilities

- Document connectors and ingestion schedules.
- Content classification and access metadata.
- Chunking policies by document type.
- Versioned embedding/index pipeline.
- Tenant and permission filtering before retrieval.
- Top-k retrieval and optional reranking.
- Context-window budgeting.
- Source citations and document lineage.
- Retrieval evaluation.

### Enterprise requirement

Retrieval must enforce the caller's document permissions. Finding semantically
relevant text is not authorization to reveal it.

## 4. Tool Service

### Problem

Agent tools connect probabilistic decisions to deterministic systems and side
effects. This is one of the highest-risk boundaries.

### Responsibilities

- Tool catalog and versioned schemas.
- Authentication to target systems.
- Per-user and per-agent authorization.
- Input validation.
- Human approval for consequential actions.
- Idempotency keys.
- Timeouts, retries, and circuit breakers.
- Output normalization and redaction.
- Complete audit records.

### Risk classes

```text
Class 0: read public/internal approved data
Class 1: read sensitive data
Class 2: reversible write, e.g. draft ticket
Class 3: external communication or production change
Class 4: destructive or irreversible action
```

Higher classes require stronger identity, approval, and audit controls. Some
actions should never be autonomous.

## 5. Memory Service

Memory types have different owners and retention policies:

| Memory | Scope | Typical storage | Retention |
| --- | --- | --- | --- |
| Conversation | One interaction | graph/checkpoint state | short |
| Working | One incident/workflow | durable workflow state | incident lifetime |
| Long-term | Approved facts | governed database | policy-based |
| Semantic | Retrieval index over facts | vector database | follows source |

### Responsibilities

- Explicit write policy.
- Provenance: who supplied each fact and when.
- Confidence and verification status.
- Tenant/user isolation.
- Expiration and deletion.
- Conflict handling.
- Semantic index synchronization.
- Protection against poisoned memory.

An LLM should not convert every conversation statement into permanent truth.

## 6. Evaluation Service

Observability says what happened. Evaluation says whether it was good.

### Offline evaluation

Run before releasing a model, prompt, retriever, or workflow:

- golden operational questions;
- expected sources;
- expected tool choices;
- severity-rule tests;
- injection and permission tests;
- groundedness;
- citation correctness;
- retrieval precision/recall;
- answer usefulness;
- latency and resource budgets.

### Online evaluation

Run on sampled production traces:

- user feedback;
- tool success rates;
- refusal and escalation rates;
- unsupported-claim detection;
- retrieval quality;
- approval acceptance/denial;
- repeated-loop frequency;
- drift by model or prompt version.

### Release gate

```text
candidate model/prompt
-> offline suite
-> security suite
-> latency/load suite
-> human review
-> canary
-> monitored rollout
```

## 7. Caching

Different layers need different cache policies:

### Embedding cache

Safest initial cache. Key by normalized text, model version, and embedding
configuration.

### Retrieval cache

Key by tenant, identity/permission hash, query, corpus version, embedding
version, and filters. Missing the permission hash can leak data across users.

### Model response cache

Use cautiously. Answers may depend on current context, memory, tool output,
policy, prompt version, and model version.

### Tool cache

Only cache explicitly cacheable read operations. Never replay cached write
success as proof that a new side effect occurred.

### Invalidation principle

AI cache keys must include every input that can materially change correctness or
authorization.

## 8. Scaling

### Stateless application tier

API and orchestration workers can scale horizontally when workflow state is
externalized. Local arrays and files must move to durable stores.

### Model inference tier

Local inference is the dominant latency in our traces. Scaling requires:

- bounded queues;
- concurrency limits;
- model warm pools;
- batching where supported;
- workload separation between chat and embeddings;
- GPU memory-aware scheduling;
- backpressure instead of unlimited requests.

### Vector tier

Scale ingestion and querying independently. Monitor collection size, query
latency, index build time, and embedding-version migrations.

### Tool tier

Protect downstream enterprise systems with bulkheads, rate limits, timeouts, and
circuit breakers. Agent retries must not amplify outages.

### Backpressure

```text
incoming requests > safe model capacity
-> queue up to bounded limit
-> reject or degrade gracefully
-> never consume unbounded memory
```

## 9. Multi-Agent Systems

Do not introduce multiple agents merely because the framework supports them.

### Appropriate use

- Independent specialist domains.
- Parallel evidence collection.
- Different permission boundaries.
- Separate models optimized for distinct tasks.
- Supervisor review of specialist outputs.

### Example

```text
Supervisor
├── Log investigation agent
├── Runbook/retrieval agent
├── Security analysis agent
└── Communications drafting agent
```

The supervisor receives structured results, not unrestricted private reasoning.

### Costs

- More model calls and latency.
- Harder debugging and attribution.
- Conflicting conclusions.
- Larger attack surface.
- More complex permissions.
- Potential agent-to-agent prompt injection.

A deterministic workflow with specialist tools is often simpler and safer.

## 10. Governance

### Required registries

- Approved model registry.
- Prompt and workflow version registry.
- Tool catalog and owners.
- Data-source and classification registry.
- Evaluation datasets and release results.

### Controls

- Authenticated human identity.
- Role and attribute-based authorization.
- Separation of duties for high-impact approvals.
- Immutable audit trails.
- Model and prompt change review.
- Data retention and deletion.
- Incident response for AI failures.
- Vendor and open-source dependency review.

### Audit question

For every answer or action, the organization should be able to determine:

```text
who requested it
which model/prompt/workflow versions ran
which documents were retrieved
which tools were requested and executed
which policy allowed or denied them
who approved side effects
what final result was returned
```

## Deployment evolution

### Stage 1: Developer workstation

- One Node.js process.
- Local Ollama.
- Local ChromaDB.
- Local JSONL traces.

### Stage 2: Shared internal environment

- Containerized application.
- Shared local/on-prem model workers.
- Durable relational workflow state.
- Managed internal Chroma deployment.
- Central identity and secrets.
- Central logs and traces.

### Stage 3: Production platform

- API gateway and authenticated UI.
- Horizontally scaled orchestrators.
- GPU inference pool with queueing.
- Versioned RAG ingestion/query services.
- Governed tool gateway.
- Durable checkpointing.
- Evaluation and release pipelines.
- Policy-as-code and approval service.
- SLOs, on-call ownership, disaster recovery.

## Reliability targets

Example starting SLOs must be derived from business requirements:

- Availability of read-only assistant workflows.
- p95 response latency by workflow class.
- Tool success rate.
- Retrieval source coverage.
- Unsupported-claim rate.
- Approval-path completion rate.
- Trace completeness.
- Recovery time after model/vector dependency failure.

Do not hide model inference latency inside one aggregate API metric. Our traces
already show it dominates end-to-end execution.

## Clean architecture mapping

```text
Domain
  Tool contracts, severity rules, memory types

Application
  ReAct, planning, LangGraph nodes, policies

Ports
  Model gateway, embedding, vector store, tools, trace sink

Adapters
  Ollama HTTP, Chroma client, filesystem, CLI
```

The next refactoring step would define ports for Ollama, ChromaDB, persistence,
and telemetry, then inject adapters through a composition root. That change
should be driven by testing and deployment needs rather than architecture
ceremony.

## Final architecture principles

1. Keep probabilistic reasoning behind deterministic boundaries.
2. Treat model output as untrusted input.
3. Separate retrieval relevance from authorization.
4. Make high-impact side effects explicit and approved.
5. Version models, prompts, embeddings, chunks, and workflows.
6. Preserve provenance from source to final answer.
7. Evaluate quality, not only uptime and latency.
8. Scale the bottleneck measured in traces.
9. Prefer one well-governed agent before multiple agents.
10. Design every action to be explainable and auditable.
