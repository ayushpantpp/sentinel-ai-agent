import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { executePlan } from "./executor.js";
import { createPlan } from "./planner.js";
import type { PlanEvent } from "./types.js";

const labels: Record<PlanEvent["stage"], string> = {
  plan: "EXECUTION PLAN",
  "task-start": "TASK START",
  "task-retry": "TASK RETRY",
  "task-complete": "TASK COMPLETE",
  "task-failed": "TASK FAILED",
  recovery: "RECOVERY",
  answer: "ANSWER"
};

async function main(): Promise<void> {
  const readline = createInterface({ input, output });
  const goal = (await readline.question("Goal: ")).trim();
  readline.close();
  if (!goal) throw new Error("Please enter a goal.");

  const plan = await createPlan(goal);
  await executePlan(plan, (event) => {
    console.log(`\n${labels[event.stage]}\n${typeof event.content === "string" ? event.content : JSON.stringify(event.content, null, 2)}`);
  }, { simulateFirstTransientFailure: process.argv.includes("--simulate-transient-failure") });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown planning error");
  process.exitCode = 1;
});
