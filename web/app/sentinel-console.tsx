"use client";

import {
  Activity,
  AlertTriangle,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Database,
  FileText,
  Gauge,
  GitBranch,
  Library,
  Plus,
  Pencil,
  Search,
  Send,
  Server,
  Shield,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Resource = {
  id: string;
  title: string;
  content: string;
  kind: "log" | "knowledge";
  source: string;
  createdAt: string;
};

type TraceStep = {
  id: string;
  label: string;
  detail: string;
  status: "complete" | "active" | "waiting";
  meta: string;
  icon: "prompt" | "llm" | "retrieve" | "guard" | "tool" | "reflect" | "answer";
  evidence?: string[];
  llmPrompt?: { model: string; temperature: number; system: string; user: string };
  llmResponse?: { model: string; raw: string; parsed: Record<string, unknown> };
};

type Health = {
  api: { ready: boolean };
  ollama: { ready: boolean; latencyMs: number };
  chroma: { ready: boolean; latencyMs: number };
  agenticAiMcp: { ready: boolean; latencyMs: number };
  runbookIndex: { ready: boolean; totalChunks?: number; newlyEmbedded?: number; error?: string };
};

type AgentEvent = {
  stage: string;
  content: unknown;
  metadata?: { durationMs?: number; source?: string; iteration?: number };
};

const apiBaseUrl = "http://127.0.0.1:8787";

const iconMap = {
  prompt: Bot,
  retrieve: Search,
  guard: ShieldCheck,
  tool: TerminalSquare,
  reflect: GitBranch,
  answer: Sparkles,
  llm: Zap,
};

function eventStep(event: AgentEvent, index: number): TraceStep {
  const action = event.stage === "action" && typeof event.content === "object" && event.content !== null
    ? event.content as { tool?: string; input?: Record<string, unknown> }
    : undefined;
  const isAgenticMcpCall = action?.tool === "orchestrateAgenticApi";
  const labels: Record<string, string> = {
    "prompt-guard": "Prompt guard",
    prompt: "Prompt accepted",
    "llm-call": "LLM call",
    "llm-response": "LLM response",
    thought: "Decision",
    action: "Tool selected",
    guardrail: "Tool guardrail",
    observation: "Tool observation",
    reflection: "Reflection",
    answer: "Grounded answer",
  };
  const icons: Record<string, TraceStep["icon"]> = {
    "prompt-guard": "guard",
    prompt: "prompt",
    "llm-call": "llm",
    "llm-response": "llm",
    thought: "prompt",
    action: "tool",
    guardrail: "guard",
    observation: "retrieve",
    reflection: "reflect",
    answer: "answer",
  };
  const llmPrompt = event.stage === "llm-call" && typeof event.content === "object" && event.content !== null
    ? event.content as TraceStep["llmPrompt"]
    : undefined;
  const llmResponse = event.stage === "llm-response" && typeof event.content === "object" && event.content !== null
    ? event.content as TraceStep["llmResponse"]
    : undefined;
  const detail = isAgenticMcpCall
    ? `Calling the Agentic AI "orchestrate" tool over MCP at ${
      process.env.NEXT_PUBLIC_AGENTIC_AI_MCP_URL ?? "http://127.0.0.1:3001/mcp"
    } with question: ${String(action?.input?.question ?? "")}`
    : llmPrompt
    ? `Sending system and user messages to ${llmPrompt.model} at temperature ${llmPrompt.temperature}.`
    : llmResponse
      ? `${llmResponse.model} returned structured JSON for this iteration.`
    : typeof event.content === "string"
      ? event.content
      : JSON.stringify(event.content, null, 2);
  const duration = event.metadata?.durationMs;
  const observation = event.stage === "observation" && typeof event.content === "object" && event.content !== null
    ? event.content as { data?: unknown }
    : undefined;
  const evidence = Array.isArray(observation?.data)
    ? observation.data.filter((item): item is string => typeof item === "string")
    : undefined;
  return {
    id: String(index + 1).padStart(2, "0"),
    label: isAgenticMcpCall ? "MCP call · Agentic AI" : labels[event.stage] ?? event.stage,
    detail,
    status: "active",
    meta: [
      event.metadata?.iteration ? `iteration ${event.metadata.iteration}` : undefined,
      duration === undefined ? event.metadata?.source ?? "live" : `${Math.round(duration)} ms`,
    ].filter(Boolean).join(" · "),
    icon: icons[event.stage] ?? "prompt",
    evidence,
    llmPrompt,
    llmResponse,
  };
}

export function SentinelConsole() {
  const [activeView, setActiveView] = useState<"trace" | "resources">("trace");
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceFilter, setResourceFilter] = useState<"all" | "log" | "knowledge">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState(
    "Using local logs only, did the payment API p95 latency exceed 2 seconds?",
  );
  const [isRunning, setIsRunning] = useState(false);
  const [traceSteps, setTraceSteps] = useState<TraceStep[]>([]);
  const [selectedStep, setSelectedStep] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [runError, setRunError] = useState("");
  const [isUploadingLogs, setIsUploadingLogs] = useState(false);
  const [role, setRole] = useState<"operator" | "viewer">("operator");
  const [editingResource, setEditingResource] = useState<Resource | null>(null);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/resources`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((saved: Resource[]) => setResources(saved))
      .catch(() => setResources([]));
  }, []);

  useEffect(() => {
    const refresh = () => fetch(`${apiBaseUrl}/api/health`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((value: Health) => setHealth(value))
      .catch(() => setHealth(null));
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredResources = useMemo(
    () =>
      resourceFilter === "all"
        ? resources
        : resources.filter((resource) => resource.kind === resourceFilter),
    [resourceFilter, resources],
  );

  async function refreshResources() {
    const response = await fetch(`${apiBaseUrl}/api/resources`);
    if (!response.ok) throw new Error("Unable to refresh resources.");
    setResources(await response.json() as Resource[]);
  }

  async function uploadLogFile(file: File) {
    setIsUploadingLogs(true);
    setRunError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/log-files`, {
        method: "POST",
        headers: { "content-type": "text/plain", "x-file-name": file.name },
        body: file,
      });
      if (!response.ok) throw new Error(`Log upload failed with ${response.status}.`);
      await refreshResources();
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Log upload failed.");
    } finally {
      setIsUploadingLogs(false);
    }
  }

  async function runAgent() {
    if (!query.trim()) return;
    setIsRunning(true);
    setRunError("");
    setTraceSteps([]);
    setSelectedStep("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: query, role }),
      });
      if (!response.ok || !response.body) throw new Error(`API returned ${response.status}.`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";
        for (const message of messages) {
          let data = "";
          for (const line of message.split("\n")) {
            if (line.startsWith("event: ")) eventName = line.slice(7);
            if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (!data) continue;
          const parsed = JSON.parse(data) as AgentEvent | { message?: string };
          if (eventName === "agent-event") {
            setTraceSteps((current) => {
              const completed = current.map((step) => ({ ...step, status: "complete" as const }));
              const next = [...completed, eventStep(parsed as AgentEvent, current.length)];
              setSelectedStep(next[next.length - 1].id);
              return next;
            });
          } else if (eventName === "error") {
            setRunError((parsed as { message?: string }).message ?? "Agent execution failed.");
          } else if (eventName === "complete") {
            setTraceSteps((current) => current.map((step) => ({ ...step, status: "complete" })));
          }
          eventName = "";
        }
      }
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Unable to reach the local API.");
    } finally {
      setIsRunning(false);
    }
  }

  async function addResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = form.get("kind") as "log" | "knowledge";
    const content = String(form.get("content") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    if (!title || !content) return;
    if (editingResource) {
      try {
        const response = await fetch(`${apiBaseUrl}/api/runbooks`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: editingResource.source, title, content }),
        });
        if (!response.ok) throw new Error("Runbook update failed.");
        const saved = await response.json() as Resource;
        setResources((current) => current.map((resource) =>
          resource.id === editingResource.id ? saved : resource,
        ));
        setEditingResource(null);
        setShowAdd(false);
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Runbook update failed.");
      }
      return;
    }
    const optimistic: Resource = {
      id: `${kind}-${Date.now()}`,
      title,
      content,
      kind,
      source: kind === "log" ? "manual-entry.log" : "manual-runbook.md",
      createdAt: "just now",
    };
    setResources((current) => [optimistic, ...current]);
    setShowAdd(false);
    try {
      const response = await fetch(`${apiBaseUrl}/api/resources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, title, content }),
      });
      if (!response.ok) throw new Error("Save failed");
      const saved = await response.json() as Omit<Resource, "createdAt"> & { createdAt: number };
      setResources((current) => current.map((resource) =>
        resource.id === optimistic.id
          ? { ...saved, createdAt: new Date(saved.createdAt).toLocaleString() }
          : resource,
      ));
    } catch {
      // The optimistic entry remains visible; persistence resumes when the local binding reconnects.
    }
  }

  const selected = traceSteps.find((step) => step.id === selectedStep) ?? traceSteps[0];
  const answerStep = [...traceSteps].reverse().find((step) => step.label === "Grounded answer");
  const relevantLogs = traceSteps.flatMap((step) => step.evidence ?? [])
    .filter((line) => /\b(?:WARN|ERROR|INFO|DEBUG)\b|service=/i.test(line));
  const allReady = Boolean(health?.api.ready && health.ollama.ready && health.chroma.ready);

  return (
    <main className="console-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Activity size={19} /></div>
          <div><strong>Sentinel</strong><span>AI operations</span></div>
        </div>

        <nav className="primary-nav" aria-label="Main navigation">
          <button className={activeView === "trace" ? "active" : ""} onClick={() => setActiveView("trace")}>
            <GitBranch size={17} /><span>Decision trace</span><kbd>⌘1</kbd>
          </button>
          <button className={activeView === "resources" ? "active" : ""} onClick={() => setActiveView("resources")}>
            <Library size={17} /><span>Knowledge & logs</span><kbd>⌘2</kbd>
          </button>
        </nav>

        <div className="sidebar-section">
          <span className="eyebrow">Engine</span>
          <div className="engine-card">
            <div className="engine-row"><Server size={15} /><span>Ollama</span><i className={`status-dot ${health?.ollama.ready ? "" : "offline"}`} /></div>
            <strong>{health?.ollama.ready ? "Connected" : "Unavailable"}</strong>
            <small>{health?.ollama.ready ? `Local · ${health.ollama.latencyMs} ms` : "Start Ollama locally"}</small>
          </div>
          <div className="engine-card">
            <div className="engine-row"><Database size={15} /><span>ChromaDB</span><i className={`status-dot ${health?.chroma.ready ? "" : "offline"}`} /></div>
            <strong>{health?.runbookIndex?.ready ? `${health.runbookIndex.totalChunks ?? 0} indexed chunks` : "Index unavailable"}</strong>
            <small>{health?.runbookIndex?.ready ? "semantic runbooks" : "keyword fallback active"}</small>
          </div>
          <div className="engine-card">
            <div className="engine-row"><Server size={15} /><span>Agentic AI · MCP</span><i className={`status-dot ${health?.agenticAiMcp?.ready ? "" : "offline"}`} /></div>
            <strong>{health?.agenticAiMcp?.ready ? "Connected" : "Unavailable"}</strong>
            <small>{health?.agenticAiMcp?.ready ? `Streamable HTTP · ${health.agenticAiMcp.latencyMs} ms` : "Start Agentic AI on port 3001"}</small>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="avatar">AP</div>
          <div><strong>Operator</strong><span>Local workspace</span></div>
          <Gauge size={16} />
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="breadcrumb"><span>Sentinel AI</span><ChevronRight size={13} /><strong>{activeView === "trace" ? "Decision trace" : "Knowledge & logs"}</strong></div>
            <p>{activeView === "trace" ? "Inspect how the agent reached its answer." : "Manage the evidence available to your local agent."}</p>
          </div>
          <div className={`health-pill ${allReady ? "" : "offline"}`}><span className={`pulse ${allReady ? "" : "offline"}`} />{allReady ? "All systems local" : "Local service unavailable"}</div>
        </header>

        {activeView === "trace" ? (
          <div className="trace-layout">
            <section className="main-stage">
              <div className="prompt-card">
                <div className="prompt-header"><Bot size={18} /><span>Ask Sentinel</span><label className="role-control">Role<select aria-label="Agent role" value={role} onChange={(event) => setRole(event.target.value as "operator" | "viewer")}><option value="operator">Operator</option><option value="viewer">Viewer</option></select></label></div>
                <textarea value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Question for Sentinel" />
                <div className="prompt-actions">
                  <div><span className="source-chip"><Database size={13} />Runbooks</span><span className="source-chip"><TerminalSquare size={13} />Local logs</span></div>
                  <button onClick={runAgent} disabled={isRunning}>{isRunning ? <><CircleDot className="spin" size={15} />Tracing</> : <><Send size={15} />Run agent</>}</button>
                </div>
                {runError && <div className="run-error"><AlertTriangle size={14} />{runError}</div>}
              </div>

              <div className="section-heading">
                <div><span className="eyebrow">Live execution</span><h2>Decision flow</h2></div>
                <div className="trace-id">TRACE <strong>E958D7B0</strong></div>
              </div>

              <div className={`flow ${isRunning ? "running" : ""}`}>
                {!traceSteps.length && <div className="empty-flow"><CircleDot className={isRunning ? "spin" : ""} size={18} />{isRunning ? "Waiting for the first backend event…" : "Run the agent to create a live trace."}</div>}
                {traceSteps.map((step, index) => {
                  const Icon = iconMap[step.icon];
                  return (
                    <button key={step.id} className={`flow-step ${selectedStep === step.id ? "selected" : ""} ${step.status === "active" ? "active" : ""}`} onClick={() => setSelectedStep(step.id)}>
                      <div className="flow-rail">
                        <div className="step-icon"><Icon size={17} /></div>
                        {index < traceSteps.length - 1 && <div className="connector" />}
                      </div>
                      <div className="step-content">
                        <div className="step-top"><span>{step.id} · {step.label}</span><em>{step.meta}</em></div>
                        <p>{step.detail}</p>
                      </div>
                      <ChevronRight size={16} className="step-chevron" />
                    </button>
                  );
                })}
              </div>
            </section>

            {selected && <aside className="inspector">
              <div className="inspector-header"><div><span className="eyebrow">Step {selected.id}</span><h3>{selected.label}</h3></div><span className={`success-badge ${selected.status === "active" ? "working" : ""}`}>{selected.status === "active" ? <CircleDot size={12} /> : <Check size={12} />}{selected.status === "active" ? "Working" : "Complete"}</span></div>
              <div className="inspector-block answer-block">
                <span className="block-label">Answer</span>
                <p>{answerStep?.detail ?? (isRunning ? "The backend is still working…" : "No final answer was produced.")}</p>
              </div>
              {selected.llmPrompt && <div className="inspector-block prompt-inspector">
                <span className="block-label">Prompt sent to Ollama</span>
                <div className="prompt-meta"><span>{selected.llmPrompt.model}</span><span>temperature {selected.llmPrompt.temperature}</span></div>
                <strong>System message</strong>
                <pre>{selected.llmPrompt.system}</pre>
                <strong>User message</strong>
                <pre>{selected.llmPrompt.user}</pre>
              </div>}
              {selected.llmResponse && <div className="inspector-block prompt-inspector">
                <span className="block-label">LLM response</span>
                <div className="prompt-meta"><span>{selected.llmResponse.model}</span><span>iteration response</span></div>
                <strong>Raw Ollama output</strong>
                <pre>{selected.llmResponse.raw}</pre>
                <strong>Parsed JSON</strong>
                <pre>{JSON.stringify(selected.llmResponse.parsed, null, 2)}</pre>
              </div>}
              <div className="inspector-block">
                <span className="block-label">Evidence used</span>
                {relevantLogs.length ? relevantLogs.map((line, index) => (
                  <div className="evidence log-evidence" key={`${line}-${index}`}><TerminalSquare size={15} /><span><strong>operations.log</strong><small>{line}</small></span></div>
                )) : <div className="no-evidence">No relevant log evidence retrieved yet.</div>}
              </div>
              <div className="inspector-block">
                <span className="block-label">Safety</span>
                <div className="safety-row"><ShieldCheck size={16} /><span><strong>Read-only action</strong><small>No approval required</small></span></div>
                <div className="safety-row"><Shield size={16} /><span><strong>Prompt passed</strong><small>No injection detected</small></span></div>
              </div>
            </aside>}
          </div>
        ) : (
          <section className="resources-view">
            <div className="resources-hero">
              <div><span className="eyebrow">Agent memory</span><h1>Knowledge & logs</h1><p>Control the evidence Sentinel can retrieve. New entries become available to future traces.</p></div>
              <div className="hero-actions">
                <label className={`upload-button ${isUploadingLogs ? "disabled" : ""}`}><Upload size={16} />{isUploadingLogs ? "Uploading…" : "Upload log file"}<input type="file" accept=".log,.txt,.jsonl,text/plain,application/x-ndjson" disabled={isUploadingLogs} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadLogFile(file); event.target.value = ""; }} /></label>
                <button className="primary-button" onClick={() => setShowAdd(true)}><Plus size={16} />Add source</button>
              </div>
            </div>
            <div className="resource-stats">
              <div><BookOpen size={18} /><span><strong>{resources.filter((r) => r.kind === "knowledge").length}</strong>runbook documents</span></div>
              <div><TerminalSquare size={18} /><span><strong>{resources.filter((r) => r.kind === "log").length}</strong>log events</span></div>
              <div><Zap size={18} /><span><strong>0.84</strong>best retrieval score</span></div>
            </div>
            <div className="resource-toolbar">
              <div className="filters">
                {(["all", "knowledge", "log"] as const).map((filter) => <button key={filter} className={resourceFilter === filter ? "active" : ""} onClick={() => setResourceFilter(filter)}>{filter === "all" ? "All sources" : filter === "knowledge" ? "Runbooks" : "Logs"}</button>)}
              </div>
              <div className="search-box"><Search size={15} /><input placeholder="Search sources…" /></div>
            </div>
            <div className="resource-list">
              {filteredResources.map((resource) => (
                <article key={resource.id} className="resource-card">
                  <div className={`resource-icon ${resource.kind}`} >{resource.kind === "log" ? <TerminalSquare size={18} /> : <FileText size={18} />}</div>
                  <div className="resource-copy"><div><strong>{resource.title}</strong><span>{resource.source} · {resource.createdAt}</span></div><p>{resource.content}</p></div>
                  <div className="resource-actions">
                    {resource.kind === "knowledge" && <button aria-label={`Edit ${resource.title}`} onClick={() => { setEditingResource(resource); setShowAdd(true); }}><Pencil size={14} /></button>}
                    <span className={`kind-badge ${resource.kind}`}>{resource.kind === "log" ? "LOG" : "KB"}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>

      {showAdd && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal" onSubmit={addResource} key={editingResource?.id ?? "new-resource"}>
            <div className="modal-header"><div><span className="eyebrow">{editingResource ? "Update knowledge" : "New evidence"}</span><h2>{editingResource ? "Edit runbook" : "Add a source"}</h2></div><button type="button" aria-label="Close" onClick={() => { setShowAdd(false); setEditingResource(null); }}><X size={18} /></button></div>
            <label>Source type<select name="kind" defaultValue={editingResource?.kind ?? "knowledge"} disabled={Boolean(editingResource)}><option value="knowledge">Runbook knowledge</option><option value="log">Log event</option></select></label>
            <label>Title<input name="title" required defaultValue={editingResource?.title ?? ""} placeholder="e.g. Redis connection failures" /></label>
            <label>Content<textarea name="content" required defaultValue={editingResource?.content ?? ""} placeholder="Paste a runbook instruction or structured log event…" /></label>
            <div className="notice"><AlertTriangle size={15} /><span>Review operational data before adding it to the agent’s retrieval index.</span></div>
            <div className="modal-actions"><button type="button" onClick={() => { setShowAdd(false); setEditingResource(null); }}>Cancel</button><button type="submit" className="primary-button">{editingResource ? <Pencil size={15} /> : <Plus size={15} />}{editingResource ? "Update and re-index" : "Add source"}</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
