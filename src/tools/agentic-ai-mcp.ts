import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { requireObject, requireString, type Tool } from "./contracts.js";

const defaultMcpUrl = "http://127.0.0.1:3001/mcp";

async function callOrchestrator(question: string): Promise<unknown> {
  const client = new Client({
    name: "first-ai-agent",
    version: "0.1.0"
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.AGENTIC_AI_MCP_URL ?? defaultMcpUrl)
  );

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "orchestrate",
      arguments: { question }
    });

    if (result.isError) {
      const message = result.content
        .filter((item): item is { type: "text"; text: string } => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      throw new Error(message || "Agentic AI MCP tool returned an error.");
    }

    return result.structuredContent ?? result.content;
  } finally {
    await client.close();
  }
}

export const orchestrateAgenticApi: Tool = {
  definition: {
    name: "orchestrateAgenticApi",
    description:
      "Use Agentic AI through its MCP server for fleet, aircraft, customer, delivery, and maintenance questions.",
    inputSchema: {
      type: "object",
      required: ["question"],
      properties: { question: { type: "string" } }
    }
  },
  async execute(input) {
    const question = requireString(requireObject(input), "question");
    return callOrchestrator(question);
  }
};
