import { AccessionGroupingMode } from '@prisma/client';
import { barcodeGroupKey } from './barcode-group-key';

/**
 * Edge cases of the one shared grouping rule, derived from reading `barcode-group-key.ts` and the place that stamps
 * `sampleGroupLabel` (`sampleName ?? sampleType ?? containerType ?? 'General'`). The expectations below are written
 * INDEPENDENTLY of the implementation (as "when are two samples of one order in the same group?") and checked for every
 * pair in a matrix, so a drift in NULL / empty / case / whitespace handling is caught.
 */

type Sample = {
  id: string;
  departmentId: string | null;
  sampleGroupLabel: string | null;
};

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const DEPTS: (string | null)[] = [D1, D2, null];
const LABELS: (string | null)[] = [
  'Serum',
  'serum',
  'Serum ',
  ' Serum',
  '',
  null,
  'General',
];

const samples: Sample[] = [];
let n = 0;
for (const d of DEPTS)
  for (const l of LABELS)
    samples.push({ id: `s${++n}`, departmentId: d, sampleGroupLabel: l });

/** The same label rule as the stamping code: a missing label means "General"; nothing else is normalised. */
const labelKey = (l: string | null) => (l === null ? 'General' : l);

/** "Do these two samples (of the SAME order) belong to one group?" - stated from the business rule, not copied from the code. */
const sameGroup = (
  a: Sample,
  b: Sample,
  mode: AccessionGroupingMode,
): boolean => {
  switch (mode) {
    case AccessionGroupingMode.ORDER:
      return true;
    case AccessionGroupingMode.DEPARTMENT:
      return a.departmentId === b.departmentId;
    case AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME:
      return (
        a.departmentId === b.departmentId &&
        labelKey(a.sampleGroupLabel) === labelKey(b.sampleGroupLabel)
      );
    case AccessionGroupingMode.SAMPLE_NAME:
      return a.id === b.id;
  }
};

describe('barcodeGroupKey - every pair of samples, every mode', () => {
  for (const mode of Object.values(AccessionGroupingMode)) {
    it(`${mode}: two samples share a key exactly when the business rule puts them in one group (${samples.length * samples.length} pairs)`, () => {
      const wrong: string[] = [];
      for (const a of samples) {
        for (const b of samples) {
          const same = barcodeGroupKey(a, mode) === barcodeGroupKey(b, mode);
          if (same !== sameGroup(a, b, mode))
            wrong.push(
              `${JSON.stringify(a)} vs ${JSON.stringify(b)}: key-equal=${same}`,
            );
        }
      }
      expect(wrong).toEqual([]);
    });

    it(`${mode}: the key is deterministic and never empty`, () => {
      for (const s of samples) {
        expect(barcodeGroupKey(s, mode)).toBe(barcodeGroupKey({ ...s }, mode));
        expect(barcodeGroupKey(s, mode).length).toBeGreaterThan(0);
      }
    });
  }
});

describe('barcodeGroupKey - pinned current behaviour of the corner cases (a change here must be a conscious decision)', () => {
  const mk = (
    departmentId: string | null,
    sampleGroupLabel: string | null,
    id = 'x',
  ): Sample => ({ id, departmentId, sampleGroupLabel });
  const K = AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME;

  it('a missing department is its own group, and is the SAME group for every sample without one', () => {
    expect(
      barcodeGroupKey(mk(null, 'Serum', 'a'), AccessionGroupingMode.DEPARTMENT),
    ).toBe(
      barcodeGroupKey(mk(null, 'Urine', 'b'), AccessionGroupingMode.DEPARTMENT),
    );
    expect(
      barcodeGroupKey(mk(null, 'Serum'), AccessionGroupingMode.DEPARTMENT),
    ).not.toBe(
      barcodeGroupKey(mk(D1, 'Serum'), AccessionGroupingMode.DEPARTMENT),
    );
  });

  it('a missing label groups with a label literally called "General" (the stamping default)', () => {
    expect(barcodeGroupKey(mk(D1, null), K)).toBe(
      barcodeGroupKey(mk(D1, 'General'), K),
    );
  });

  it('an EMPTY label is NOT the same as a missing one (the stamping code only replaces null/undefined)', () => {
    expect(barcodeGroupKey(mk(D1, ''), K)).not.toBe(
      barcodeGroupKey(mk(D1, null), K),
    );
  });

  it('labels are compared exactly: case and surrounding spaces make different groups (no normalisation)', () => {
    expect(barcodeGroupKey(mk(D1, 'Serum'), K)).not.toBe(
      barcodeGroupKey(mk(D1, 'serum'), K),
    );
    expect(barcodeGroupKey(mk(D1, 'Serum'), K)).not.toBe(
      barcodeGroupKey(mk(D1, 'Serum '), K),
    );
  });

  it('a department id can never collide with the "none" fallback (ids are UUIDs)', () => {
    expect(
      barcodeGroupKey(mk(null, 'S'), AccessionGroupingMode.DEPARTMENT),
    ).toBe('DEPT::none');
    expect(barcodeGroupKey(mk(D1, 'S'), AccessionGroupingMode.DEPARTMENT)).toBe(
      `DEPT::${D1}`,
    );
  });

  it('the key of one mode never equals the key of another mode for the same sample (no cross-mode confusion)', () => {
    const s = mk(D1, 'Serum', 's1');
    const keys = Object.values(AccessionGroupingMode).map((m) =>
      barcodeGroupKey(s, m),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('an unknown / future mode falls back to one group PER SAMPLE (the safe, most granular side)', () => {
    expect(
      barcodeGroupKey(
        mk(D1, 'Serum', 's9'),
        'SOMETHING_NEW' as AccessionGroupingMode,
      ),
    ).toBe('SAMPLE::s9');
  });
});
