import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { requireObject, requireString, type Tool } from "./contracts.js";

const defaultMcpUrl = "http://127.0.0.1:3001/mcp";

async function callOrchestrator(question: string, tailNumbers?: string[]): Promise<unknown> {
  const client = new Client({
    name: "first-ai-agent",
    version: "0.1.0"
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.AIRBUS_APIS_MCP_URL ?? process.env.AGENTIC_AI_MCP_URL ?? defaultMcpUrl)
  );

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "orchestrate",
      arguments: { question, ...(tailNumbers?.length ? { tailNumbers } : {}) }
    });

    if (result.isError) {
      const message = result.content
        .filter((item): item is { type: "text"; text: string } => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      throw new Error(message || "Airbus APIs MCP tool returned an error.");
    }

    return result.structuredContent ?? result.content;
  } finally {
    await client.close();
  }
}

export const orchestrateAirbusApis: Tool = {
  definition: {
    name: "orchestrateAirbusApis",
    description:
      "Use Airbus APIs through MCP to search customer, fleet, maintenance, production-order, delivery, aircraft-update, and pilot-training microservices.",
    inputSchema: {
      type: "object",
      required: ["question"],
      properties: {
        question: { type: "string" },
        tailNumbers: { type: "array", items: { type: "string" } }
      }
    }
  },
  async execute(input) {
    const question = requireString(requireObject(input), "question");
    const value = requireObject(input).tailNumbers;
    const tailNumbers = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : undefined;
    return callOrchestrator(question, tailNumbers);
  }
};
