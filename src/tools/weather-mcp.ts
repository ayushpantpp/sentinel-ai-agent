import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { requireObject, requireString, type Tool } from "./contracts.js";

const weatherMcpUrl = process.env.WEATHER_MCP_URL ?? "http://127.0.0.1:3002/mcp";

export const getWeatherViaMcp: Tool = {
  definition: {
    name: "getWeatherViaMcp",
    description: "Get current weather for a city through the Weather MCP server.",
    inputSchema: {
      type: "object",
      required: ["city"],
      properties: { city: { type: "string" } }
    }
  },
  async execute(input) {
    const city = requireString(requireObject(input), "city");
    const client = new Client({ name: "airbus-intelligence-hub", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(weatherMcpUrl));
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: "getWeather", arguments: { city } });
      if (result.isError) throw new Error("Weather MCP returned an error.");
      return result.structuredContent ?? result.content;
    } finally {
      await client.close();
    }
  }
};
