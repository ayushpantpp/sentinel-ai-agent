# AI API Orchestrator

A full-stack MVP that turns an operations question into a typed execution plan, calls dependent mock REST services, merges the results, and asks a locally hosted Ollama model for the final answer.


## Quick start

Prerequisites: Node.js 22+, npm, and [Ollama](https://ollama.com).

```bash
cp .env.example .env
ollama serve
ollama pull phi4-mini
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs at `http://localhost:3001`.

## Example prompts

- Show all aircraft owned by Lufthansa.
- Which aircraft are under maintenance?
- Show deliveries for customer Airbus.
- Give me a fleet summary.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Backend port |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama HTTP endpoint |
| `OLLAMA_MODEL` | `phi4-mini` | Model used for analysis and synthesis |
| `LOG_LEVEL` | `info` | Pino logging level |

## API

`POST /api/orchestrate`

```json
{ "question": "Show all aircraft owned by Lufthansa." }
```

The response includes structured intent analysis, the execution plan, every API call and duration, the merged raw data, the final answer. `GET /health` provides a readiness check. Mock service endpoints are exposed under `/api/mock`.

The same orchestration capability is also available as the `orchestrate` MCP
tool over Streamable HTTP at `http://localhost:3001/mcp`. This is an adapter
over the existing service; the REST API remains available with the contract
above, and the application still runs independently with `npm run dev` or
`npm start`.

## Architecture

```text
React UI → Express controller → OrchestratorService
                                  ├─ IntentAnalyzer → ILLMProvider → OllamaProvider
                                  ├─ ApiRegistry → ExecutionPlanner
                                  ├─ ApiExecutor → mock REST services / JSON data
                                  └─ ResponseMapper → final LLM response
```

`server/src` is organized into `api`, `config`, `data`, `executor`, `llm`, `mapper`, `middleware`, `mock-services`, `models`, `planner`, `registry`, `services`, `types`, and `utils`. The UI is in `client/src`.

## Tests and production build

```bash
npm test
npm run build
npm start
```

For a containerized backend plus Ollama, run `docker compose up --build`; pull the model into its Ollama instance with `docker compose exec ollama ollama pull phi4-mini`.

## Extending it

- Register a real API by adding metadata to `ApiRegistry`; the planner selects capabilities from the registry and honors declared dependencies.
- Add an `ILLMProvider` implementation (OpenAI, Azure, etc.) without changing orchestration logic.
 Add authentication, persistent request history, per-service circuit breakers, API schemas, streaming, and a durable workflow engine for production use.
