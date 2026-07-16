export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface MemoryRecord {
  id: string;
  content: string;
  createdAt: string;
}

export interface SemanticMemoryMatch extends MemoryRecord {
  distance?: number;
}
