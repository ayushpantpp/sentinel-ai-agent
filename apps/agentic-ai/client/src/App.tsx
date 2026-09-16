import { useState } from "react";
import type { Result } from "./types";

const examples = ["Show all aircraft owned by Lufthansa.", "Which aircraft are under maintenance?", "Show deliveries for customer Airbus.", "Give me a fleet summary."];

export function App() {
  const [question, setQuestion] = useState(examples[0]);
  const [history, setHistory] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || loading) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/orchestrate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
      const body: unknown = await response.json();
      if (!response.ok || !isResult(body)) throw new Error(errorFrom(body));
      setHistory((items) => [body, ...items]);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Unable to run orchestration");
    } finally { setLoading(false); }
  }

  return <main>
    <header><div><p className="eyebrow">AI OPERATIONS PLATFORM</p><h1>API Orchestrator</h1><p>Natural language → execution plan → connected APIs → grounded answer</p></div><span className="status">● Local Ollama required</span></header>
    <section className="composer"><form onSubmit={submit}><label htmlFor="question">Ask an operations question</label><div className="input-row"><input id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about fleet, maintenance, or deliveries…" /><button disabled={loading}>{loading ? "Orchestrating…" : "Run request"}</button></div></form><div className="examples">{examples.map((example) => <button key={example} onClick={() => setQuestion(example)}>{example}</button>)}</div>{error && <p className="error">{error}</p>}</section>
    {history.length === 0 ? <section className="empty"><div>✦</div><h2>Ready to orchestrate</h2><p>Every request shows the reasoning trail, local Ollama prompts and responses, services used, and raw source data.</p></section> : history.map((result, index) => <ResultCard key={`${result.question}-${index}`} result={result} />)}
  </main>;
}

function ResultCard({ result }: { result: Result }) {
  return <article className="result">
    <div className="question"><span>REQUEST</span><h2>{result.question}</h2><small>{result.durationMs} ms total · {result.llmInteractions.length} Ollama call(s)</small></div>
    <section className="answer"><p className="eyebrow">FINAL RESPONSE</p><p>{result.answer}</p></section>
    <div className="grid"><section className="panel"><h3>Execution plan</h3><p className="muted">{result.plan.rationale}</p><div className="workflow">{result.plan.steps.map((step, index) => <div className="node" key={`${step.apiId}-${index}`}><b>{step.apiId}</b><small>{Object.keys(step.input).length ? JSON.stringify(step.input) : step.dependsOn.length ? `after ${step.dependsOn.join(", ")}` : "no input"}</small>{index < result.plan.steps.length - 1 && <i>↓</i>}</div>)}</div></section><section className="panel"><h3>APIs called</h3>{result.apiCalls.map((call, index) => <div className="call" key={`${call.apiId}-${index}`}><span className="method">GET</span><div><b>{call.apiId}</b><small>{call.endpoint}</small></div><time>{call.durationMs} ms</time></div>)}</section></div>
    <details className="ollama-trace"><summary>Ollama interactions ({result.llmInteractions.length})</summary>{result.llmInteractions.map((interaction) => <section className="trace" key={interaction.stage}><div><b>{interaction.stage === "intent_analysis" ? "1. Intent analysis" : "2. Final answer"}</b><time>{interaction.durationMs} ms</time></div><p>Prompt sent to local Ollama</p><pre>{interaction.prompt}</pre><p>Raw response from Ollama</p><pre>{interaction.response}</pre></section>)}</details>
    <details><summary>Raw API responses & merged data</summary><pre>{JSON.stringify(result.mergedResponse, null, 2)}</pre></details>
  </article>;
}

function isResult(value: unknown): value is Result { return typeof value === "object" && value !== null && "answer" in value && typeof (value as { answer: unknown }).answer === "string" && "llmInteractions" in value; }
function errorFrom(value: unknown): string { return typeof value === "object" && value !== null && "error" in value && typeof (value as { error: unknown }).error === "string" ? (value as { error: string }).error : "Request failed"; }
