import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { searchRunbooksSemantically } from "../retrieval/runbook-vector-store.js";
import {
  optionalBoolean,
  optionalNumber,
  requireObject,
  requireString,
  type Tool
} from "./contracts.js";
import { orchestrateAgenticApi } from "./agentic-ai-mcp.js";

const runbookDirectory = join(process.cwd(), "data/runbooks");
const logFile = join(process.cwd(), "data/logs/operations.log");
const memoryFile = join(process.cwd(), "data/memory/memories.jsonl");

interface SearchMatch {
  source: string;
  content: string;
  score: number;
}

interface MemoryRecord {
  id: string;
  content: string;
  createdAt: string;
}

const stopWords = new Set(["a", "an", "and", "for", "in", "is", "of", "on", "or", "the", "to", "using", "with"]);

function terms(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((term) => !stopWords.has(term));
}

function relevance(query: string, content: string): number {
  const normalized = content.toLowerCase();
  return terms(query).reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

async function searchMarkdown(query: string, filename?: string): Promise<SearchMatch[]> {
  const filenames = (await readdir(runbookDirectory))
    .filter((candidate) => candidate.endsWith(".md"))
    .filter((candidate) => !filename || candidate === filename);
  const matches = await Promise.all(filenames.map(async (source) => {
    const content = await readFile(join(runbookDirectory, source), "utf8");
    return { source, content, score: relevance(query, content) };
  }));
  return matches.filter((match) => match.score > 0).sort((left, right) => right.score - left.score);
}

export const searchKnowledge: Tool<SearchMatch[]> = {
  definition: {
    name: "searchKnowledge",
    description: "Search approved local operational knowledge for relevant text.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } }
  },
  async execute(input) {
    const query = requireString(requireObject(input), "query");
    try {
      return await searchRunbooksSemantically(query);
    } catch {
      return searchMarkdown(query);
    }
  }
};

export const searchRunbook: Tool<SearchMatch[]> = {
  definition: {
    name: "searchRunbook",
    description: "Search runbooks, optionally restricting the search to one filename.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" }, filename: { type: "string" } }
    }
  },
  async execute(input) {
    const fields = requireObject(input);
    const query = requireString(fields, "query");
    const filename = fields.filename === undefined ? undefined : requireString(fields, "filename");
    if (!filename) {
      try {
        return await searchRunbooksSemantically(query);
      } catch {
        return searchMarkdown(query);
      }
    }
    return searchMarkdown(query, filename);
  }
};

export const searchLogs: Tool<string[]> = {
  definition: {
    name: "searchLogs",
    description: "Search local operations logs for matching service names, errors, or incident terms.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } }
  },
  async execute(input) {
    const query = requireString(requireObject(input), "query");
    const ranked: Array<{ line: string; score: number }> = [];
    const lines = createInterface({
      input: createReadStream(logFile, { encoding: "utf8" }),
      crlfDelay: Infinity
    });
    for await (const line of lines) {
      if (!line) continue;
      const score = relevance(query, line);
      if (score > 0) ranked.push({ line, score });
    }
    ranked.sort((left, right) => right.score - left.score);
    const highestScore = ranked[0]?.score ?? 0;
    const minimumScore = Math.max(2, highestScore - 1);
    return ranked.filter((match) => match.score >= minimumScore).map((match) => match.line);
  }
};

export const remember: Tool<MemoryRecord> = {
  definition: {
    name: "remember",
    description: "Persist an explicitly supplied operational fact in local long-term memory.",
    inputSchema: { type: "object", required: ["content"], properties: { content: { type: "string" } } }
  },
  async execute(input) {
    const content = requireString(requireObject(input), "content");
    const record = { id: crypto.randomUUID(), content, createdAt: new Date().toISOString() };
    await mkdir(join(process.cwd(), "data/memory"), { recursive: true });
    await appendFile(memoryFile, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }
};

export const searchMemory: Tool<MemoryRecord[]> = {
  definition: {
    name: "searchMemory",
    description: "Search facts previously saved in local long-term memory.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } }
  },
  async execute(input) {
    const query = requireString(requireObject(input), "query");
    let content: string;
    try {
      content = await readFile(memoryFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return content.split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as MemoryRecord)
      .filter((record) => relevance(query, record.content) > 0);
  }
};

export const calculateSeverity: Tool<{ severity: "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4"; reason: string }> = {
  definition: {
    name: "calculateSeverity",
    description: "Calculate incident severity using deterministic enterprise rules.",
    inputSchema: {
      type: "object",
      properties: {
        securityIncident: { type: "boolean" }, dataLoss: { type: "boolean" },
        customerImpact: { type: "boolean" }, serviceUnavailable: { type: "boolean" },
        errorRatePercent: { type: "number" }
      }
    }
  },
  async execute(input) {
    const fields = requireObject(input);
    const securityIncident = optionalBoolean(fields, "securityIncident");
    const dataLoss = optionalBoolean(fields, "dataLoss");
    const customerImpact = optionalBoolean(fields, "customerImpact");
    const serviceUnavailable = optionalBoolean(fields, "serviceUnavailable");
    const errorRatePercent = optionalNumber(fields, "errorRatePercent");
    if (securityIncident || dataLoss) return { severity: "SEV-1", reason: "Security incident or data loss reported." };
    if (customerImpact && (serviceUnavailable || errorRatePercent >= 20)) return { severity: "SEV-2", reason: "Material customer impact detected." };
    if (customerImpact || errorRatePercent >= 5) return { severity: "SEV-3", reason: "Limited customer impact or elevated error rate." };
    return { severity: "SEV-4", reason: "No material customer impact detected." };
  }
};

export const createMockJira: Tool<Record<string, unknown>> = {
  definition: {
    name: "createMockJira",
    description: "Build a mock Jira issue response without contacting Jira.",
    inputSchema: { type: "object", required: ["summary", "description"], properties: { summary: { type: "string" }, description: { type: "string" } } }
  },
  async execute(input) {
    const fields = requireObject(input);
    return { mock: true, key: `SENT-${Math.floor(Date.now() / 1000)}`, summary: requireString(fields, "summary"), description: requireString(fields, "description"), status: "TO DO" };
  }
};

export const createMockSlackNotification: Tool<Record<string, unknown>> = {
  definition: {
    name: "createMockSlackNotification",
    description: "Build a mock Slack notification response without sending a message.",
    inputSchema: { type: "object", required: ["channel", "message"], properties: { channel: { type: "string" }, message: { type: "string" } } }
  },
  async execute(input) {
    const fields = requireObject(input);
    return { mock: true, delivered: false, channel: requireString(fields, "channel"), message: requireString(fields, "message"), reason: "Module 4 has no external side effects." };
  }
};

export const tools: Tool[] = [
  orchestrateAgenticApi,
  searchKnowledge,
  searchLogs,
  searchRunbook,
  remember,
  searchMemory,
  calculateSeverity,
  createMockJira,
  createMockSlackNotification
];
