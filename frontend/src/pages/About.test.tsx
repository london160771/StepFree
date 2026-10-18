import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { About } from './About';

const html = renderToStaticMarkup(<About />);
const text = html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'")
  .replace(/\s+/g, ' ');

describe('About page: documentation sections', () => {
  it('has the sections in order, each reachable from a compact contents list', () => {
    const order = ['id="what"', 'id="story"', 'id="using"', 'id="network"', 'id="technology"', 'id="vision"', 'id="closing"'];
    const positions = order.map((id) => html.indexOf(id));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('aria-label="On this page"');
    for (const label of ['What is StepFree?', 'Story', 'Using StepFree', 'Current network', 'Technology', 'Vision']) expect(text).toContain(label);
    for (const heading of ['Why I built StepFree', 'Using StepFree', 'Current network', 'How StepFree works', 'Built with FalkorDB', 'Other technology', 'Where StepFree can go', 'Closing note']) {
      expect(text, heading).toContain(heading);
    }
  });

  it('introduces StepFree as an accessibility journey agent and names who it helps, without medical claims', () => {
    expect(text).toContain('accessibility journey agent');
    for (const who of ['wheelchair users', 'people with limited mobility', 'mobility aids', 'older travellers', 'pushchairs']) expect(text).toContain(who);
    expect(text).not.toMatch(/disabled people|medical|diagnos|patient/i);
  });

  it('keeps contents links in the page: they scroll in place and do not change the hash route', () => {
    expect(html).toContain('href="#/about"');
    expect(html).not.toMatch(/href="#\/about#/);
  });

  it('opens external links safely', () => {
    const links = [...html.matchAll(/<a [^>]*href="https?:[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noreferrer"');
    }
    expect(html).toContain('https://github.com/london160771/StepFree');
  });

  it('is plain: no images, and none of the avoided marketing words', () => {
    expect(html).not.toContain('<img');
    expect(text).not.toMatch(/revolutionary|game-changing|seamless/i);
  });
});

describe('About page: story', () => {
  it('is in the first person and says only what was given: a brother in London who uses the train, and travellers he saw struggling', () => {
    expect(text).toContain('My brother lives in London and uses the train regularly');
    expect(text).toContain('other travellers struggling around stations');
    expect(text).toContain('one inaccessible connection');
    expect(text).toContain('What route can this person actually use?');
  });

  it('does not say the brother has a disability or invent an incident', () => {
    const from = text.indexOf('Why I built StepFree');
    const story = text.slice(from, text.indexOf('Using StepFree', from + 10));
    expect(story.length).toBeGreaterThan(300);
    expect(story).not.toMatch(/wheelchair|disab|impair|accident|stuck|incident/i);
  });
});

describe('About page: using StepFree', () => {
  it('describes Demo Mode as working anywhere, with no location, and lists what it offers and the three simulated events', () => {
    expect(text).toContain('Demo Mode works from anywhere');
    expect(text).toContain('no location permission');
    for (const item of ['Route Health', 'Plan B', 'Why this route?', 'How StepFree decided']) expect(text).toContain(item);
    for (const event of ['lift outage', 'station closure', 'line disruption']) expect(text).toContain(event);
    expect(text).toContain('Run Demo');
    expect(text).toContain('Victoria → London Bridge');
  });

  it('says the Demo events are simulated and not real disruptions', () => {
    expect(text).toContain('simulated Demo Mode events');
    expect(text).toMatch(/not current disruptions on the real network/);
  });

  it('states Live Mode accurately: London-only, location permission, nearest station, real TfL lift data, and what it does not do', () => {
    expect(text).toContain('Live Mode is currently London-only');
    expect(text).toContain('location permission');
    expect(text).toContain('nearest supported station');
    expect(text).toContain('real Transport for London lift-disruption data');
    for (const not of ['live station closures', 'live line disruption rerouting', 'real-time train delays', 'train arrival predictions']) expect(text).toContain(not);
    expect(text).toMatch(/timetable data, not delay-adjusted/);
  });
});

describe('About page: current network and data', () => {
  const stations = ['Victoria', 'Green Park', "St James’s Park", 'Westminster', 'Waterloo', 'Southwark', 'London Bridge', 'Bond Street', 'Tottenham Court Road', 'King’s Cross St Pancras', 'Paddington', 'Liverpool Street', 'Farringdon', 'Moorgate', 'Canary Wharf', 'Tower Hill', 'Canada Water'];

  it('lists all 17 supported stations exactly, in a labelled list', () => {
    const list = html.slice(html.indexOf('aria-label="Supported stations"'));
    const items = [...list.matchAll(/<li [^>]*>([^<]+)<\/li>/g)].slice(0, 17).map((m) => m[1]);
    expect(items).toEqual(stations);
    expect(text).toContain('17 London Underground stations');
    expect(text).toContain('covers the Underground only');
  });

  it('is clear that coverage is limited and that St James’s Park is pass-through only', () => {
    expect(text).toMatch(/not a London-wide journey planner/);
    expect(text).toMatch(/St James’s Park has no step-free access[^.]*pass-through only/);
    expect(text).not.toMatch(/full London coverage|all of London|every station/i);
  });

  it('explains the data honestly: official TfL sources, timetable ride times, estimated transfers, safety note, not endorsed', () => {
    for (const source of ['detailed station topology', 'lift topology', 'route sequences', 'timetable running times', 'StopPoint coordinates']) expect(text).toContain(source);
    expect(text).toContain('Ride durations come from TfL timetable data');
    expect(text).toContain('Station transfer times are estimates');
    expect(text).toContain('based on currently available TfL accessibility data.');
    expect(text).toContain('not endorsed by TfL');
  });
});

describe('About page: technology and vision', () => {
  it('has a FalkorDB section that explains the graph, shortest path, disruptions, recomputation and memory', () => {
    expect(text).toContain('Built with FalkorDB');
    expect(text).toContain('Graph Hacks');
    for (const idea of ['graph nodes', 'step-free-transfer relationships', 'shortest-path', 'unavailable', 'recomputes', 'JourneySession', 'AgentDecision']) expect(text, idea).toContain(idea);
  });

  it('gets the architecture right: Gemini never talks to FalkorDB; tools are fixed and exposed through MCP', () => {
    expect(text).toContain('Gemini → StepFree agent host → MCP tools → FalkorDB / TfL');
    expect(text).toContain('Gemini never connects to FalkorDB directly');
    expect(text).toContain('does not write database queries');
    expect(text).toContain('fixed set of validated StepFree tools');
    expect(text).toContain('3.8 Flash');
    expect(text).toContain('Model Context Protocol');
    expect(text).toContain('never shows the model’s private reasoning');
  });

  it('lists the real stack', () => {
    for (const tech of ['React', 'TypeScript', 'Vite', 'Tailwind CSS', 'Framer Motion', 'MapLibre GL JS', 'OpenFreeMap', 'OpenStreetMap', 'Node.js', 'Express', 'Progressive Web App']) expect(text, tech).toContain(tech);
  });

  it('has a vision that is future-facing, names Nigeria without claiming data exists, and a short closing note with the product line', () => {
    expect(text).toContain('Where StepFree can go');
    expect(text).toContain('proof of concept');
    for (const city of ['New York', 'Paris', 'Tokyo', 'Lagos', 'Abuja', 'Nigeria']) expect(text).toContain(city);
    expect(text).toContain('as more structured public-transport data becomes available');
    expect(text).toContain('nothing here assumes it already does');
    expect(text).toContain('Closing note');
    expect(text).toContain('The shortest route isn’t useful if you can’t use it.');
  });

  it('does not document abandoned or future features as built', () => {
    expect(text).not.toMatch(/Fragile Point|Rescue Me|What if this lift fails/);
  });
});

describe('The demo button is called Run Demo everywhere', () => {
  it('has no "Run Judge Demo" left in the app source', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|css|html)$/.test(e.name) ? [join(dir, e.name)] : []));
    const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    for (const file of files(root)) {
      if (file.endsWith('About.test.tsx')) continue;
      expect(readFileSync(file, 'utf8'), file).not.toContain('Run Judge Demo');
    }
  });
});
