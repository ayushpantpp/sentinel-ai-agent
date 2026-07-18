# Module 8: Guardrails and Human Approval

## Why guardrails cannot be only prompts

A prompt saying "do not do anything dangerous" is still interpreted by the
same probabilistic model that proposes actions. Enterprise controls must exist
in trusted application code outside the model.

Sentinel AI now applies guardrails at three boundaries:

```text
User goal -> prompt screening -> model decision -> tool authorization -> execution
```

## Prompt-injection screening

`assessPrompt()` runs before the goal reaches Ollama. It checks deterministic
patterns for instruction override, instruction extraction, approval bypass, and
role escalation.

High-severity findings block the request. Medium findings are reported but may
continue. Pattern matching is intentionally only one layer: attackers can
rephrase instructions, and retrieved documents can contain indirect injection.

## Role-based permissions

The `viewer` role can only search local information. The `operator` role can
also calculate severity and request mock Jira or Slack actions.

```text
viewer   -> read-only tools
operator -> read-only + deterministic calculation + approved mock actions
```

The model cannot grant itself a role. The application chooses the role before
model execution.

## Preventing direct-answer bypass

Permissions only protect tool execution. A model might try to answer directly
instead of requesting the governed capability. The controller therefore
requires deterministic tools for explicit severity calculations, Jira creation,
and Slack notification requests.

For example, a request to calculate severity cannot be answered from model
judgment. It must produce a `calculateSeverity` action, which then passes through
role authorization.

## Human approval

Jira and Slack are still mocks, but they pass through the same approval boundary
that a real external side effect would require. The approval screen shows the
tool name, proposed arguments, iteration, and model rationale.

Approval applies to one exact action. It is not blanket permission for later
calls.

## Duplicate-call protection

The policy fingerprints `toolName + input`. An identical call is denied after
its first successful authorization. This reduces accidental loops and duplicate
side effects.

Production idempotency would also store durable idempotency keys in the target
integration because a process restart clears this in-memory set.

## Loop protection

The controller limits every run to five iterations. Policies can request a
smaller limit but cannot increase it beyond the application maximum.

The loop limit protects local compute and prevents repeated model decisions from
creating unbounded actions.

## Denial as an observation

A denied tool does not crash the process. The agent receives:

```json
{
  "success": false,
  "error": "Guardrail denied tool execution: ..."
}
```

The denial becomes an observation. The agent can answer with the limitation or
choose a permitted alternative.

## Current limitations

- Injection screening uses patterns and cannot detect every semantic attack.
- Retrieved runbooks are not yet scanned for indirect prompt injection.
- Roles are selected locally rather than derived from authenticated identity.
- Approval decisions are not durably audited.
- Duplicate protection is in-memory rather than persistent.
- Jira and Slack remain non-delivering mocks.

These gaps motivate observability, durable workflow state, and production
identity integration.
