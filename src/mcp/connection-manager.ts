import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

type McpServerConfig = {
  id: string;
  name: string;
  description: string;
  url: string;
  healthUrl: string;
  access: "read" | "write";
};

async function configuredServers(): Promise<McpServerConfig[]> {
  const value = JSON.parse(await readFile(join(process.cwd(), "config/mcp-servers.json"), "utf8")) as unknown;
  if (!Array.isArray(value)) throw new Error("MCP server configuration must be an array.");
  return value as McpServerConfig[];
}

async function inspectServer(config: McpServerConfig) {
  const startedAt = performance.now();
  const client = new Client({ name: "sentinel-connection-manager", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(config.url));
  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Connection timed out after 2 seconds.")), 2_000))
    ]);
    const result = await client.listTools();
    return {
      ...config,
      ready: true,
      latencyMs: Math.round(performance.now() - startedAt),
      tools: result.tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    };
  } catch (error) {
    return {
      ...config,
      ready: false,
      latencyMs: Math.round(performance.now() - startedAt),
      tools: [],
      error: error instanceof Error ? error.message : "Connection failed."
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function inspectMcpConnections() {
  return Promise.all((await configuredServers()).map(inspectServer));
}
