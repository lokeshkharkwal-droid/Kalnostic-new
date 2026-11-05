import {
  MasterSampleRow,
  normalizeSampleName,
  pickSampleHandlingInstructions,
} from './sample-handling.util';

const s = (
  labTestId: string,
  sampleName: string | null,
  sampleHandlingInstructions: string | null,
): MasterSampleRow => ({ labTestId, sampleName, sampleHandlingInstructions });

const byTest = (rows: MasterSampleRow[]) => {
  const map = new Map<string, MasterSampleRow[]>();
  for (const r of rows)
    map.set(r.labTestId, [...(map.get(r.labTestId) ?? []), r]);
  return map;
};

describe('normalizeSampleName', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normalizeSampleName('  Blood   (EDTA) ')).toBe('blood (edta)');
    expect(normalizeSampleName(null)).toBe('');
  });
});

describe('pickSampleHandlingInstructions', () => {
  const base = {
    sampleName: 'Blood (Fluoride)',
    snapshotValue: 'stale snapshot text',
    candidateTestIds: ['tenant', 'branch'],
  };

  it('the tenant Master Data sample wins over the branch copy and the snapshot', () => {
    const samplesByTestId = byTest([
      s('tenant', 'Blood (Fluoride)', 'Keep upright'),
      s('branch', 'Blood (Fluoride)', 'old branch text'),
    ]);
    expect(pickSampleHandlingInstructions({ ...base, samplesByTestId })).toBe(
      'Keep upright',
    );
  });

  it('a matched but cleared value is null — never the stale fallback', () => {
    for (const cleared of [null, '', '   ']) {
      const samplesByTestId = byTest([
        s('tenant', 'Blood (Fluoride)', cleared),
        s('branch', 'Blood (Fluoride)', 'old branch text'),
      ]);
      expect(
        pickSampleHandlingInstructions({ ...base, samplesByTestId }),
      ).toBeNull();
    }
  });

  it('a renamed tenant sample falls back to the matching branch Master Data sample', () => {
    const samplesByTestId = byTest([
      s('tenant', 'Serum', 'serum text'),
      s('branch', 'Blood (Fluoride)', 'branch text'),
    ]);
    expect(pickSampleHandlingInstructions({ ...base, samplesByTestId })).toBe(
      'branch text',
    );
  });

  it('picks the sample matching the row among several samples of one test', () => {
    const samplesByTestId = byTest([
      s('tenant', 'Urine', 'urine text'),
      s('tenant', 'Blood (Fluoride)', 'fluoride text'),
    ]);
    expect(pickSampleHandlingInstructions({ ...base, samplesByTestId })).toBe(
      'fluoride text',
    );
  });

  it('matches case- and whitespace-insensitively', () => {
    const samplesByTestId = byTest([
      s('tenant', ' blood  (fluoride) ', 'Keep upright'),
    ]);
    expect(pickSampleHandlingInstructions({ ...base, samplesByTestId })).toBe(
      'Keep upright',
    );
  });

  it('keeps the snapshot value when no candidate sample matches', () => {
    const samplesByTestId = byTest([s('tenant', 'Serum', 'serum text')]);
    expect(pickSampleHandlingInstructions({ ...base, samplesByTestId })).toBe(
      'stale snapshot text',
    );
  });

  it('keeps the snapshot value when there are no candidates (unlinked copy)', () => {
    expect(
      pickSampleHandlingInstructions({
        ...base,
        candidateTestIds: [],
        samplesByTestId: new Map(),
      }),
    ).toBe('stale snapshot text');
  });

  it('keeps the snapshot value (or null) when the row has no sample name', () => {
    const samplesByTestId = byTest([
      s('tenant', 'Blood (Fluoride)', 'Keep upright'),
    ]);
    expect(
      pickSampleHandlingInstructions({
        ...base,
        sampleName: null,
        samplesByTestId,
      }),
    ).toBe('stale snapshot text');
    expect(
      pickSampleHandlingInstructions({
        ...base,
        sampleName: '  ',
        snapshotValue: undefined,
        samplesByTestId,
      }),
    ).toBeNull();
  });
});
