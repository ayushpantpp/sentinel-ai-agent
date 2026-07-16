import { ChromaClient, type EmbeddingFunction, type Metadata } from "chromadb";
import { createInterface } from "node:readline/promises";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const chromaHost = "localhost";
const chromaPort = 8000;
const chatModel = process.env.OLLAMA_MODEL ?? "phi4-mini:latest";
const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text";
const collectionName = "sentinel-runbooks";

interface OllamaEmbedResponse {
  embeddings: number[][];
}

interface OllamaChatResponse {
  message: { content: string };
}

interface Chunk {
  id: string;
  text: string;
  source: string;
  index: number;
}

class OllamaEmbeddingFunction implements EmbeddingFunction {
  name = "ollama-local";

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

async function loadDocuments(directory: string): Promise<Array<{ source: string; text: string }>> {
  const filenames = (await readdir(directory)).filter((filename) => filename.endsWith(".md"));
  return Promise.all(filenames.map(async (filename) => ({
    source: filename,
    text: await readFile(join(directory, filename), "utf8")
  })));
}

function chunkDocument(document: { source: string; text: string }, chunkSize = 500): Chunk[] {
  const paragraphs = document.text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > chunkSize) {
      chunks.push({ id: `${document.source}-${chunks.length}`, text: current, source: document.source, index: chunks.length });
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }

  if (current) {
    chunks.push({ id: `${document.source}-${chunks.length}`, text: current, source: document.source, index: chunks.length });
  }
  return chunks;
}

async function answerQuestion(question: string): Promise<string> {
  const embeddingFunction = new OllamaEmbeddingFunction();
  const chroma = new ChromaClient({ host: chromaHost, port: chromaPort });
  const collection = await chroma.getOrCreateCollection({
    name: collectionName,
    embeddingFunction,
    metadata: { "hnsw:space": "cosine" }
  });

  const documents = await loadDocuments(join(process.cwd(), "data/runbooks"));
  const chunks = documents.flatMap((document) => chunkDocument(document));
  await collection.upsert({
    ids: chunks.map((chunk) => chunk.id),
    documents: chunks.map((chunk) => chunk.text),
    metadatas: chunks.map((chunk) => ({ source: chunk.source, chunkIndex: chunk.index }))
  });

  const result = await collection.query({
    queryTexts: [question],
    nResults: 3,
    include: ["documents", "metadatas", "distances"]
  });
  const matches = (result.documents[0] ?? []).map((text, index) => ({
    text: text ?? "",
    metadata: (result.metadatas[0]?.[index] ?? {}) as Metadata,
    distance: result.distances[0]?.[index]
  }));
  const context = matches.map((match, index) =>
    `[Source ${index + 1}: ${String(match.metadata.source)}, distance ${match.distance?.toFixed(3)}]\n${match.text}`
  ).join("\n\n");

  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      stream: false,
      messages: [{
        role: "system",
        content: "You are Sentinel AI. Answer only from the supplied runbook context. When the context contains a relevant procedure, state the documented first action directly and cite it as [Source N]. Only say 'Insufficient evidence in the retrieved runbooks.' when no retrieved source contains an applicable action. Do not add prerequisites, thresholds, or actions that are absent from the context."
      }, {
        role: "user",
        content: `Question: ${question}\n\nRunbook context:\n${context}`
      }]
    })
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json() as OllamaChatResponse).message.content;
}

async function main(): Promise<void> {
  const readline = createInterface({ input, output });
  const question = await readline.question("Question: ");
  readline.close();

  if (!question.trim()) {
    console.error("Please enter a question.");
    process.exitCode = 1;
    return;
  }

  try {
    console.log(`\nSentinel AI RAG:\n${await answerQuestion(question)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`RAG pipeline failed: ${message}`);
    process.exitCode = 1;
  }
}

void main();
