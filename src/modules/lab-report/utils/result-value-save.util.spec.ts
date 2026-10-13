import { ResultValueSource } from '@prisma/client';
import {
  classifyResultValueSave,
  describeAnalyzerOverwrite,
  type StoredResultValue,
} from './result-value-save.util';

const UPDATED = new Date('2026-10-12T10:00:00.000Z');
const stored = (over: Partial<StoredResultValue> = {}): StoredResultValue => ({
  source: ResultValueSource.ADAPTER,
  observed1: '130',
  observed2: null,
  updatedAt: UPDATED,
  deletedAt: null,
  ...over,
});

describe('classifyResultValueSave — an analyzer value the technician did not touch', () => {
  it('stays the analyzer value when Observed 1 and 2 are unchanged', () => {
    expect(classifyResultValueSave(stored(), { observed1: '130' })).toEqual({
      mode: 'keep-analyzer',
      stale: false,
    });
  });

  it.each([
    ['null stored vs empty string sent', { observed2: '' }],
    ['spaces around the same number', { observed1: ' 130 ' }],
    ['a field not sent at all (not touched)', {}],
  ])('stays the analyzer value: %s', (_label, incoming) => {
    expect(classifyResultValueSave(stored(), incoming).mode).toBe(
      'keep-analyzer',
    );
  });
});

describe('classifyResultValueSave — the technician changed it', () => {
  it.each([
    ['Observed 1 changed', { observed1: '131' }],
    ['Observed 1 cleared', { observed1: '' }],
    ['Observed 2 filled', { observed1: '130', observed2: '131' }],
  ])('becomes a human value: %s', (_label, incoming) => {
    expect(classifyResultValueSave(stored(), incoming).mode).toBe(
      'overwrite-analyzer',
    );
  });

  it('the "confirmed" flag makes it human even when the number is the same', () => {
    expect(
      classifyResultValueSave(stored(), {
        observed1: '130',
        overridesAnalyzer: true,
      }).mode,
    ).toBe('overwrite-analyzer');
  });

  it('a flag set to false does not', () => {
    expect(
      classifyResultValueSave(stored(), {
        observed1: '130',
        overridesAnalyzer: false,
      }).mode,
    ).toBe('keep-analyzer');
  });
});

describe('classifyResultValueSave — everything else is an ordinary save', () => {
  it('a value with nothing stored yet', () => {
    expect(classifyResultValueSave(undefined, { observed1: '1' }).mode).toBe(
      'as-entered',
    );
  });
  it("a value that is already the technician's", () => {
    expect(
      classifyResultValueSave(stored({ source: ResultValueSource.MANUAL }), {
        observed1: '999',
      }),
    ).toEqual({ mode: 'as-entered', stale: false });
  });
  it('a calculated value', () => {
    expect(
      classifyResultValueSave(
        stored({ source: ResultValueSource.CALCULATED }),
        {
          observed1: '1',
        },
      ).mode,
    ).toBe('as-entered');
  });
  it('a previously deleted analyzer value (re-run reset) is treated as new', () => {
    expect(
      classifyResultValueSave(stored({ deletedAt: new Date() }), {
        observed1: '130',
      }).mode,
    ).toBe('as-entered');
  });
});

describe('classifyResultValueSave — stale screen', () => {
  it('is stale when the analyzer row changed after the screen loaded it', () => {
    const r = classifyResultValueSave(stored(), {
      observed1: '130',
      loadedUpdatedAt: '2026-10-12T09:00:00.000Z',
    });
    expect(r.stale).toBe(true);
  });
  it('is not stale when the version matches (to the millisecond)', () => {
    expect(
      classifyResultValueSave(stored(), {
        observed1: '130',
        loadedUpdatedAt: UPDATED.toISOString(),
      }).stale,
    ).toBe(false);
  });
  it('skips the check when the client sent no version', () => {
    expect(classifyResultValueSave(stored(), { observed1: '130' }).stale).toBe(
      false,
    );
  });
  it("never flags a value that is not the analyzer's", () => {
    expect(
      classifyResultValueSave(stored({ source: ResultValueSource.MANUAL }), {
        observed1: '5',
        loadedUpdatedAt: '2000-01-01T00:00:00.000Z',
      }).stale,
    ).toBe(false);
  });
});

describe('describeAnalyzerOverwrite', () => {
  it('shows the old and new value with the analyzer name', () => {
    expect(
      describeAnalyzerOverwrite(
        'Hemoglobin',
        'Cobas',
        { observed1: '130', observed2: null, unit: 'g/L' },
        { observed1: '13.5', unit: 'g/dL' },
      ),
    ).toBe(
      'Analyzer result overwritten — Hemoglobin: 130 g/L (from Cobas) → 13.5 g/dL',
    );
  });
  it('says when only the range or unit was edited', () => {
    const note = describeAnalyzerOverwrite(
      'pH',
      undefined,
      { observed1: '6.5', observed2: null, unit: null },
      { observed1: '6.5' },
    );
    expect(note).toContain('(from analyzer)');
    expect(note).toContain('value unchanged');
  });
  it('shows an emptied value and Observed 2', () => {
    expect(
      describeAnalyzerOverwrite(
        'WBC',
        'Sysmex',
        { observed1: '7.2', observed2: '7.4', unit: '10^3/uL' },
        { observed1: '' },
      ),
    ).toContain('7.2 / 7.4 10^3/uL (from Sysmex) → (empty) / 7.4 10^3/uL');
  });
});
