import type { Logger } from "pino";
import type { ApiCallResult, ApiDefinition } from "../types/domain.js";
import { AppError } from "../utils/errors.js";
export class ApiExecutor {
  constructor(private readonly baseUrl: string, private readonly logger: Logger) {}
  async execute(definition: ApiDefinition, input: Record<string, string>): Promise<ApiCallResult> {
    let endpoint = definition.endpoint; for (const [key, value] of Object.entries(input)) endpoint = endpoint.replace(`:${key}`, encodeURIComponent(value));
    if (/:[a-z][a-z0-9]*/i.test(endpoint)) {
      throw new AppError(`API ${definition.name} is missing a required path input`, 400);
    }
    const query = new URLSearchParams(Object.entries(input).filter(([key]) => !definition.endpoint.includes(`:${key}`))).toString(); const url = `${this.baseUrl}${endpoint}${query ? `?${query}` : ""}`;
    const started = performance.now(); let lastError: Error | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) try { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5_000); const response = await fetch(url, { method: definition.method, signal: controller.signal }); clearTimeout(timer); const data: unknown = await response.json(); if (!response.ok) throw new AppError(`API ${definition.name} failed with ${response.status}`, response.status); const result = { apiId: definition.id, endpoint, status: response.status, durationMs: Math.round(performance.now() - started), data }; this.logger.info({ apiId: definition.id, attempt }, "API call completed"); return result; } catch (error: unknown) { lastError = error instanceof Error ? error : new Error("Unknown API error"); this.logger.warn({ err: lastError, apiId: definition.id, attempt }, "API call failed"); }
    throw new AppError(lastError?.message ?? "API call failed", 502);
  }
}
