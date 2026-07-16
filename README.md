# Sentinel AI

Local-first enterprise operations agent, built incrementally in TypeScript.

## Module 1: Local chat

This first CLI calls the Ollama API at `http://127.0.0.1:11434/api/chat`.
The model remains on your machine; no hosted AI service is used.

### Prerequisites

- Ollama is running locally.
- A chat model is installed. This project defaults to `phi4-mini:latest`.

### Run

```bash
npm install
npm run chat
```

To use a different installed model:

```bash
OLLAMA_MODEL=your-model npm run chat
```

## Design notes

The CLI sends a request with one `user` message and `stream: false`. Ollama
runs inference locally, then returns the complete assistant message. There is
no conversation history yet; Module 1 deliberately keeps the state boundary
explicit before later modules introduce memory and agent workflows.

## Module 3: RAG

RAG (retrieval-augmented generation) gives the LLM relevant local knowledge at
request time. The pipeline loads Markdown runbooks, chunks them, creates vectors
with Ollama's `nomic-embed-text`, stores them in local ChromaDB, retrieves the
closest chunks, and asks the chat model to answer only from that context.

Start ChromaDB in a separate terminal, persisting its data under this project:

```bash
chroma run --path ./chroma-data
```

Install the local Ollama embedding model once:

```bash
ollama pull nomic-embed-text
```

Then run:

```bash
npm run rag
```

## Module 4: Tools

Tools are typed application capabilities that an AI model may request. The
application, not the model, validates input and decides whether execution is
allowed. Module 4 keeps selection manual so the execution boundary is visible.

List tools:

```bash
npm run tool -- list
```

Invoke a tool with explicit JSON input:

```bash
npm run tool -- calculateSeverity '{"customerImpact":true,"serviceUnavailable":true}'
npm run tool -- searchLogs '{"query":"payment database"}'
npm run tool -- remember '{"content":"Payment API owner is the Checkout team"}'
npm run tool -- searchMemory '{"query":"Checkout owner"}'
```

The Jira and Slack tools are mocks. They return structured payloads but never
contact an external system or create side effects.

## Module 5: Memory

The memory CLI keeps four stores separate:

- Conversation memory: recent messages for the current process.
- Working memory: current incident key/value state for the current process.
- Long-term memory: durable local facts in `data/memory/memories.jsonl`.
- Semantic memory: a Chroma index used to recall durable facts by meaning.

With Ollama and ChromaDB running:

```bash
npm run memory
```

Try this sequence:

```text
/context incident=INC-1042
/context affectedService=payment-api
/remember The Checkout team owns payment-api
Who owns the affected service?
/exit
```

Conversation and working memory disappear on exit. Long-term and semantic
memory remain available in the next session.

## Module 6: Manual ReAct agent

The agent implements the loop directly: decide, act, observe, reflect, and
either repeat or answer. It does not use LangChain or LangGraph. Model output is
strict JSON and every tool request passes through the application tool gateway.

```bash
npm run agent
```

Example goal:

```text
Investigate the payment API latency using local logs and recommend the documented next action.
```

The loop stops after five iterations. Durable memory writes are excluded from
autonomous tools, and Jira/Slack integrations remain side-effect-free mocks.

See `docs/module-6-react-agent.md` for the full decision-by-decision walkthrough.

## Module 7: Planning, retry, and recovery

The planner separates goal decomposition from execution. Phi proposes a bounded
ordered plan; TypeScript validates every task, adds mandatory evidence coverage,
executes tasks sequentially, retries transient failures, and stops safely when
a required task fails.

```bash
npm run plan
```

To observe retry behavior without breaking a real dependency:

```bash
npm run plan -- --simulate-transient-failure
```

See `docs/module-7-planning.md` for the detailed architecture, execution trace,
retry classification, and recovery walkthrough.
