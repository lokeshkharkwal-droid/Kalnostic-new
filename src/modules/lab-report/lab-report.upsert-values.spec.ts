import { ResultValueSource } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import {
  InvalidResultParamException,
  LabReportValueChangedException,
} from './exceptions/lab-report.exceptions';
import type { UpsertResultValuesDto } from './dto/upsert-result-values.dto';

/**
 * Technician Reporting — saving results (`PATCH /lab-reports/:id/results`).
 *  - an analyzer's value the technician did not change STAYS the analyzer's (source, analyzer
 *    id, time) after a Save — it used to be re-labelled as the technician's;
 *  - a value the technician changed becomes theirs and is recorded in the Audit Trail;
 *  - a screen that is out of date for an analyzer value is refused and nothing is written.
 */
const T = 't1';
const B = 'b1';
const ACTOR = 'person-1';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const UPDATED = new Date('2026-10-12T10:00:00.000Z');

type StoredRow = {
  resultParamId: string;
  source: ResultValueSource;
  observed1: string | null;
  observed2: string | null;
  unit: string | null;
  enteredBy: string | null;
  enteredAt: Date;
  referenceRangeId?: string | null;
  updatedAt: Date;
  deletedAt: Date | null;
};
const machine = (
  resultParamId: string,
  over: Partial<StoredRow> = {},
): StoredRow => ({
  resultParamId,
  source: ResultValueSource.ADAPTER,
  observed1: '130',
  observed2: null,
  unit: 'g/L',
  enteredBy: 'adapter-1',
  enteredAt: UPDATED,
  updatedAt: UPDATED,
  deletedAt: null,
  ...over,
});

type Fields = Record<string, unknown>;
type WriteCall = {
  where: Fields;
  data?: Fields;
  create?: Fields;
  update?: Fields;
};

function build(stored: StoredRow[] = []) {
  const labReportResultValue = {
    findMany: jest.fn().mockResolvedValue(stored),
    update: jest.fn<Promise<unknown>, [WriteCall]>().mockResolvedValue({}),
    upsert: jest.fn<Promise<unknown>, [WriteCall]>().mockResolvedValue({}),
  };
  const labReportHistory = {
    create: jest
      .fn<Promise<unknown>, [{ data: Fields }]>()
      .mockResolvedValue({}),
  };
  const labAdapter = {
    findMany: jest.fn().mockResolvedValue([{ id: 'adapter-1', name: 'Cobas' }]),
  };
  const tx = { labReportResultValue, labReportHistory, labAdapter };
  const prisma = {
    labReport: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'r1',
        orderItemId: 'oi1',
        labTestId: 'lt1',
        isLocked: false,
        status: 'SAVED',
      }),
    },
    orderSampleTest: { findFirst: jest.fn().mockResolvedValue({ id: 's' }) },
    orderItem: {
      findUnique: jest.fn().mockResolvedValue({ branchLabPanelId: null }),
    },
    withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const deps = Array(11).fill(undefined) as unknown[];
  deps[0] = prisma;
  const tenantService = {
    getLocale: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
  };
  deps[7] = tenantService;
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );
  const internals = service as unknown as Record<string, jest.Mock>;
  internals.getResultParams = jest.fn().mockResolvedValue([
    { id: P1, parameterName: 'Hemoglobin' },
    { id: P2, parameterName: 'WBC' },
  ]);
  internals.recomputeCalculatedValues = jest.fn().mockResolvedValue(undefined);
  internals.findByIdForApi = jest.fn().mockResolvedValue({ id: 'r1' });
  return {
    service,
    labReportResultValue,
    labReportHistory,
    labAdapter,
    prisma,
    tenantService,
  };
}

const save = (
  m: ReturnType<typeof build>,
  values: UpsertResultValuesDto['values'],
) => m.service.upsertResultValues('r1', T, B, { values }, ACTOR);

