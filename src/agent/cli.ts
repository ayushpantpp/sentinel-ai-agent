import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runReactAgent, type AgentEvent } from "./react-agent.js";

const labels: Record<AgentEvent["stage"], string> = {
  thought: "THOUGHT SUMMARY",
  action: "ACTION",
  observation: "OBSERVATION",
  reflection: "REFLECTION",
  answer: "ANSWER"
};

async function main(): Promise<void> {
  const readline = createInterface({ input, output });
  const question = (await readline.question("Goal: ")).trim();
  readline.close();
  if (!question) {
    console.error("Please enter a goal.");
    process.exitCode = 1;
    return;
  }

  await runReactAgent(question, (event) => {
    const content = typeof event.content === "string"
      ? event.content
      : JSON.stringify(event.content, null, 2);
    console.log(`\n${labels[event.stage]}\n${content}`);
  });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown agent error");
  process.exitCode = 1;
});
