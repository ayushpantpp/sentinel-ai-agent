import type { ILLMProvider } from "./ILLMProvider.js";
export class OllamaProvider implements ILLMProvider {
  constructor(private readonly baseUrl: string, private readonly model: string) {}
  async generate(prompt: string): Promise<string> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
    try { const response = await fetch(`${this.baseUrl}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: this.model, prompt, stream: false, options: { temperature: 0.1 } }), signal: controller.signal });
      if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
      const body: unknown = await response.json(); if (!isResponse(body)) throw new Error("Invalid Ollama response"); return body.response;
    } finally { clearTimeout(timer); }
  }
}
function isResponse(value: unknown): value is { response: string } { return typeof value === "object" && value !== null && "response" in value && typeof (value as { response: unknown }).response === "string"; }