describe('upsertResultValues — an analyzer value the technician left alone', () => {
  it('stays the analyzer value: no re-labelling, no new author, no history', async () => {
    const m = build([machine(P1)]);
    await save(m, [
      {
        resultParamId: P1,
        observed1: '130',
        referenceRangeId: 'rng-1',
        referenceDisplay: '12 - 17',
      },
    ]);
    expect(m.labReportResultValue.upsert).not.toHaveBeenCalled();
    const update = m.labReportResultValue.update.mock.calls[0]![0];
    expect(update.data).toEqual({
      referenceRangeId: 'rng-1',
      referenceDisplay: '12 - 17',
    });
    expect(update.data).not.toHaveProperty('source');
    expect(update.data).not.toHaveProperty('enteredBy');
    expect(update.data).not.toHaveProperty('enteredAt');
    expect(m.labReportHistory.create).not.toHaveBeenCalled();
  });

  it("keeps the analyzer's unit; fills a unit only when the analyzer sent none", async () => {
    const withUnit = build([machine(P1, { unit: 'g/L' })]);
    await save(withUnit, [
      {
        resultParamId: P1,
        observed1: '130',
        unit: 'g/dL',
        referenceRangeId: 'r',
      },
    ]);
    expect(
      withUnit.labReportResultValue.update.mock.calls[0]![0].data,
    ).not.toHaveProperty('unit');

    const noUnit = build([machine(P1, { unit: null })]);
    await save(noUnit, [{ resultParamId: P1, observed1: '130', unit: 'g/dL' }]);
    expect(
      noUnit.labReportResultValue.update.mock.calls[0]![0].data,
    ).toMatchObject({ unit: 'g/dL' });
  });

  it('does not touch the row at all when nothing it may update was sent', async () => {
    const m = build([machine(P1)]);
    await save(m, [{ resultParamId: P1, observed1: '130' }]);
    expect(m.labReportResultValue.update).not.toHaveBeenCalled();
    expect(m.labReportResultValue.upsert).not.toHaveBeenCalled();
  });

  it('the unit being filled in from the range does not count as a change', async () => {
    const m = build([machine(P1, { unit: null })]);
    await save(m, [
      {
        resultParamId: P1,
        observed1: '130',
        unit: 'g/dL',
        referenceRangeId: 'r',
      },
    ]);
    expect(m.labReportResultValue.upsert).not.toHaveBeenCalled();
  });
});

