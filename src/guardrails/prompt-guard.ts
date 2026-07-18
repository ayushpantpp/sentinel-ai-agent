export type InjectionSeverity = "medium" | "high";

export interface InjectionFinding {
  severity: InjectionSeverity;
  pattern: string;
  explanation: string;
}

export interface PromptAssessment {
  allowed: boolean;
  findings: InjectionFinding[];
}

const injectionRules: Array<{
  pattern: RegExp;
  label: string;
  severity: InjectionSeverity;
  explanation: string;
}> = [
  {
    pattern: /\b(ignore|disregard|override)\b.{0,40}\b(previous|system|developer|safety)\b/i,
    label: "instruction-override",
    severity: "high",
    explanation: "Attempts to replace higher-priority application instructions."
  },
  {
    pattern: /\b(reveal|show|print|repeat)\b.{0,40}\b(system prompt|developer message|hidden instructions|secrets?)\b/i,
    label: "instruction-exfiltration",
    severity: "high",
    explanation: "Attempts to extract protected instructions or secret material."
  },
  {
    pattern: /\b(without|bypass|skip)\b.{0,30}\b(approval|permission|confirmation|guardrail)\b/i,
    label: "approval-bypass",
    severity: "high",
    explanation: "Attempts to bypass an application authorization boundary."
  },
  {
    pattern: /\bpretend\b.{0,30}\b(admin|root|authorized|approved)\b/i,
    label: "role-escalation",
    severity: "medium",
    explanation: "Attempts to obtain capabilities through role-played authority."
  }
];

/**
 * Performs deterministic preflight screening before untrusted text reaches the
 * model. This is one defensive layer, not a complete prompt-injection solution.
 */
export function assessPrompt(prompt: string): PromptAssessment {
  const findings = injectionRules
    .filter((rule) => rule.pattern.test(prompt))
    .map((rule) => ({
      severity: rule.severity,
      pattern: rule.label,
      explanation: rule.explanation
    }));
  return {
    allowed: !findings.some((finding) => finding.severity === "high"),
    findings
  };
}
