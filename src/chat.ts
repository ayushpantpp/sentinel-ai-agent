import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const model = process.env.OLLAMA_MODEL ?? "phi4-mini:latest";

interface OllamaChatResponse {
  message: {
    content: string;
  };
}

async function chat(prompt: string): Promise<string> {
  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as OllamaChatResponse;
  return payload.message.content;
}

async function main(): Promise<void> {
  const readline = createInterface({ input, output });
  const prompt = await readline.question("You: ");
  readline.close();

  if (!prompt.trim()) {
    console.error("Please enter a message.");
    process.exitCode = 1;
    return;
  }

  try {
    console.log(`\nSentinel AI (${model}):\n${await chat(prompt)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Unable to reach local Ollama: ${message}`);
    process.exitCode = 1;
  }
}

void main();
