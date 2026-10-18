import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [join(dir, entry.name)] : [],
  );

describe('FalkorDB is the only router', () => {
  const files = sources(decodeURIComponent(root));

  it('has no routing algorithm in the frontend', () => {
    expect(files.length).toBeGreaterThan(10);
    // The About page describes, in prose, that FalkorDB finds shortest paths; it contains no algorithm.
    for (const file of files.filter((f) => !/pages[\\/]About\.tsx$/.test(f))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/dijkstra|bellman|shortest.?path|SPpaths|A\*|breadth.?first/i);
    }
  });

  it('has no predefined route sequences', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\[\s*(?:'[A-Z]{3}'\s*,\s*){3,}'[A-Z]{3}'\s*\]/);
    }
  });

  it('gets every route from the journey agent, and never decides to reroute itself', () => {
    const hook = readFileSync(join(decodeURIComponent(root), 'useStepFree.ts'), 'utf8');
    expect(hook).toContain('api.agentJourney(');
    expect(hook).not.toContain('api.route(');
    // The app reports the outage (demoOutage) and shows what the agent decided.
    // The app reports which simulated event was activated and shows what the agent decided: it never decides that a
    // station closure or a line disruption means a reroute.
    expect(hook).toContain('demoDisruption: kind');
    expect(hook).not.toMatch(/kind === 'STATION'|kind === 'LINE'|\.kind === 'LIFT'/);
    expect(hook).not.toMatch(/route:\s*\{[^}]*stations:\s*\[/);
  });
});
