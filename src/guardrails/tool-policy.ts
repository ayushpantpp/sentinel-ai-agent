import type {
  ToolAuthorization,
  ToolAuthorizationRequest
} from "../agent/react-agent.js";

export type AgentRole = "viewer" | "operator";

export interface ToolPolicyOptions {
  role: AgentRole;
  approve: (request: ToolAuthorizationRequest) => Promise<boolean>;
}

const rolePermissions: Record<AgentRole, Set<string>> = {
  viewer: new Set(["searchKnowledge", "searchLogs", "searchRunbook", "searchMemory"]),
  operator: new Set([
    "searchKnowledge",
    "searchLogs",
    "searchRunbook",
    "searchMemory",
    "calculateSeverity",
    "createMockJira",
    "createMockSlackNotification"
  ])
};

const approvalRequired = new Set(["createMockJira", "createMockSlackNotification"]);

/**
 * Applies role permissions, duplicate-call protection, and human approval before
 * the trusted application executes a model-proposed action.
 */
export class ToolPolicy {
  private readonly executedFingerprints = new Set<string>();

  constructor(private readonly options: ToolPolicyOptions) {}

  async authorize(request: ToolAuthorizationRequest): Promise<ToolAuthorization> {
    if (!rolePermissions[this.options.role].has(request.toolName)) {
      return {
        allowed: false,
        reason: `Role '${this.options.role}' cannot execute '${request.toolName}'.`
      };
    }

    const fingerprint = `${request.toolName}:${JSON.stringify(request.input)}`;
    if (this.executedFingerprints.has(fingerprint)) {
      return {
        allowed: false,
        reason: "An identical tool call already executed in this agent run."
      };
    }

    if (approvalRequired.has(request.toolName)) {
      const approved = await this.options.approve(request);
      if (!approved) {
        return {
          allowed: false,
          reason: `Human approval was denied for '${request.toolName}'.`
        };
      }
    }

    this.executedFingerprints.add(fingerprint);
    return {
      allowed: true,
      reason: approvalRequired.has(request.toolName)
        ? "Role permission and human approval granted."
        : "Role permission granted; no human approval required."
    };
  }
}
