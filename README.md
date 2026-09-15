# Airbus Intelligence Hub

Airbus Intelligence Hub is a local, API-based operations agent with a React web interface.
The browser is the only user interface.

## Start everything

Airbus Intelligence Hub now includes the Airbus APIs MCP server under `apps/agentic-ai`, so the
complete learning project can be installed and pushed as one repository.

```bash
npm run setup
npm run dev
```

This starts Airbus Intelligence Hub API (`8787`), Airbus Intelligence Hub web (`3000`), Airbus APIs MCP
(`3001`), and Weather MCP (`3002`). Ollama and ChromaDB remain external local
services.

## Start services separately

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

- Airbus Intelligence Hub API: `http://127.0.0.1:8787`
- Ollama: `http://127.0.0.1:11434`
- ChromaDB health check: `http://127.0.0.1:8000`
- Airbus APIs MCP server: `http://127.0.0.1:3001/mcp`
- Weather MCP server: `http://127.0.0.1:3002/mcp`

The weather server exposes `getWeather`, which geocodes a city and retrieves
current conditions from Open-Meteo. The web console's **MCP connections** view
discovers tools from every server in `config/mcp-servers.json`.

Fleet, aircraft, delivery, and maintenance questions are delegated to Agentic
AI through its `orchestrate` MCP tool. Start Airbus APIs separately before using
that capability. Override the endpoint with `AIRBUS_APIS_MCP_URL` when needed.

## Test the Airbus APIs MCP integration

Start Airbus APIs from its own project:

```bash
cd ../agentic-ai
npm run dev
```

Then start the Airbus Intelligence Hub API and web interface in separate terminals:

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

The Engine sidebar shows whether `Airbus APIs · MCP` is connected. During the
run, the decision trace shows `MCP call · Airbus APIs`, including the MCP
endpoint and the question sent to the remote `orchestrate` tool.

## Validation

```bash
npm run typecheck
cd web && npm run build && npm run lint
```

See `AIRBUS-INTELLIGENCE-HUB-ARCHITECTURE.md` for the request-level design.
