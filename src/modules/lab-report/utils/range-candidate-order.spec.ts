import {
  compareRangeCandidates,
  type CandidateOrderRow,
} from './reference-range.util';

/**
 * The fixed order of the technician's Range list: Default first, then a range without an analyzer
 * first, then analyzer id, method, unit (ignoring case), oldest saved, and finally id.
 */
const row = (
  id: string,
  over: Partial<CandidateOrderRow> = {},
): CandidateOrderRow => ({
  id,
  isDefault: false,
  labAdapterId: null,
  method: null,
  unit: null,
  createdAt: null,
  ...over,
});
const sorted = (rows: CandidateOrderRow[]) =>
  [...rows].sort(compareRangeCandidates).map((r) => r.id);

describe('compareRangeCandidates', () => {
  it('a Default comes before a non-Default, whatever else differs', () => {
    expect(
      sorted([
        row('plain-none'),
        row('default-analyzer', { isDefault: true, labAdapterId: 'A1' }),
      ]),
    ).toEqual(['default-analyzer', 'plain-none']);
  });

  it('among equals on Default, a range without an analyzer comes first', () => {
    expect(
      sorted([row('analyzer', { labAdapterId: 'A1' }), row('none')]),
    ).toEqual(['none', 'analyzer']);
    expect(
      sorted([
        row('analyzer', { isDefault: true, labAdapterId: 'A1' }),
        row('none', { isDefault: true }),
      ]),
    ).toEqual(['none', 'analyzer']);
  });

  it('two analyzers are ordered by analyzer id', () => {
    expect(
      sorted([
        row('b', { labAdapterId: 'B' }),
        row('a', { labAdapterId: 'A' }),
      ]),
    ).toEqual(['a', 'b']);
  });

  it('then by method, ignoring case and surrounding spaces; no method first', () => {
    expect(
      sorted([
        row('sls', { method: 'SLS' }),
        row('cyan', { method: ' cyan ' }),
        row('none'),
      ]),
    ).toEqual(['none', 'cyan', 'sls']);
  });

  it('then by unit, ignoring case and spaces', () => {
    expect(
      sorted([row('gl', { unit: 'G/L' }), row('gdl', { unit: 'g/dl ' })]),
    ).toEqual(['gdl', 'gl']);
  });

  it('then the oldest saved first; a missing createdAt counts as oldest', () => {
    expect(
      sorted([
        row('new', { createdAt: new Date('2026-06-01T00:00:00Z') }),
        row('old', { createdAt: new Date('2026-01-01T00:00:00Z') }),
        row('unknown'),
      ]),
    ).toEqual(['unknown', 'old', 'new']);
  });

  it('finally by id, so two otherwise identical rows always sort the same way', () => {
    expect(sorted([row('b'), row('a')])).toEqual(['a', 'b']);
  });

  it('is 0 only for the same row', () => {
    expect(compareRangeCandidates(row('x'), row('x'))).toBe(0);
    expect(compareRangeCandidates(row('x'), row('y'))).not.toBe(0);
  });

  it('gives one answer for any input order (50 random sets, 20 shuffles each)', () => {
    let seed = 7;
    const rnd = () =>
      (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    for (let set = 0; set < 50; set++) {
      const rows = Array.from({ length: 9 }, (_, i) =>
        row('r' + i, {
          isDefault: rnd() < 0.4,
          labAdapterId: pick([null, 'A1', 'A2']),
          method: pick([null, 'SLS', 'sls', 'Cyan']),
          unit: pick([null, 'g/dL', 'G/DL', 'g/L']),
          createdAt: pick([null, new Date(1e12), new Date(2e12)]),
        }),
      );
      const expected = sorted(rows);
      for (let s = 0; s < 20; s++) {
        const shuffled = [...rows].sort(() => rnd() - 0.5);
        expect(sorted(shuffled)).toEqual(expected);
      }
    }
  });
});
