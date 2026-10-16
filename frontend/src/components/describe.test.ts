import { describe, expect, it } from 'vitest';
import { describeLeg, SAFETY_NOTE } from './describe';

const names: Record<string, string> = { VIC: 'Victoria', SJP: "St James's Park", WSM: 'Westminster', GPK: 'Green Park' };
const name = (id: string) => names[id];

describe('route descriptions', () => {
  it('describes passing St James’s Park without alighting', () => {
    expect(describeLeg({ type: 'ride', line: 'district', stations: ['VIC', 'SJP', 'WSM'], minutes: 3 }, name)).toBe(
      "District line to Westminster, passing St James's Park (2 stops)",
    );
  });

  it('describes a step-free interchange with its lifts', () => {
    expect(
      describeLeg(
        { type: 'transfer', kind: 'interchange', stationId: 'GPK', fromLine: 'victoria', toLine: 'jubilee', minutes: 12, lifts: ['a', 'b'] },
        name,
      ),
    ).toBe('Step-free change at Green Park to the Jubilee line (2 lifts)');
  });

  it('keeps the safety note exactly as specified', () => {
    expect(SAFETY_NOTE).toBe('based on currently available TfL accessibility data.');
  });
});
