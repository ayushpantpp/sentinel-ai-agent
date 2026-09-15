import type { ApiCallResult } from "../types/domain.js";
export class ResponseMapper {
  merge(calls: ApiCallResult[]): Record<string, unknown> { const values: Record<string, unknown> = {}; for (const call of calls) { const previous = values[call.apiId]; values[call.apiId] = previous === undefined ? call.data : [...toArray(previous), ...toArray(call.data)]; } return values; }
}
function toArray(value: unknown): unknown[] { return Array.isArray(value) ? value : [value]; }
