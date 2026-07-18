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
cd web
npm install
npm run dev
```

Open `http://localhost:3000`.

## Local services

- Sentinel API: `http://127.0.0.1:8787`
- Ollama: `http://127.0.0.1:11434`
- ChromaDB health check: `http://127.0.0.1:8000`

## Validation

```bash
npm run typecheck
cd web && npm run build && npm run lint
```

See `SENTINEL-ARCHITECTURE.md` for the request-level design.
