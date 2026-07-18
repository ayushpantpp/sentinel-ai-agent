/**
 * Purpose: Expose Sentinel AI's real local workflow to the web console.
 * Architecture: A small Node HTTP server streams LangGraph events over SSE and
 * keeps operational resources in the same files used by the agent tools.
 * AI concept: The UI observes the orchestration layer instead of duplicating or
 * simulating model decisions.
 */
import { createWriteStream } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, open, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { assessPrompt } from "./guardrails/prompt-guard.js";
import { ToolPolicy, type AgentRole } from "./guardrails/tool-policy.js";
import { runSentinelGraph } from "./langgraph/workflow.js";
import type { AgentEvent } from "./agent/react-agent.js";
import {
  refreshRunbookEmbeddings,
  runbookIndexHealth,
  syncRunbookIndex
} from "./retrieval/runbook-vector-store.js";

const port = Number(process.env.SENTINEL_API_PORT ?? 8787);
const runbookDirectory = join(process.cwd(), "data/runbooks");
const logFile = join(process.cwd(), "data/logs/operations.log");

function corsHeaders(contentType = "application/json"): Record<string, string> {
  return {
    "access-control-allow-origin": "http://localhost:3000",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type,x-file-name",
    "content-type": contentType
  };
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, corsHeaders());
  response.end(JSON.stringify(value));
}

