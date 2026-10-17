import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DemoDisruptionInfo, Route } from '../api';
import { markedStations } from '../useStepFree';
import { RunJudgeDemoButton, SimulateDisruption, SimulatedDisruptionBanner } from './DemoControls';

const options: DemoDisruptionInfo[] = [
  { kind: 'LIFT', id: '940GZZLUGPK-Lift-2', label: 'Green Park Lift 2', closed: false, stationId: 'GPK', line: null, simulated: true },
  { kind: 'STATION', id: 'STATION:GPK', label: 'Green Park station', closed: true, stationId: 'GPK', line: null, simulated: true },
  { kind: 'LINE', id: 'LINE:jubilee', label: 'Jubilee line', closed: false, stationId: null, line: 'jubilee', simulated: true },
];

describe('Run Judge Demo', () => {
  it('is one obvious button', () => {
    const html = renderToStaticMarkup(<RunJudgeDemoButton onClick={() => undefined} />);
    expect(html).toContain('Run Judge Demo');
    expect(html).toContain('data-testid="run-judge-demo"');
    expect(html).toContain('btn-primary');
  });

  it('never asks for location: nothing in the demo path touches geolocation', () => {
    const hook = readFileSync(new URL('../useStepFree.ts', import.meta.url), 'utf8');
    const start = hook.indexOf('const runJudgeDemo');
    const end = hook.indexOf('const resetDemo');
    expect(start).toBeGreaterThan(-1);
    const demoPath = hook.slice(start, end) + hook.slice(hook.indexOf('const findRoute'), hook.indexOf('/** Run Judge Demo'));
    expect(demoPath).not.toMatch(/geolocation|getCurrentPosition|allowLocation/);
    // Location is requested in exactly one place, and only after the user chooses Live Mode.
    expect(hook.match(/navigator\.geolocation\.getCurrentPosition/g)).toHaveLength(1);
    expect(readFileSync(new URL('./DemoControls.tsx', import.meta.url), 'utf8')).not.toMatch(/geolocation/);
  });
});

describe('Simulate disruption', () => {
  it('offers exactly the three controlled scenarios, labelled as Demo Mode events', () => {
    const html = renderToStaticMarkup(<SimulateDisruption options={options} selected="LIFT" onSelect={() => undefined} onSimulate={() => undefined} />);
    expect(html).toContain('Simulate disruption');
    expect(html).toContain('not a real TfL disruption');
    expect(html.match(/<option/g)).toHaveLength(3);
    expect(html).toContain('Lift outage · Green Park Lift 2');
    expect(html).toContain('Station closure · Green Park station');
    expect(html).toContain('Line disruption · Jubilee line');
    expect(html).toContain('>Simulate<');
    expect(html).not.toMatch(/Run Judge Demo|Plan B/);
  });

  it('disables the controls while the agent is working', () => {
    const html = renderToStaticMarkup(<SimulateDisruption options={options} selected="STATION" onSelect={() => undefined} onSimulate={() => undefined} disabled />);
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('uses full-width, touch-sized controls so phones stay usable', () => {
    const html = renderToStaticMarkup(<SimulateDisruption options={options} selected="LIFT" onSelect={() => undefined} onSimulate={() => undefined} />);
    expect(html).toContain('class="field"');
    expect(html).toContain('btn-outage');
    expect(html).not.toMatch(/w-\[\d{3,}px\]/);
  });
});

describe('Simulated disruption banner', () => {
  it.each([
    [0, 'Simulated disruption: Green Park Lift 2 unavailable'],
    [1, 'Simulated disruption: Green Park station closed'],
    [2, 'Simulated disruption: Jubilee line unavailable'],
  ])('labels option %i as simulated', (i, text) => {
    const html = renderToStaticMarkup(<SimulatedDisruptionBanner info={options[i]} />);
    expect(html).toContain(text);
    expect(html).toContain('not a real TfL disruption');
  });

  it('can explain that the journey is unaffected', () => {
    const html = renderToStaticMarkup(<SimulatedDisruptionBanner info={options[2]} detail="This disruption does not affect your journey, so StepFree kept your route." />);
    expect(html).toContain('kept your route');
  });
});

describe('Marking a simulated event on the map', () => {
  const route: Route = {
    graph: 'g',
    totalMinutes: 35,
    nodeIds: [],
    stations: ['VIC', 'GPK', 'WSM', 'WLO', 'SWK', 'LNB'],
    legs: [
      { type: 'ride', line: 'victoria', lines: ['victoria'], stations: ['VIC', 'GPK'], via: [], minutes: 1 },
      { type: 'transfer', kind: 'interchange', stationId: 'GPK', fromLine: 'victoria', toLine: 'jubilee', minutes: 12, lifts: [] },
      { type: 'ride', line: 'jubilee', lines: ['jubilee'], stations: ['GPK', 'WSM', 'WLO', 'SWK', 'LNB'], via: [], minutes: 7 },
    ],
  };

  it('marks the station for lift and station events, and the line\'s stations on this route for a line event', () => {
    expect(markedStations(options[0], route)).toEqual(['GPK']);
    expect(markedStations(options[1], route)).toEqual(['GPK']);
    expect(markedStations(options[2], route)).toEqual(['GPK', 'WSM', 'WLO', 'SWK', 'LNB']);
  });

  it('marks nothing for a line the journey does not use (this is display only; the agent decides what is affected)', () => {
    expect(markedStations({ ...options[2], line: 'central' }, route)).toEqual([]);
  });
});
