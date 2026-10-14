import { normalizeUnit } from './unit-normalize.util';

/**
 * The same table of cases is in the frontend test `src/utils/unit-normalize.test.ts`
 * (Kalnostic - FE - new). Change one, change both.
 */
const SAME: Array<[string | null | undefined, string | null | undefined]> = [
  ['g/dL', 'g/dl'],
  ['mg/dL', 'mg/dl'],
  ['uIU/mL', 'uIu/mL'],
  ['  g/dL ', 'g/dL'],
  ['g/dL', 'G/DL'],
  ['mmol/L', ' MMOL/L\t'],
  ['10^3/uL', '10^3/UL'],
  ['mL/min/1.73m^2', 'ML/MIN/1.73M^2'],
  ['%', ' % '],
  ['', null],
  [null, undefined],
  ['   ', ''],
  ['\n\t', undefined],
  ['IU / mL', 'iu  /  ML'], // repeated spaces collapse to one
  ['mg / dL', 'mg / dl'], // non-breaking spaces count as spaces
];

const DIFFERENT: Array<[string, string]> = [
  ['g/dL', 'g/L'],
  ['g / dL', 'g/dL'], // spaces INSIDE a unit are kept (not an alias table)
  ['10^3/uL', '10³/µL'], // other spellings of the same unit are NOT merged here
  ['10^3/uL', 'K/uL'],
  ['mg/dL', 'mmol/L'],
  ['IU/L', 'U/L'],
  ['%', 'percent'],
  ['g/dL', ''],
];

describe('normalizeUnit', () => {
  it.each(SAME)('%j and %j are the same unit', (a, b) => {
    expect(normalizeUnit(a)).toBe(normalizeUnit(b));
  });

  it.each(DIFFERENT)('%j and %j are different units', (a, b) => {
    expect(normalizeUnit(a)).not.toBe(normalizeUnit(b));
  });

  it.each([null, undefined, '', '   ', '\n'])(
    'a missing or blank unit (%j) becomes an empty string',
    (u) => {
      expect(normalizeUnit(u)).toBe('');
    },
  );

  it('returns lower case with single spaces and no surrounding spaces', () => {
    expect(normalizeUnit('  Mg  /  DL ')).toBe('mg / dl');
  });

  it('is idempotent', () => {
    for (const u of ['g/dL', '  uIU/mL ', 'IU / mL', '']) {
      expect(normalizeUnit(normalizeUnit(u))).toBe(normalizeUnit(u));
    }
  });
});
