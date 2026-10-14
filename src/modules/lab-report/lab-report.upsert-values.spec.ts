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
  it("stores it as the technician's and writes an Audit Trail entry", async () => {
    const m = build([machine(P1)]);
    await save(m, [{ resultParamId: P1, observed1: '13.5', unit: 'g/dL' }]);
    const up = m.labReportResultValue.upsert.mock.calls[0]![0];
    expect(up.update).toMatchObject({
      observed1: '13.5',
      source: ResultValueSource.MANUAL,
      enteredBy: ACTOR,
    });
    const h = m.labReportHistory.create.mock.calls[0]![0].data;
    expect(h).toMatchObject({
      tenantId: T,
      labReportId: 'r1',
      action: 'ANALYZER_VALUE_OVERWRITTEN',
      actorId: ACTOR,
      fromStatus: 'SAVED',
      toStatus: 'SAVED',
    });
    expect(h.notes).toBe(
      'Analyzer result overwritten — Hemoglobin: 130 g/L (from Cobas) → 13.5 g/dL',
    );
  });

  it('the "confirmed" flag makes it the technician\'s even with the same number (range-only change)', async () => {
    const m = build([machine(P1)]);
    await save(m, [
      {
        resultParamId: P1,
        observed1: '130',
        overridesAnalyzer: true,
        referenceRangeId: 'other',
      },
    ]);
    expect(
      m.labReportResultValue.upsert.mock.calls[0]![0].update,
    ).toMatchObject({ source: ResultValueSource.MANUAL, observed1: '130' });
    expect(m.labReportHistory.create.mock.calls[0]![0].data.notes).toContain(
      'value unchanged',
    );
  });

  it('a change without the flag (a direct API call) is accepted and logged', async () => {
    const m = build([machine(P1)]);
    await save(m, [{ resultParamId: P1, observed1: '999' }]);
    expect(m.labReportResultValue.upsert).toHaveBeenCalledTimes(1);
    expect(m.labReportHistory.create).toHaveBeenCalledTimes(1);
  });

  it('one entry per overwritten value; untouched analyzer values in the same save stay', async () => {
    const m = build([machine(P1), machine(P2, { observed1: '7.2' })]);
    await save(m, [
      { resultParamId: P1, observed1: '131' },
      { resultParamId: P2, observed1: '7.2' },
    ]);
    expect(m.labReportResultValue.upsert).toHaveBeenCalledTimes(1);
    expect(m.labReportHistory.create).toHaveBeenCalledTimes(1);
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
    expect(m.labReportResultValue.upsert).toHaveBeenCalledTimes(1);
  });

  it('is not checked when the client sent no version (older screens)', async () => {
    const m = build([machine(P1)]);
    await save(m, [{ resultParamId: P1, observed1: '131' }]);
    expect(m.labReportResultValue.upsert).toHaveBeenCalledTimes(1);
  });
});
