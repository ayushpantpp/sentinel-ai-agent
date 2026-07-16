import { tools } from "./operations.js";

function printUsage(): void {
  console.log("Usage: npm run tool -- <tool-name> '<json-input>'");
  console.log("Available tools:");
  for (const tool of tools) {
    console.log(`- ${tool.definition.name}: ${tool.definition.description}`);
  }
}

async function main(): Promise<void> {
  const [toolName, rawInput] = process.argv.slice(2);
  if (!toolName || toolName === "list") {
    printUsage();
    return;
  }

  const tool = tools.find((candidate) => candidate.definition.name === toolName);
  if (!tool) {
    console.error(`Unknown tool: ${toolName}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    const input = JSON.parse(rawInput ?? "{}") as unknown;
    const data = await tool.execute(input);
    console.log(JSON.stringify({ tool: toolName, success: true, data }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(JSON.stringify({ tool: toolName, success: false, error: message }, null, 2));
    process.exitCode = 1;
  }
}

void main();
