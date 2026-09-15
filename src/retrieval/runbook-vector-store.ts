/**
 * Purpose: Provide semantic retrieval over approved local runbooks.
 * Architecture: Markdown files are chunked, embedded by Ollama, and stored in
 * ChromaDB. Deterministic content hashes prevent unchanged chunks from being
 * embedded again.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ChromaClient, type EmbeddingFunction, type Metadata } from "chromadb";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text";
const collectionName = "airbus-intelligence-hub-runbooks";
const runbookDirectory = join(process.cwd(), "data/runbooks");

interface OllamaEmbedResponse {
  embeddings: number[][];
}

interface RunbookChunk {
  id: string;
  source: string;
  text: string;
  chunkIndex: number;
}

export interface SemanticRunbookMatch {
  source: string;
  content: string;
  score: number;
}

class OllamaEmbeddingFunction implements EmbeddingFunction {
  name = "ollama-local-runbooks";

  async generate(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${ollamaBaseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: embeddingModel, input: texts })
    });
    if (!response.ok) {
      throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json() as OllamaEmbedResponse).embeddings;
  }

  defaultSpace(): "cosine" {
    return "cosine";
  }
}

function chunkText(source: string, text: string, maximumCharacters = 700): RunbookChunk[] {
  const paragraphs = text.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
  const chunks: RunbookChunk[] = [];
  let current = "";

  const push = () => {
    if (!current) return;
    const chunkIndex = chunks.length;
    const digest = createHash("sha256").update(`${embeddingModel}\n${source}\n${current}`).digest("hex").slice(0, 24);
    chunks.push({ id: `${source}:${digest}`, source, text: current, chunkIndex });
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maximumCharacters) push();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  push();
  return chunks;
}

async function localChunks(): Promise<RunbookChunk[]> {
  const filenames = (await readdir(runbookDirectory)).filter((name) => name.endsWith(".md"));
  const documents = await Promise.all(filenames.map(async (source) => ({
    source,
    text: await readFile(join(runbookDirectory, source), "utf8")
  })));
  return documents.flatMap((document) => chunkText(document.source, document.text));
}

async function collection() {
  const client = new ChromaClient({ host: "127.0.0.1", port: 8000 });
  return client.getOrCreateCollection({
    name: collectionName,
    embeddingFunction: new OllamaEmbeddingFunction(),
    metadata: { "hnsw:space": "cosine", embeddingModel }
  });
}

export async function syncRunbookIndex(): Promise<{ total: number; embedded: number }> {
  const chunks = await localChunks();
  const target = await collection();
  const existing = await target.get();
  const existingIds = new Set(existing.ids);
  const localIds = new Set(chunks.map((chunk) => chunk.id));
  const staleIds = existing.ids.filter((id) => !localIds.has(id));
  if (staleIds.length) await target.delete({ ids: staleIds });
  const missing = chunks.filter((chunk) => !existingIds.has(chunk.id));
  if (missing.length) {
    await target.upsert({
      ids: missing.map((chunk) => chunk.id),
      documents: missing.map((chunk) => chunk.text),
      metadatas: missing.map((chunk) => ({ source: chunk.source, chunkIndex: chunk.chunkIndex }))
    });
  }
  return { total: chunks.length, embedded: missing.length };
}

export async function refreshRunbookEmbeddings(source: string): Promise<{ total: number; embedded: number }> {
  const target = await collection();
  await target.delete({ where: { source } });
  return syncRunbookIndex();
}

export async function searchRunbooksSemantically(query: string, limit = 4): Promise<SemanticRunbookMatch[]> {
  await syncRunbookIndex();
  const target = await collection();
  const result = await target.query({
    queryTexts: [query],
    nResults: limit,
    include: ["documents", "metadatas", "distances"]
  });
  return (result.documents[0] ?? []).flatMap((content, index) => {
    if (!content) return [];
    const metadata = (result.metadatas[0]?.[index] ?? {}) as Metadata;
    const distance = result.distances[0]?.[index] ?? 1;
    return [{
      source: String(metadata.source ?? "unknown-runbook"),
      content,
      score: Number((1 - distance).toFixed(4))
    }];
  });
}

export async function runbookIndexHealth(): Promise<{
  ready: boolean;
  totalChunks?: number;
  newlyEmbedded?: number;
  error?: string;
}> {
  try {
    const status = await syncRunbookIndex();
    return { ready: true, totalChunks: status.total, newlyEmbedded: status.embedded };
  } catch (error) {
    return { ready: false, error: error instanceof Error ? error.message : "Unknown indexing error." };
  }
}
