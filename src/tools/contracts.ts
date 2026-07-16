export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface Tool<TResult = unknown> {
  definition: ToolDefinition;
  execute(input: unknown): Promise<TResult>;
}

export interface ToolResult<TResult> {
  tool: string;
  success: boolean;
  data: TResult;
}

export function requireObject(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be a JSON object.");
  }
  return input as Record<string, unknown>;
}

export function requireString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Field '${field}' must be a non-empty string.`);
  }
  return value.trim();
}

export function optionalBoolean(input: Record<string, unknown>, field: string): boolean {
  const value = input[field];
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error(`Field '${field}' must be a boolean.`);
  return value;
}

export function optionalNumber(input: Record<string, unknown>, field: string): number {
  const value = input[field];
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Field '${field}' must be a finite number.`);
  }
  return value;
}
