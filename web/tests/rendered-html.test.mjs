import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function renderHtml() {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  return response.text();
}

test("server-renders the Airbus Intelligence Hub operations console", async () => {
  const html = await renderHtml();

  assert.match(html, /<title>Airbus Intelligence Hub · Decision Console<\/title>/i);
  assert.match(html, />Airbus Intelligence Hub<\/strong>/);
  assert.match(html, />Manufacturing intelligence<\/span>/);
  assert.match(html, /src="\/sopra-steria-logo\.svg"/);
  assert.match(html, /aria-label="Main navigation"/);
  assert.match(html, />Decision trace<\/span>/);
  assert.match(html, />Knowledge base<\/span>/);
  assert.match(html, />MCP connections<\/span>/);
  assert.match(html, />Ask Airbus Intelligence Hub<\/span>/);
  assert.match(html, /aria-label="Question for Airbus Intelligence Hub"/);
  assert.match(html, />Run agent<\/button>/);
  assert.doesNotMatch(html, /Upload log file|>Local logs<|>Logs<\/button>/i);
});

test("server-renders MCP health and trace inspection UI", async () => {
  const html = await renderHtml();

  assert.match(html, />Ollama<\/span>/);
  assert.match(html, />Semantic search<\/span>/);
  assert.match(html, />Optional index offline<\/strong>/);
  assert.match(html, />Keyword search remains active<\/small>/);
  assert.match(html, />Airbus APIs · MCP<\/span>/);
  assert.match(html, />Start Airbus APIs on port 3001<\/small>/);
  assert.match(html, />Core service unavailable<\/div>/);
  assert.match(html, />Live execution<\/span>/);
  assert.match(html, />Decision flow<\/h2>/);
  assert.match(html, /Run the agent to create a live trace\./);
  assert.match(html, /TRACE\s*<strong>E958D7B0<\/strong>/);
});

test("server-renders aircraft manufacturing use cases", async () => {
  const html = await renderHtml();

  assert.match(html, /aircraft production orders grouped by not started/i);
  assert.match(html, /pilots have aircraft training overdue/i);
  assert.match(html, /identify each owner, and notify/i);
});
