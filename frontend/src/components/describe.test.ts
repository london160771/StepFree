import { describe, expect, it } from 'vitest';
import { describeLeg, SAFETY_NOTE } from './describe';

const names: Record<string, string> = { VIC: 'Victoria', SJP: "St James's Park", WSM: 'Westminster', GPK: 'Green Park' };
const name = (id: string) => names[id];

describe('route descriptions', () => {
  it('describes passing St James’s Park without alighting', () => {
    expect(describeLeg({ type: 'ride', line: 'district', lines: ['district', 'circle'], stations: ['VIC', 'SJP', 'WSM'], via: [], minutes: 3 }, name)).toBe(
      "District or Circle line to Westminster, passing St James's Park (2 stops)",
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

  it('counts unsupported stops a train passes without calling them StepFree stations', () => {
    const text = describeLeg(
      { type: 'ride', line: 'district', lines: ['district'], stations: ['WSM', 'TWH'], via: ['Embankment', 'Temple', 'Blackfriars'], minutes: 11 },
      (id) => ({ WSM: 'Westminster', TWH: 'Tower Hill' })[id] ?? id,
    );
    expect(text).toBe('District line to Tower Hill, passing 3 other stops (4 stops)');
  });

  it('describes a change of platform within the same line', () => {
    const text = describeLeg({ type: 'transfer', kind: 'interchange', stationId: 'MGT', fromLine: 'circle', toLine: 'circle', minutes: 6, lifts: ['a'] }, (id) => id);
    expect(text).toBe('Step-free change of platform at MGT (1 lift)');
  });
});
