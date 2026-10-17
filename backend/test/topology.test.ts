import { describe, expect, it } from 'vitest';
import { loadNetwork } from '../src/network/load.js';
import { buildAreaGraph, isTransferAvailable, unavailableTransferIds } from '../src/network/stepfree.js';

const network = loadNetwork();
const areaGraph = buildAreaGraph(network.areaEdges);
const station = (id: string) => network.stations.find((s) => s.id === id)!;
const nodesAt = (stationId: string) => network.lineNodes.filter((n) => n.stationId === stationId);

const EXPECTED = {
  VIC: 'Victoria',
  GPK: 'Green Park',
  SJP: "St James's Park",
  WSM: 'Westminster',
  WLO: 'Waterloo',
  SWK: 'Southwark',
  LNB: 'London Bridge',
  BND: 'Bond Street',
  TCR: 'Tottenham Court Road',
  KGX: "King's Cross St Pancras",
  PAD: 'Paddington',
  LST: 'Liverpool Street',
  FCN: 'Farringdon',
  MGT: 'Moorgate',
  CAN: 'Canary Wharf',
  TWH: 'Tower Hill',
  CWR: 'Canada Water',
} as const;

const TUBE_LINES = [
  'bakerloo',
  'central',
  'circle',
  'district',
  'hammersmith-city',
  'jubilee',
  'metropolitan',
  'northern',
  'piccadilly',
  'victoria',
  'waterloo-city',
];

describe('Supported stations (TfL topology)', () => {
  it('has exactly the 17 locked stations with unique ids', () => {
    expect(network.stations).toHaveLength(17);
    expect(new Set(network.stations.map((s) => s.id)).size).toBe(17);
    expect(Object.fromEntries(network.stations.map((s) => [s.id, s.name]))).toEqual(EXPECTED);
  });

  it('gives every station real TfL coordinates and Underground NaPTAN ids inside central London', () => {
    for (const s of network.stations) {
      expect(s.lat, s.name).toBeGreaterThan(51.48);
      expect(s.lat, s.name).toBeLessThan(51.54);
      expect(s.lon, s.name).toBeGreaterThan(-0.19);
      expect(s.lon, s.name).toBeLessThan(-0.01);
      expect(s.naptanIds.length, s.name).toBeGreaterThan(0);
      for (const id of s.naptanIds) expect(id, s.name).toMatch(/^940GZZLU[A-Z]{3}$/);
    }
    expect(station('PAD').naptanIds).toEqual(['940GZZLUPAC', '940GZZLUPAH']);
  });

  it('is London Underground only', () => {
    for (const node of network.lineNodes) {
      for (const line of node.lines) expect(TUBE_LINES, node.id).toContain(line);
    }
    for (const ride of network.rides) for (const line of ride.lines) expect(TUBE_LINES).toContain(line);
    const text = JSON.stringify(network.lineNodes) + JSON.stringify(network.rides);
    expect(text).not.toMatch(/elizabeth|overground|dlr|national-rail|thameslink/i);
  });

  it('keeps unsupported intermediate stops out of the supported station list', () => {
    const supported = new Set(network.stations.map((s) => s.name));
    const wsmToTwh = network.rides.find((r) => r.from.startsWith('WSM:') && r.to.startsWith('TWH:'))!;
    expect(wsmToTwh.via).toEqual(['Embankment', 'Temple', 'Blackfriars', 'Mansion House', 'Cannon Street', 'Monument']);
    for (const name of wsmToTwh.via) expect(supported.has(name)).toBe(false);
  });
});

describe('Partial step-free access is modelled per platform and direction', () => {
  it('Liverpool Street: no Central line access, and only the eastbound Circle/H&C/Metropolitan platform', () => {
    const lines = nodesAt('LST').filter((n) => n.boardable).flatMap((n) => n.lines);
    expect(lines).not.toContain('central');
    expect(nodesAt('LST').some((n) => n.lines.includes('central') && n.boardable)).toBe(false);
    const eastbound = nodesAt('LST').find((n) => n.direction === 'EB')!;
    const westbound = nodesAt('LST').find((n) => n.direction === 'WB')!;
    expect(eastbound.boardable).toBe(true);
    expect(westbound.boardable).toBe(false);
    expect(westbound.platformIds).toEqual([]);
    expect(station('LST').accessNotes.join(' ')).toMatch(/central.*Platform 4/);
    // A train can only be left at Liverpool Street eastbound, i.e. when arriving from Moorgate.
    expect(network.rides.some((r) => r.from.startsWith('MGT:') && r.to === eastbound.id)).toBe(true);
    expect(network.rides.some((r) => r.from.startsWith('TWH:') && r.to === eastbound.id)).toBe(false);
  });

  it('Paddington: Circle/District platform 1 has no step-free access, platform 2 does', () => {
    const district = nodesAt('PAD').filter((n) => n.lines.includes('district'));
    expect(district.find((n) => n.direction === 'EB')!.boardable).toBe(true);
    expect(district.some((n) => n.direction === 'WB' && n.boardable)).toBe(false);
    expect(station('PAD').accessNotes.join(' ')).toMatch(/Westbound Platform 1/);
  });

  it('Waterloo: only the Jubilee line is step-free (Northern, Bakerloo and Waterloo & City are not)', () => {
    expect(station('WLO').lines).toEqual(['jubilee']);
    expect(station('WLO').accessNotes.join(' ')).toMatch(/northern/);
  });

  it("St James's Park has no step-free street access, so it is a pass-through station only", () => {
    expect(station('SJP').stepFreeStreetAccess).toBe(false);
    expect(nodesAt('SJP').every((n) => !n.boardable)).toBe(true);
    expect(network.transfers.some((t) => t.stationId === 'SJP')).toBe(false);
  });
});

describe('Green Park Lift 2 (Demo Mode outage)', () => {
  const lift = network.demoOutage.liftUniqueId;
  const nodeLine = new Map(network.lineNodes.map((n) => [n.id, n.line]));

  it('is the verified TfL lift the Victoria <-> Jubilee interchange requires', () => {
    expect(lift).toBe('940GZZLUGPK-Lift-2');
    expect(network.lifts.some((l) => l.liftUniqueId === lift)).toBe(true);
    const interchanges = network.transfers.filter(
      (t) => t.stationId === 'GPK' && nodeLine.get(t.from) === 'victoria' && nodeLine.get(t.to) === 'jubilee',
    );
    expect(interchanges.length).toBeGreaterThan(0);
    for (const t of interchanges) expect(t.requiredLifts).toEqual([lift]);
  });

  it('disables only Green Park Jubilee pathways, not the whole station', () => {
    const affected = unavailableTransferIds(areaGraph, network.transfers, new Set([lift]));
    expect(affected.sort()).toEqual([...network.demoOutage.affectedTransferIds].sort());
    expect(affected.length).toBeGreaterThan(0);
    for (const id of affected) {
      const t = network.transfers.find((x) => x.id === id)!;
      expect(t.stationId).toBe('GPK');
      expect([nodeLine.get(t.from), nodeLine.get(t.to)]).toContain('jubilee');
    }
    const street = network.transfers.find((t) => t.from === 'GPK:street' && nodeLine.get(t.to) === 'victoria')!;
    expect(isTransferAvailable(areaGraph, street, new Set([lift]))).toBe(true);
  });
});
