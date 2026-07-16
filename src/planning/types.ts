export type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface PlannedTask {
  id: string;
  title: string;
  toolName: string;
  input: Record<string, unknown>;
  successCriteria: string;
  required: boolean;
  maxAttempts: number;
}

export interface ExecutionTask extends PlannedTask {
  status: TaskStatus;
  attempts: number;
  result?: unknown;
  error?: string;
}

export interface ExecutionPlan {
  goal: string;
  tasks: ExecutionTask[];
}

export interface PlanEvent {
  stage: "plan" | "task-start" | "task-retry" | "task-complete" | "task-failed" | "recovery" | "answer";
  content: unknown;
}
