import { describe, expect, it } from 'vitest';
import { loadNetwork } from '../src/network/load.js';
import { buildAreaGraph, isTransferAvailable, unavailableTransferIds } from '../src/network/stepfree.js';

const network = loadNetwork();
const areaGraph = buildAreaGraph(network.areaEdges);
const transfer = (id: string) => network.transfers.find((t) => t.id === id)!;

describe('TfL topology proof (Phase 0)', () => {
  it('derives Green Park Lift 2 as the lift the Victoria <-> Jubilee interchange requires', () => {
    expect(network.demoOutage.liftUniqueId).toBe('940GZZLUGPK-Lift-2');
    expect(network.lifts.some((l) => l.liftUniqueId === network.demoOutage.liftUniqueId)).toBe(true);
    expect(transfer('GPK:victoria~GPK:jubilee').requiredLifts).toEqual(['940GZZLUGPK-Lift-2']);
  });

  it('disables only the Green Park Jubilee pathways, not the whole station', () => {
    const lift = new Set([network.demoOutage.liftUniqueId]);
    const affected = unavailableTransferIds(areaGraph, network.transfers, lift);
    expect(affected.sort()).toEqual(
      ['GPK:jubilee~GPK:street', 'GPK:jubilee~GPK:victoria', 'GPK:street~GPK:jubilee', 'GPK:victoria~GPK:jubilee'].sort(),
    );
    expect(isTransferAvailable(areaGraph, transfer('GPK:street~GPK:victoria'), lift)).toBe(true);
  });

  it("treats St James's Park as a pass-through with no step-free street access", () => {
    const sjp = network.stations.find((s) => s.id === 'SJP')!;
    expect(sjp.stepFreeStreetAccess).toBe(false);
    expect(network.transfers.some((t) => t.stationId === 'SJP')).toBe(false);
    expect(network.rides.some((r) => r.from === 'VIC:district' && r.to === 'SJP:district')).toBe(true);
  });

  it('supports the Westminster District <-> Jubilee step-free interchange used by the reroute', () => {
    expect(transfer('WSM:district~WSM:jubilee').liftsUsed.length).toBeGreaterThan(0);
  });
});
