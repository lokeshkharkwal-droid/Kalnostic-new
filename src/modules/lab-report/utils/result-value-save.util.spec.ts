import { ResultValueSource } from '@prisma/client';
import {
  classifyResultValueSave,
  describeAnalyzerOverwrite,
  describeRangeForAudit,
  formatMomentForAudit,
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

  it('the "confirmed" flag with the same number is an edit only when the Range really changed', () => {
    expect(
      classifyResultValueSave(stored({ referenceRangeId: 'r1' }), {
        observed1: '130',
        referenceRangeId: 'r2',
        overridesAnalyzer: true,
      }).mode,
    ).toBe('overwrite-analyzer');
    // a Range chosen where none was stored is a change too
    expect(
      classifyResultValueSave(stored({ referenceRangeId: null }), {
        observed1: '130',
        referenceRangeId: 'r1',
        overridesAnalyzer: true,
      }).mode,
    ).toBe('overwrite-analyzer');
  });

  it('the "confirmed" flag with the same number is an edit when an existing unit really changed', () => {
    expect(
      classifyResultValueSave(stored({ unit: 'g/L' }), {
        observed1: '130',
        unit: 'g/dL',
        overridesAnalyzer: true,
      }).mode,
    ).toBe('overwrite-analyzer');
  });

  it('the same confirmed edit sent AGAIN (retry, double click) is not an edit: same number, same Range, same unit', () => {
    expect(
      classifyResultValueSave(
        stored({ observed1: '7.7', unit: 'pH', referenceRangeId: 'r1' }),
        {
          observed1: '7.7',
          unit: 'pH',
          referenceRangeId: 'r1',
          overridesAnalyzer: true,
        },
      ).mode,
    ).toBe('keep-analyzer');
  });

  it('the flag alone changes nothing: no Range or unit sent, or the unit is only being filled in from the Range', () => {
    expect(
      classifyResultValueSave(stored(), {
        observed1: '130',
        overridesAnalyzer: true,
      }).mode,
    ).toBe('keep-analyzer');
    expect(
      classifyResultValueSave(stored({ unit: null }), {
        observed1: '130',
        unit: 'g/dL',
        overridesAnalyzer: true,
      }).mode,
    ).toBe('keep-analyzer');
  });

  it('a Range or unit that differs WITHOUT the flag is still not an edit (the screen fills them in on its own)', () => {
    expect(
      classifyResultValueSave(stored({ referenceRangeId: 'r1', unit: 'g/L' }), {
        observed1: '130',
        referenceRangeId: 'r2',
        unit: 'g/dL',
      }).mode,
    ).toBe('keep-analyzer');
  });

  it('a changed number is always an edit, flag or not', () => {
    expect(
      classifyResultValueSave(stored({ referenceRangeId: 'r1' }), {
        observed1: '131',
        referenceRangeId: 'r1',
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
    ).toBe('Value edited — Hemoglobin: 130 g/L → 13.5 g/dL (analyzer: Cobas)');
  });
  it('says when the analyzer sent the value, when that is known', () => {
    expect(
      describeAnalyzerOverwrite(
        'Hemoglobin',
        'Cobas',
        { observed1: '130', observed2: null, unit: 'g/L' },
        { observed1: '13.5', unit: 'g/dL' },
        '12 Oct 2026, 03:30 pm',
      ),
    ).toBe(
      'Value edited — Hemoglobin: 130 g/L → 13.5 g/dL (analyzer: Cobas, sent 12 Oct 2026, 03:30 pm)',
    );
  });
  it('says when only the range or unit was edited', () => {
    const note = describeAnalyzerOverwrite(
      'pH',
      undefined,
      { observed1: '6.5', observed2: null, unit: null },
      { observed1: '6.5' },
    );
    expect(note).toContain('(analyzer: unknown)');
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
    ).toContain('7.2 / 7.4 10^3/uL → (empty) / 7.4 10^3/uL (analyzer: Sysmex)');
  });
});

describe('formatMomentForAudit', () => {
  it("writes the moment in the lab's own time zone", () => {
    const at = new Date('2026-10-12T10:00:00.000Z');
    expect(formatMomentForAudit(at, 'UTC')).toContain('12 Oct 2026, 10:00');
    expect(formatMomentForAudit(at, 'Asia/Kolkata')).toContain(
      '12 Oct 2026, 03:30',
    );
  });
  it('falls back to the ISO text when the time zone is not known', () => {
    const at = new Date('2026-10-12T10:00:00.000Z');
    expect(formatMomentForAudit(at, 'Not/AZone')).toBe(
      '2026-10-12T10:00:00.000Z',
    );
  });
});

