import { ChromaClient, type EmbeddingFunction } from "chromadb";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatMessage, MemoryRecord, SemanticMemoryMatch } from "./types.js";

const memoryDirectory = join(process.cwd(), "data/memory");
const memoryFile = join(memoryDirectory, "memories.jsonl");
const ollamaBaseUrl = "http://127.0.0.1:11434";
const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text";

interface OllamaEmbedResponse {
  embeddings: number[][];
}

class OllamaMemoryEmbedding implements EmbeddingFunction {
  name = "ollama-memory-local";

  async generate(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${ollamaBaseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: embeddingModel, input: texts })
    });
    if (!response.ok) {
      throw new Error(`Memory embedding failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json() as OllamaEmbedResponse).embeddings;
  }

  defaultSpace(): "cosine" {
    return "cosine";
  }
}

export class ConversationMemory {
  private readonly history: ChatMessage[] = [];

  constructor(private readonly maximumMessages = 10) {}

  add(message: ChatMessage): void {
    this.history.push(message);
    if (this.history.length > this.maximumMessages) {
      this.history.splice(0, this.history.length - this.maximumMessages);
    }
  }

  messages(): ChatMessage[] {
    return [...this.history];
  }
}

export class WorkingMemory {
  private readonly context = new Map<string, string>();

  set(key: string, value: string): void {
    this.context.set(key, value);
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.context);
  }
}

export class LongTermMemory {
  async remember(content: string): Promise<MemoryRecord> {
    const record = { id: crypto.randomUUID(), content, createdAt: new Date().toISOString() };
    await mkdir(memoryDirectory, { recursive: true });
    await appendFile(memoryFile, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  async list(): Promise<MemoryRecord[]> {
    try {
      const content = await readFile(memoryFile, "utf8");
      return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as MemoryRecord);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}

export class SemanticMemory {
  private readonly client = new ChromaClient({ host: "localhost", port: 8000 });
  private readonly embeddingFunction = new OllamaMemoryEmbedding();

  async synchronize(records: MemoryRecord[]): Promise<void> {
    if (records.length === 0) return;
    const collection = await this.collection();
    await collection.upsert({
      ids: records.map((record) => record.id),
      documents: records.map((record) => record.content),
      metadatas: records.map((record) => ({ createdAt: record.createdAt }))
    });
  }

  async search(query: string, limit = 3): Promise<SemanticMemoryMatch[]> {
    const collection = await this.collection();
    if (await collection.count() === 0) return [];
    const result = await collection.query({
      queryTexts: [query],
      nResults: limit,
      include: ["documents", "metadatas", "distances"]
    });
    return (result.documents[0] ?? []).map((content, index) => ({
      id: result.ids[0]?.[index] ?? "unknown",
      content: content ?? "",
      createdAt: String(result.metadatas[0]?.[index]?.createdAt ?? "unknown"),
      distance: result.distances[0]?.[index] ?? undefined
    }));
  }

  private async collection() {
    return this.client.getOrCreateCollection({
      name: "sentinel-semantic-memory",
      embeddingFunction: this.embeddingFunction,
      metadata: { "hnsw:space": "cosine" }
    });
  }
}

export class MemoryManager {
  readonly conversation = new ConversationMemory();
  readonly working = new WorkingMemory();
  readonly longTerm = new LongTermMemory();
  readonly semantic = new SemanticMemory();

  async initialize(): Promise<void> {
    await this.semantic.synchronize(await this.longTerm.list());
  }

  async remember(content: string): Promise<MemoryRecord> {
    const record = await this.longTerm.remember(content);
    await this.semantic.synchronize([record]);
    return record;
  }
}