async function body(request: AsyncIterable<Uint8Array>): Promise<Record<string, unknown>> {
  let value = "";
  for await (const chunk of request) value += Buffer.from(chunk).toString("utf8");
  const parsed = JSON.parse(value || "{}") as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function sendEvent(response: ServerResponse, type: string, data: unknown): void {
  response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function health() {
  const check = async (url: string) => {
    const startedAt = performance.now();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      return { ready: response.ok, latencyMs: Math.round(performance.now() - startedAt) };
    } catch {
      return { ready: false, latencyMs: Math.round(performance.now() - startedAt) };
    }
  };
  const [ollama, chroma, agenticAiMcp, runbookIndex] = await Promise.all([
    check("http://127.0.0.1:11434/api/tags"),
    check("http://127.0.0.1:8000/api/v2/heartbeat"),
    check(
      new URL(
        "/health",
        process.env.AGENTIC_AI_MCP_URL ?? "http://127.0.0.1:3001/mcp"
      ).toString()
    ),
    runbookIndexHealth()
  ]);
  return { api: { ready: true }, ollama, chroma, agenticAiMcp, runbookIndex };
}

async function listResources() {
  const filenames = (await readdir(runbookDirectory)).filter((name) => name.endsWith(".md"));
  const knowledge = await Promise.all(filenames.map(async (source) => ({
    id: `knowledge-${source}`,
    kind: "knowledge",
    title: source.replace(/\.md$/, "").replaceAll("-", " "),
    content: (await readFile(join(runbookDirectory, source), "utf8")).slice(0, 1200),
    source,
    createdAt: "local file"
  })));
  const logs = (await recentLogLines()).map((content, index) => ({
    id: `log-${index}`,
    kind: "log",
    title: content.match(/service=([a-z0-9-]+)/i)?.[1] ?? `log event ${index + 1}`,
    content,
    source: "operations.log",
    createdAt: content.split(" ")[0] ?? "local file"
  }));
  return [...knowledge, ...logs.reverse()];
}

async function recentLogLines(maximumLines = 200): Promise<string[]> {
  const file = await open(logFile, "r");
  try {
    const { size } = await file.stat();
    const readSize = Math.min(size, 1024 * 1024);
    const buffer = Buffer.alloc(readSize);
    await file.read(buffer, 0, readSize, size - readSize);
    return buffer.toString("utf8").split("\n").filter(Boolean).slice(-maximumLines);
  } finally {
    await file.close();
  }
}

async function addResource(fields: Record<string, unknown>) {
  const kind = requiredText(fields.kind, "kind");
  const title = requiredText(fields.title, "title");
  const content = requiredText(fields.content, "content");
  if (kind === "log") {
    await appendFile(logFile, `${content}\n`, "utf8");
    return { id: `log-${crypto.randomUUID()}`, kind, title, content, source: "operations.log", createdAt: new Date().toISOString() };
  }
  if (kind !== "knowledge") throw new Error("kind must be log or knowledge.");
  const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || crypto.randomUUID();
  const source = `${safeName}.md`;
  await writeFile(join(runbookDirectory, source), `# ${title}\n\n${content}\n`, "utf8");
  let index: unknown;
  try {
    index = { ready: true, ...(await syncRunbookIndex()) };
  } catch (error) {
    index = {
      ready: false,
      error: error instanceof Error ? error.message : "Runbook saved; vector refresh is pending."
    };
  }
  return { id: `knowledge-${source}`, kind, title, content, source, createdAt: new Date().toISOString(), index };
}

async function updateRunbook(fields: Record<string, unknown>) {
  const source = requiredText(fields.source, "source");
  const title = requiredText(fields.title, "title");
  const content = requiredText(fields.content, "content");
  if (!/^[a-z0-9][a-z0-9-]*\.md$/i.test(source)) throw new Error("Invalid runbook source.");
  await writeFile(join(runbookDirectory, source), `# ${title}\n\n${content}\n`, "utf8");
  let index: unknown;
  try {
    index = { ready: true, ...(await refreshRunbookEmbeddings(source)) };
  } catch (error) {
    index = {
      ready: false,
      error: error instanceof Error ? error.message : "Runbook saved; vector refresh is pending."
    };
  }
  return {
    id: `knowledge-${source}`,
    kind: "knowledge",
    title,
    content,
    source,
    createdAt: new Date().toISOString(),
    index
  };
}

async function uploadLogFile(request: IncomingMessage) {
  await appendFile(logFile, "\n", "utf8");
  await pipeline(request, createWriteStream(logFile, { flags: "a", encoding: "utf8" }));
  await appendFile(logFile, "\n", "utf8");
  return { uploaded: true };
}

async function runAgent(requestBody: Record<string, unknown>, response: ServerResponse): Promise<void> {
  const goal = requiredText(requestBody.goal, "goal");
  const role: AgentRole = requestBody.role === "viewer" ? "viewer" : "operator";
  response.writeHead(200, {
    ...corsHeaders("text/event-stream"),
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  const assessment = assessPrompt(goal);
  sendEvent(response, "agent-event", {
    stage: "prompt-guard",
    content: assessment,
    metadata: { source: "policy", durationMs: 0 }
  });
  if (!assessment.allowed) {
    sendEvent(response, "error", { message: "Prompt blocked before model execution." });
    response.end();
    return;
  }

  const policy = new ToolPolicy({
    role,
    approve: async () => false
  });

  try {
    const answer = await runSentinelGraph(goal, {
      maximumIterations: 5,
      authorizeTool: (authorizationRequest) => policy.authorize(authorizationRequest),
      onEvent: (event: AgentEvent) => sendEvent(response, "agent-event", event)
    });
    sendEvent(response, "complete", { answer });
  } catch (error) {
    sendEvent(response, "error", {
      message: error instanceof Error ? error.message : "Unknown agent failure."
    });
  } finally {
    response.end();
  }
}

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && request.url === "/api/health") {
      json(response, 200, await health());
      return;
    }
    if (request.method === "GET" && request.url === "/api/resources") {
      json(response, 200, await listResources());
      return;
    }
    if (request.method === "POST" && request.url === "/api/resources") {
      json(response, 201, await addResource(await body(request)));
      return;
    }
    if (request.method === "PUT" && request.url === "/api/runbooks") {
      json(response, 200, await updateRunbook(await body(request)));
      return;
    }
    if (request.method === "POST" && request.url === "/api/log-files") {
      json(response, 201, await uploadLogFile(request));
      return;
    }
    if (request.method === "POST" && request.url === "/api/agent") {
      await runAgent(await body(request), response);
      return;
    }
    json(response, 404, { error: "Not found." });
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : "Unknown request error." });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Sentinel API listening on http://127.0.0.1:${port}`);
});
