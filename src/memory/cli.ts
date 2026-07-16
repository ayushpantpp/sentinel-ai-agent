import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { MemoryManager } from "./memory-manager.js";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const chatModel = process.env.OLLAMA_MODEL ?? "phi4-mini:latest";

interface OllamaChatResponse {
  message: { content: string };
}

async function answer(manager: MemoryManager, question: string): Promise<string> {
  const recalled = await manager.semantic.search(question);
  const workingContext = JSON.stringify(manager.working.snapshot());
  const recalledContext = recalled.length
    ? recalled.map((memory, index) => `[Memory ${index + 1}] ${memory.content}`).join("\n")
    : "No relevant long-term memories found.";

  manager.conversation.add({ role: "user", content: question });
  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      stream: false,
      messages: [{
        role: "system",
        content: `You are Sentinel AI. Use working memory as current incident state and semantic memories as potentially relevant durable facts. Do not invent facts, mention training data, or add generic knowledge-cutoff disclaimers. If memory does not answer the question, say so directly.\nWorking memory: ${workingContext}\nSemantic memories:\n${recalledContext}`
      }, ...manager.conversation.messages()]
    })
  });
  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status} ${await response.text()}`);
  }
  const content = (await response.json() as OllamaChatResponse).message.content;
  manager.conversation.add({ role: "assistant", content });
  return content;
}

function printHelp(): void {
  console.log("Commands:");
  console.log("  /context key=value  Set session-only working memory");
  console.log("  /remember fact      Persist and semantically index a durable fact");
  console.log("  /search query       Inspect semantic memory matches");
  console.log("  /exit               End the session and discard conversation/working memory");
}

async function main(): Promise<void> {
  const manager = new MemoryManager();
  await manager.initialize();
  const readline = createInterface({ input, output });
  printHelp();

  while (true) {
    const text = (await readline.question("\nYou: ")).trim();
    if (text === "/exit") break;
    if (text.startsWith("/context ")) {
      const [key, ...valueParts] = text.slice(9).split("=");
      const value = valueParts.join("=").trim();
      if (!key?.trim() || !value) console.log("Use: /context key=value");
      else {
        manager.working.set(key.trim(), value);
        console.log("Working memory updated.");
      }
      continue;
    }
    if (text.startsWith("/remember ")) {
      const fact = text.slice(10).trim();
      if (!fact) console.log("Use: /remember fact");
      else console.log(`Saved memory ${(await manager.remember(fact)).id}.`);
      continue;
    }
    if (text.startsWith("/search ")) {
      console.log(JSON.stringify(await manager.semantic.search(text.slice(8).trim()), null, 2));
      continue;
    }
    if (text) console.log(`\nSentinel AI:\n${await answer(manager, text)}`);
  }

  readline.close();
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown memory CLI error");
  process.exitCode = 1;
});
