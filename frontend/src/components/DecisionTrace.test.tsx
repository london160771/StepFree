import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TraceEntry } from '../api';
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
          entry(2, 'get_accessibility_disruptions', 'Detected Green Park Lift 2 unavailable'),
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
});
