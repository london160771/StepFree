import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentRuntimeInfo, TraceEntry } from '../api';
import { DecisionTrace } from './DecisionTrace';

const entry = (step: number, tool: string, summary: string, ok = true): TraceEntry => ({ step, tool, args: {}, ok, result: {}, summary, durationMs: 12 });

describe('How StepFree decided', () => {
  it('renders nothing when the agent made no calls', () => {
    expect(renderToStaticMarkup(<DecisionTrace trace={[]} />)).toBe('');
  });

  it('is a collapsed, keyboard-operable disclosure listing each tool step in plain words', () => {
    const html = renderToStaticMarkup(
      <DecisionTrace
        trace={[
          entry(1, 'plan_step_free_journey', 'Asked FalkorDB for a step-free route: 35 min via Victoria, Green Park'),
          entry(2, 'get_journey_disruptions', 'Detected Green Park Lift 2 unavailable'),
        ]}
      />,
    );
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(html).toContain('<summary');
    expect(html).toContain('How StepFree decided');
    expect(html).toContain('aria-label="Steps the journey agent took"');
    expect(html).toContain('Detected Green Park Lift 2 unavailable');
    expect(html).toContain('plan_step_free_journey');
    expect(html).toContain('12 ms');
  });

  it('marks steps the agent was not allowed to take, for screen readers too', () => {
    const html = renderToStaticMarkup(<DecisionTrace trace={[entry(1, 'record_journey_decision', 'Rejected', false)]} />);
    expect(html).toContain('Not accepted:');
  });

  const runtime = (kind: AgentRuntimeInfo['kind'], model: string): AgentRuntimeInfo => ({ kind, model, transport: 'mcp-streamable-http', toolCalls: 4, maxToolCalls: 8 });
  const trace = [entry(1, 'plan_step_free_journey', 'Asked FalkorDB for a step-free route')];

  it('says the Demo agent is a deterministic tool policy that does not use Gemini, and never calls it Gemini', () => {
    const html = renderToStaticMarkup(<DecisionTrace trace={trace} agent={runtime('deterministic', 'stepfree-demo-policy')} />);
    expect(html).toContain('Demo agent · deterministic tool policy');
    expect(html).toContain('Runs the same MCP tools and FalkorDB graph without using Gemini.');
    expect(html).not.toContain('Live agent');
    expect(html.replace('without using Gemini', '')).not.toMatch(/Gemini/);
    expect(html).toContain('plan_step_free_journey');
  });

  it('says the Live agent is Gemini 3.8 Flash', () => {
    const html = renderToStaticMarkup(<DecisionTrace trace={trace} agent={runtime('llm', 'gemini-3.8-flash')} />);
    expect(html).toContain('Live agent · Gemini 3.8 Flash');
    expect(html).not.toContain('deterministic');
  });

  it('shows no disclosure when the backend reports no agent', () => {
    const html = renderToStaticMarkup(<DecisionTrace trace={trace} agent={null} />);
    expect(html).not.toContain('agent ·');
    expect(html).toContain('How StepFree decided');
  });
});
