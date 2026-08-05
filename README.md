# Sentinel AI

Sentinel AI is a local, API-based operations agent with a React web interface.
The browser is the only user interface.

## Start

Terminal 1:

```bash
npm install
npm run api
```

Terminal 2:

```bash
npm run weather:mcp
```

Terminal 3:

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3000`.

## Local services

- Sentinel API: `http://127.0.0.1:8787`
- Ollama: `http://127.0.0.1:11434`
- ChromaDB health check: `http://127.0.0.1:8000`
- Agentic AI MCP server: `http://127.0.0.1:3001/mcp`
- Weather MCP server: `http://127.0.0.1:3002/mcp`

The weather server exposes `getWeather`, which geocodes a city and retrieves
current conditions from Open-Meteo. The web console's **MCP connections** view
discovers tools from every server in `config/mcp-servers.json`.

Fleet, aircraft, delivery, and maintenance questions are delegated to Agentic
AI through its `orchestrate` MCP tool. Start Agentic AI separately before using
that capability. Override the endpoint with `AGENTIC_AI_MCP_URL` when needed.

## Test the Agentic AI MCP integration

Start Agentic AI from its own project:

```bash
cd ../agentic-ai
npm run dev
```

Then start the Sentinel API and web interface in separate terminals:

```bash
cd ../first-ai-agent
npm run api
```

```bash
cd ../first-ai-agent/web
npm run dev
```

Open `http://localhost:3000` and ask:

```text
Show all aircraft owned by Lufthansa.
```

The Engine sidebar shows whether `Agentic AI · MCP` is connected. During the
run, the decision trace shows `MCP call · Agentic AI`, including the MCP
endpoint and the question sent to the remote `orchestrate` tool.

## Validation

```bash
npm run typecheck
cd web && npm run build && npm run lint
```

See `SENTINEL-ARCHITECTURE.md` for the request-level design.