describe('describeRangeForAudit', () => {
  it('names the analyzer, method, unit and display text', () => {
    expect(
      describeRangeForAudit(
        {
          method: 'Refractometry',
          unit: 'g/mL',
          displayOfReferenceRange: '1.010 - 1.030 (Analyzer default)',
        },
        'Hematology Bridge 1',
      ),
    ).toBe(
      'Hematology Bridge 1 · Refractometry · g/mL · 1.010 - 1.030 (Analyzer default)',
    );
  });
  it('leaves out what is empty (a range with no analyzer, no method)', () => {
    expect(
      describeRangeForAudit({
        unit: 'g/mL',
        displayOfReferenceRange: '1.015 - 1.035 (Adult)',
      }),
    ).toBe('g/mL · 1.015 - 1.035 (Adult)');
    expect(
      describeRangeForAudit({
        method: '  ',
        unit: null,
        displayOfReferenceRange: '12 - 17',
      }),
    ).toBe('12 - 17');
  });
  it('falls back to the limits when there is no display text', () => {
    expect(
      describeRangeForAudit({
        unit: 'g/L',
        lowerLimit: '120',
        upperLimit: '170',
      }),
    ).toBe('g/L · 120 - 170');
    expect(
      describeRangeForAudit({ unit: 'g/L', lowerLimit: null, upperLimit: 170 }),
    ).toBe('g/L · - 170');
  });
  it('says so when there is no range at all', () => {
    expect(describeRangeForAudit(undefined)).toBe('(no range)');
    expect(describeRangeForAudit({})).toBe('(no range)');
  });
});

describe('describeAnalyzerOverwrite — when the RANGE was changed', () => {
  const before = 'Cobas · Refractometry · g/mL · 1.010 - 1.030 (Default)';
  const after = 'Refractometry · g/mL · 1.015 - 1.035 (Adult)';

  it('number unchanged, same unit: names both ranges and says the result was kept', () => {
    expect(
      describeAnalyzerOverwrite(
        'Specific Gravity',
        'Cobas',
        { observed1: '1.025', observed2: null, unit: 'g/mL' },
        { observed1: '1.025', unit: 'g/mL' },
        '01 Nov 2026, 05:18 pm',
        { before, after },
      ),
    ).toBe(
      `Range changed — Specific Gravity: ${before} → ${after}; result 1.025 g/mL kept (analyzer: Cobas, sent 01 Nov 2026, 05:18 pm)`,
    );
  });

  it('number unchanged, unit changed: says the unit moved and that the number was kept, not converted', () => {
    expect(
      describeAnalyzerOverwrite(
        'Specific Gravity',
        'Cobas',
        { observed1: '1.025', observed2: null, unit: 'g/mL' },
        { observed1: '1.025', unit: 'g/dL' },
        undefined,
        { before, after: 'Cobas · g/dL · 1.000 - 1.200' },
      ),
    ).toBe(
      `Range changed — Specific Gravity: ${before} → Cobas · g/dL · 1.000 - 1.200; result 1.025 kept (unit g/mL → g/dL) (analyzer: Cobas)`,
    );
  });

  it('keeps Observed 2 in the kept result', () => {
    expect(
      describeAnalyzerOverwrite(
        'WBC',
        'Sysmex',
        { observed1: '7.2', observed2: '7.4', unit: '10^3/uL' },
        { observed1: '7.2', observed2: '7.4' },
        undefined,
        { before: '(no range)', after: 'Sysmex · 4.0 - 11.0' },
      ),
    ).toContain('result 7.2 / 7.4 10^3/uL kept');
  });

  it('number changed as well: one entry that shows both edits', () => {
    expect(
      describeAnalyzerOverwrite(
        'Hemoglobin',
        'Cobas',
        { observed1: '130', observed2: null, unit: 'g/L' },
        { observed1: '13.5', unit: 'g/dL' },
        undefined,
        { before: '(no range)', after: 'g/dL · 12 - 17' },
      ),
    ).toBe(
      'Value and range edited — Hemoglobin: 130 g/L → 13.5 g/dL; range (no range) → g/dL · 12 - 17 (analyzer: Cobas)',
    );
  });

  it('without the ranges (range not changed) the older wording is unchanged', () => {
    expect(
      describeAnalyzerOverwrite(
        'Hemoglobin',
        'Cobas',
        { observed1: '130', observed2: null, unit: 'g/L' },
        { observed1: '13.5', unit: 'g/dL' },
      ),
    ).toBe('Value edited — Hemoglobin: 130 g/L → 13.5 g/dL (analyzer: Cobas)');
  });
});
