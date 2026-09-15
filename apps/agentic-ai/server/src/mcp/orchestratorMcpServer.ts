import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { z } from "zod";
import type { Request, Response } from "express";
import type { OrchestratorService } from "../services/OrchestratorService.js";

/**
 * Exposes the existing orchestration service through MCP without changing the
 * REST controller or its request/response contract.
 */
export function createOrchestratorMcpHandler(service: OrchestratorService) {
  const server = new McpServer({
    name: "agentic-ai-orchestrator",
    version: "0.1.0"
  });

  server.registerTool(
    "orchestrate",
    {
      title: "Orchestrate an operations question",
      description:
        "Run Agentic AI's existing orchestration API for fleet, customer, delivery, or maintenance questions.",
      inputSchema: z.object({
        question: z.string().trim().min(3).max(1000).optional(),
        tailNumbers: z.array(z.string().trim().min(3).max(20)).min(1).max(50).optional()
      }).refine((value) => Boolean(value.question || value.tailNumbers?.length), {
        message: "Provide a question or at least one tail number."
      })
    },
    async ({ question, tailNumbers }) => {
      const result = tailNumbers?.length
        ? await service.lookupAircraftByTailNumbers(tailNumbers)
        : await service.run(question as string);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result
      };
    }
  );

  return async (request: Request, response: Response): Promise<void> => {
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  };
}
