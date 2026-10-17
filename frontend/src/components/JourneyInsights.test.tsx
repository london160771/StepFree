import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlanB, Route } from '../api';
import { DecisionTrace } from './DecisionTrace';
import { PlanBSection, RouteHealthStatus, WhyThisRouteSection } from './JourneyInsights';

const names: Record<string, string> = { VIC: 'Victoria', SJP: "St James's Park", WSM: 'Westminster', LNB: 'London Bridge' };
const name = (id: string) => names[id] ?? id;

const backupRoute: Route = {
  graph: 'stepfree:abc',
  totalMinutes: 39,
  nodeIds: [],
  stations: ['VIC', 'SJP', 'WSM', 'LNB'],
  legs: [
    { type: 'transfer', kind: 'entrance', stationId: 'VIC', fromLine: null, toLine: null, minutes: 12, lifts: ['L1'] },
    { type: 'ride', line: 'district', lines: ['district', 'circle'], stations: ['VIC', 'SJP', 'WSM'], via: [], minutes: 3 },
    { type: 'ride', line: 'jubilee', lines: ['jubilee'], stations: ['WSM', 'LNB'], via: [], minutes: 10 },
  ],
};

const planB: PlanB = {
  available: true,
  durationMinutes: 39,
  extraMinutes: 4,
  route: backupRoute,
  stations: ['Victoria', "St James's Park", 'Westminster', 'London Bridge'],
  lines: ['District or Circle', 'Jubilee'],
  avoided: [{ connectionId: 'L2', station: 'Green Park', name: 'Lift 2' }],
};

describe('Route Health', () => {
  it.each([
    ['CLEAR', 'Clear'],
    ['AFFECTED', 'Affected'],
    ['REROUTED', 'Rerouted'],
    ['NO_ROUTE', 'No step-free route'],
  ] as const)('shows %s in plain words', (status, label) => {
    const html = renderToStaticMarkup(<RouteHealthStatus health={{ status, affectedConnectionIds: [] }} />);
    expect(html).toContain('Route Health');
    expect(html).toContain(label);
    expect(html).not.toMatch(/%|confidence|score/i);
  });
});

describe('Plan B', () => {
  it('shows a collapsed preview with duration and extra minutes, and the route when opened', () => {
    const html = renderToStaticMarkup(<PlanBSection planB={planB} name={name} />);
    expect(html).toContain('Plan B');
    expect(html).toContain('Backup available · 39 min');
    expect(html).toContain('+4 min');
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(html).toContain('Victoria → St James&#x27;s Park → Westminster → London Bridge');
    expect(html).toContain('District or Circle, then Jubilee');
    expect(html).toContain('It is not selected now');
  });

  it('says calmly when there is no backup, without inventing one', () => {
    const html = renderToStaticMarkup(
      <PlanBSection planB={{ ...planB, available: false, durationMinutes: null, extraMinutes: null, route: null, stations: [], lines: [], avoided: [] }} name={name} />,
    );
    expect(html).toContain('No backup route currently available');
    expect(html).not.toContain('min');
    expect(html).not.toContain('<details');
  });
});

describe('Why this route? and How StepFree decided stay separate', () => {
  const reasons = ['The shortest step-free route that is currently usable', '1 change of line, each step-free', 'A backup route is ready if this one becomes unusable (+4 min)'];

  it('lists plain-language reasons in an accessible, collapsed disclosure', () => {
    const html = renderToStaticMarkup(<WhyThisRouteSection why={{ reasons }} />);
    expect(html).toContain('Why this route?');
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    for (const reason of reasons) expect(html).toContain(reason);
    expect(html).toContain('aria-label="Reasons StepFree chose this route"');
    expect(html).not.toMatch(/plan_step_free|find_backup_route|MCP|Cypher|FalkorDB/);
  });

  it('keeps tool names out of the user explanation and the explanation out of the technical trace', () => {
    const trace = renderToStaticMarkup(
      <DecisionTrace trace={[{ step: 1, tool: 'find_backup_route', args: {}, ok: true, result: {}, summary: 'Looked for a Plan B: 39 min', durationMs: 14 }]} />,
    );
    expect(trace).toContain('How StepFree decided');
    expect(trace).toContain('find_backup_route');
    expect(trace).not.toContain('Why this route?');
  });

  it('uses touch-sized disclosure rows so phones stay usable', () => {
    for (const html of [renderToStaticMarkup(<PlanBSection planB={planB} name={name} />), renderToStaticMarkup(<WhyThisRouteSection why={{ reasons }} />)]) {
      expect(html).toContain('min-h-11');
      expect(html).not.toMatch(/w-\[\d{3,}px\]|min-w-\[\d{3,}px\]/);
    }
  });
});
