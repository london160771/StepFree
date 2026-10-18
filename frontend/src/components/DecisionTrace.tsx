import type { AgentRuntimeInfo, TraceEntry } from '../api';
import { CheckGlyph } from './icons';

/** What chose the tools, said plainly. The Demo policy is a StepFree policy, never presented as a language model. */
function agentDisclosure(agent: AgentRuntimeInfo | null | undefined): { title: string; detail: string | null } | null {
  if (!agent) return null;
  if (agent.kind === 'deterministic') return { title: 'Demo agent · deterministic tool policy', detail: 'Runs the same MCP tools and FalkorDB graph without using Gemini.' };
  if (agent.kind === 'llm') return { title: `Live agent · ${agent.model === 'gemini-3.8-flash' ? 'Gemini 3.8 Flash' : agent.model}`, detail: null };
  return null;
}

/**
 * "How StepFree decided": the actions the journey agent took, in plain words. Every line comes from a structured tool
 * result returned by the backend (never from model text), with the tool name and time kept small for those who want it.
 */
export function DecisionTrace({ trace, agent }: { trace: TraceEntry[]; agent?: AgentRuntimeInfo | null }) {
  const disclosure = agentDisclosure(agent);
  if (trace.length === 0) return null;
  return (
    <details className="group rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-base font-semibold text-slate-700">
        How StepFree decided
        <span className="text-sm font-normal text-slate-500 group-open:hidden">Show</span>
        <span className="hidden text-sm font-normal text-slate-500 group-open:inline">Hide</span>
      </summary>
      {disclosure && (
        <p className="pb-2 text-sm text-slate-500">
          <span className="font-medium text-slate-600">{disclosure.title}</span>
          {disclosure.detail && <span className="block">{disclosure.detail}</span>}
        </p>
      )}
      <ol className="space-y-2 pb-3 pt-1" aria-label="Steps the journey agent took">
        {trace.map((entry) => (
          <li key={entry.step} className="flex items-start gap-2 text-base text-slate-700">
            {entry.ok ? (
              <CheckGlyph className="mt-1 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
            ) : (
              <span className="mt-0.5 w-4 shrink-0 text-center font-bold text-amber-700" aria-hidden>
                !
              </span>
            )}
            <span className="flex-1">
              {entry.ok ? '' : <span className="sr-only">Not accepted: </span>}
              {entry.summary}
              <span className="block text-xs text-slate-500">
                <code>{entry.tool}</code> · {entry.durationMs} ms
              </span>
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
