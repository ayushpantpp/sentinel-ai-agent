import { planningTools, synthesizePlan } from "./planner.js";
import type { ExecutionPlan, ExecutionTask, PlanEvent } from "./types.js";

export interface ExecutionOptions {
  simulateFirstTransientFailure?: boolean;
}

/** Separates transient dependency failures from permanent contract failures. */
function isRetryable(error: string): boolean {
  return !/must be|unapproved|unknown tool|invalid json/i.test(error);
}

async function executeTask(task: ExecutionTask, simulateFailure: boolean): Promise<unknown> {
  if (simulateFailure && task.attempts === 1) {
    throw new Error("Simulated temporary dependency timeout.");
  }
  const tool = planningTools.find((candidate) => candidate.definition.name === task.toolName);
  if (!tool) throw new Error(`Unknown tool '${task.toolName}'.`);
  return tool.execute(task.input);
}

/** Runs validated tasks in order and applies bounded retry/recovery policies. */
export async function executePlan(
  plan: ExecutionPlan,
  onEvent: (event: PlanEvent) => void,
  options: ExecutionOptions = {}
): Promise<string> {
  onEvent({ stage: "plan", content: plan });
  let simulated = false;

  for (const task of plan.tasks) {
    task.status = "running";
    onEvent({ stage: "task-start", content: task });

    while (task.attempts < task.maxAttempts) {
      task.attempts += 1;
      try {
        const shouldSimulate = Boolean(options.simulateFirstTransientFailure && !simulated);
        if (shouldSimulate) simulated = true;
        task.result = await executeTask(task, shouldSimulate);
        task.status = "completed";
        delete task.error;
        onEvent({ stage: "task-complete", content: task });
        break;
      } catch (error) {
        task.error = error instanceof Error ? error.message : "Unknown task error";
        const retry = isRetryable(task.error) && task.attempts < task.maxAttempts;
        if (retry) {
          onEvent({ stage: "task-retry", content: { id: task.id, attempt: task.attempts, error: task.error } });
          continue;
        }
        task.status = "failed";
        onEvent({ stage: "task-failed", content: task });
        break;
      }
    }

    if (task.status === "failed" && task.required) {
      for (const remaining of plan.tasks.filter((candidate) => candidate.status === "pending")) {
        remaining.status = "skipped";
      }
      onEvent({
        stage: "recovery",
        content: `Required task '${task.id}' failed. Remaining tasks were skipped and partial evidence will be synthesized.`
      });
      break;
    }
    if (task.status === "failed") {
      onEvent({ stage: "recovery", content: `Optional task '${task.id}' failed. Execution continues.` });
    }
  }

  const answer = await synthesizePlan(plan);
  onEvent({ stage: "answer", content: answer });
  return answer;
}