describe('upsertResultValues — the technician changed an analyzer value', () => {
  it('stores the new value but the row stays the analyzer’s, and writes an Audit Trail entry (who, when, old → new)', async () => {
    const m = build([machine(P1)]);
    await save(m, [{ resultParamId: P1, observed1: '13.5', unit: 'g/dL' }]);
    expect(m.labReportResultValue.upsert).not.toHaveBeenCalled();
    const update = m.labReportResultValue.update.mock.calls[0]![0];
    expect(update.data).toMatchObject({ observed1: '13.5', unit: 'g/dL' });
    // Entered by / source / time of the analyzer are never changed by an edit.
    expect(update.data).not.toHaveProperty('source');
    expect(update.data).not.toHaveProperty('enteredBy');
    expect(update.data).not.toHaveProperty('enteredAt');
    const h = m.labReportHistory.create.mock.calls[0]![0].data;
    expect(h).toMatchObject({
      tenantId: T,
      labReportId: 'r1',
      action: 'ANALYZER_VALUE_OVERWRITTEN',
      actorId: ACTOR,
      fromStatus: 'SAVED',
      toStatus: 'SAVED',
    });
    // Who and when come from the entry itself (actor, time); the text says what changed and
    // when the analyzer sent the value (its own stored time, shown in the lab's time zone).
    expect(h.notes).toContain(
      'Value edited — Hemoglobin: 130 g/L → 13.5 g/dL (analyzer: Cobas, sent 12 Oct 2026, 10:00',
    );
  });

  it('every later edit of the same value is recorded too (the history keeps each change)', async () => {
    const first = build([machine(P1)]);
    await save(first, [{ resultParamId: P1, observed1: '131' }]);
    // The row is still the analyzer's after the first edit, so the second edit is a change again.
    const second = build([machine(P1, { observed1: '131' })]);
    await save(second, [{ resultParamId: P1, observed1: '132' }]);
    expect(
      first.labReportHistory.create.mock.calls[0]![0].data.notes,
    ).toContain('130 g/L → 131 g/L');
    expect(
      second.labReportHistory.create.mock.calls[0]![0].data.notes,
    ).toContain('131 g/L → 132 g/L');
    expect(second.labReportResultValue.upsert).not.toHaveBeenCalled();
  });

  it('the "confirmed" flag records the edit even with the same number (range-only change)', async () => {
    const m = build([machine(P1)]);
    await save(m, [
      {
        resultParamId: P1,
        observed1: '130',
        overridesAnalyzer: true,
        referenceRangeId: 'other',
      },
    ]);
    expect(m.labReportResultValue.upsert).not.toHaveBeenCalled();
    const update = m.labReportResultValue.update.mock.calls[0]![0];
    expect(update.data).toMatchObject({
      observed1: '130',
      referenceRangeId: 'other',
    });
    expect(update.data).not.toHaveProperty('enteredBy');
    expect(m.labReportHistory.create.mock.calls[0]![0].data.notes).toContain(
      'value unchanged',
    );
  });

  it('the same confirmed edit sent again (retry / double click) writes NO second entry', async () => {
    // What is stored after the first request: the new number, the new unit and the chosen Range.
    const m = build([
      machine(P1, { observed1: '7.7', unit: 'pH', referenceRangeId: 'r1' }),
    ]);
    await save(m, [
      {
        resultParamId: P1,
        observed1: '7.7',
        unit: 'pH',
        referenceRangeId: 'r1',
        overridesAnalyzer: true,
      },
    ]);
    expect(m.labReportHistory.create).not.toHaveBeenCalled();
    expect(m.labReportResultValue.upsert).not.toHaveBeenCalled();
  });

  it('a confirmed save whose Range differs from the stored one still writes an entry', async () => {
    const m = build([machine(P1, { referenceRangeId: 'r1' })]);
    await save(m, [
      {
        resultParamId: P1,
        observed1: '130',
        referenceRangeId: 'r2',
        overridesAnalyzer: true,
      },
    ]);
    expect(m.labReportHistory.create).toHaveBeenCalledTimes(1);
    expect(m.labReportHistory.create.mock.calls[0]![0].data.notes).toContain(
      'value unchanged',
    );
  });

  it('the lab time zone is read once for several saves (remembered), not on every save', async () => {
    const m = build([machine(P1)]);
    await save(m, [{ resultParamId: P1, observed1: '131' }]);
    await save(m, [{ resultParamId: P1, observed1: '132' }]);
    await save(m, [{ resultParamId: P1, observed1: '133' }]);
    expect(m.tenantService.getLocale).toHaveBeenCalledTimes(1);
  });

  it('a change without the flag (a direct API call) is accepted and logged', async () => {
    const m = build([machine(P1)]);
    await save(m, [{ resultParamId: P1, observed1: '999' }]);
    expect(m.labReportResultValue.update).toHaveBeenCalledTimes(1);
    expect(m.labReportHistory.create).toHaveBeenCalledTimes(1);
  });

  it('one entry per edited value; untouched analyzer values in the same save get no entry', async () => {
    const m = build([machine(P1), machine(P2, { observed1: '7.2' })]);
    await save(m, [
      { resultParamId: P1, observed1: '131' },
      { resultParamId: P2, observed1: '7.2' },
    ]);
    expect(m.labReportHistory.create).toHaveBeenCalledTimes(1);
    expect(m.labReportResultValue.upsert).not.toHaveBeenCalled();
  });
});

describe('upsertResultValues — ordinary saves are unchanged', () => {
  it.each([
    ['nothing stored yet', [] as StoredRow[]],
    [
      "already the technician's",
      [machine(P1, { source: ResultValueSource.MANUAL })],
    ],
    [
      'a deleted analyzer value (re-run reset)',
      [machine(P1, { deletedAt: new Date() })],
    ],
  ])("%s: saved as the technician's, no history", async (_label, stored) => {
    const m = build(stored);
    await save(m, [{ resultParamId: P1, observed1: '5' }]);
    const up = m.labReportResultValue.upsert.mock.calls[0]![0];
    expect(up.create).toMatchObject({
      source: ResultValueSource.MANUAL,
      enteredBy: ACTOR,
    });
    expect(up.update).toMatchObject({
      source: ResultValueSource.MANUAL,
      deletedAt: null,
    });
    expect(m.labReportHistory.create).not.toHaveBeenCalled();
  });

  it('still rejects a parameter that is not part of this report', async () => {
    const m = build();
    await expect(
      save(m, [
        {
          resultParamId: '33333333-3333-4333-8333-333333333333',
          observed1: '1',
        },
      ]),
    ).rejects.toBeInstanceOf(InvalidResultParamException);
    expect(m.prisma.withTenant).not.toHaveBeenCalled();
  });

  it('recomputes calculated values after the save as before', async () => {
    const m = build([machine(P1)]);
    await save(m, [{ resultParamId: P1, observed1: '130' }]);
    expect(
      (m.service as unknown as Record<string, jest.Mock>)
        .recomputeCalculatedValues,
    ).toHaveBeenCalledTimes(1);
  });
});

describe('upsertResultValues — a result is stored exactly as typed', () => {
  // A Qualitative result is free text the user lays out by hand: nothing may trim, collapse or re-flow it.
  const TYPED = [
    '  leading spaces',
    '',
    '',
    'tab\there',
    '    - indented',
    'two  spaces  inside',
    'trailing spaces  ',
    '',
  ].join('\n');

  it.each([
    ['a layout with blank lines, tabs and indentation', TYPED],
    ['Windows line endings', 'line one\r\nline two\r\n'],
    ['only whitespace', '   \n  \n'],
    ['markup and symbols', '<b>x</b> & y \u00b1 5 \u2192 \u201cquote\u201d'],
  ])('%s', async (_label, typed) => {
    const m = build([]);
    await save(m, [{ resultParamId: P1, observed1: typed }]);
    const up = m.labReportResultValue.upsert.mock.calls[0]![0];
    expect(up.create?.observed1).toBe(typed);
    expect(up.update?.observed1).toBe(typed);
  });

  it('a long text (5 000 lines) is stored whole', async () => {
    const long = Array.from(
      { length: 5000 },
      (_, i) => 'line ' + i + ' ' + 'x'.repeat(10),
    ).join('\n');
    const m = build([]);
    await save(m, [{ resultParamId: P1, observed1: long }]);
    expect(
      m.labReportResultValue.upsert.mock.calls[0]![0].create?.observed1,
    ).toBe(long);
  });
});

describe('upsertResultValues — a screen that is out of date', () => {
  it('is refused with nothing written when the analyzer re-sent after the screen loaded', async () => {
    const m = build([machine(P1), machine(P2, { observed1: '7.2' })]);
    await expect(
      save(m, [
        {
          resultParamId: P1,
          observed1: '130',
          loadedUpdatedAt: '2026-10-12T09:00:00.000Z',
        },
        {
          resultParamId: P2,
          observed1: '8.0',
          loadedUpdatedAt: UPDATED.toISOString(),
        },
      ]),
    ).rejects.toBeInstanceOf(LabReportValueChangedException);
    expect(m.labReportResultValue.upsert).not.toHaveBeenCalled();
    expect(m.labReportResultValue.update).not.toHaveBeenCalled();
    expect(m.labReportHistory.create).not.toHaveBeenCalled();
  });

  it('is accepted when the version matches', async () => {
    const m = build([machine(P1)]);
    await save(m, [
      {
        resultParamId: P1,
        observed1: '131',
        loadedUpdatedAt: UPDATED.toISOString(),
      },
    ]);
    // The edited value is written in place: the row stays the analyzer's (no upsert, no new author).
    expect(m.labReportResultValue.update).toHaveBeenCalledTimes(1);
    expect(m.labReportResultValue.update.mock.calls[0]![0].data).toMatchObject({
      observed1: '131',
    });
    expect(m.labReportResultValue.upsert).not.toHaveBeenCalled();
  });

  it('is not checked when the client sent no version (older screens)', async () => {
    const m = build([machine(P1)]);
    await save(m, [{ resultParamId: P1, observed1: '131' }]);
    expect(m.labReportResultValue.update).toHaveBeenCalledTimes(1);
    expect(m.labReportResultValue.update.mock.calls[0]![0].data).toMatchObject({
      observed1: '131',
    });
    expect(m.labReportResultValue.upsert).not.toHaveBeenCalled();
  });
});
