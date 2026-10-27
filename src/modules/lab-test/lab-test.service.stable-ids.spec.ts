import { AbnormalFlag, AgeUnit, Prisma, ReferenceGender } from '@prisma/client';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from './lab-test.service';

/**
 * Add/Edit Test save, two guarantees:
 *  1. A reference range whose meaning did not change keeps its row and id, so a report that already picked it
 *     still points at a live range. Only a changed/removed range is soft-deleted and a changed/added one created.
 *     A parameter keeps its id across a rename (the editor echoes the id back), so results already entered for it
 *     stay attached.
 *  2. Two ranges with the same analyzer, method, unit, gender and age band are allowed when their lower or upper
 *     limit differs (a copy whose limits were changed); identical limits and partial overlaps are still refused.
 *     The Excel import keeps its strict behaviour.
 */
type Fields = Record<string, unknown>;
type Where = { where: Fields; data?: Fields };

const Y = AgeUnit.YEARS;
const ALL = ReferenceGender.ALL;
const dec = (v: string) => new Prisma.Decimal(v);

function build(
  opts: {
    params?: Array<{ id: string; parameterCode: string }>;
    ranges?: Fields[];
  } = {},
) {
  const order: string[] = [];
  const labTestResultParam = {
    findMany: jest
      .fn()
      .mockResolvedValue(opts.params ?? [{ id: 'p1', parameterCode: 'HB' }]),
    update: jest.fn<Promise<unknown>, [Where]>().mockImplementation(() => {
      order.push('param.update');
      return Promise.resolve({});
    }),
    create: jest
      .fn<Promise<unknown>, [{ data: Fields }]>()
      .mockImplementation(() => {
        order.push('param.create');
        return Promise.resolve({ id: 'p-new' });
      }),
    updateMany: jest.fn<Promise<unknown>, [Where]>().mockResolvedValue({}),
  };
  const labTestReferenceRange = {
    findMany: jest
      .fn<Promise<unknown>, [Where]>()
      .mockResolvedValue(opts.ranges ?? []),
    update: jest.fn<Promise<unknown>, [Where]>().mockResolvedValue({}),
    updateMany: jest.fn<Promise<unknown>, [Where]>().mockResolvedValue({}),
    createMany: jest
      .fn<Promise<unknown>, [{ data: Fields[] }]>()
      .mockResolvedValue({}),
  };
  const labTestReferenceValue = {
    updateMany: jest.fn().mockResolvedValue({}),
    createMany: jest.fn().mockResolvedValue({}),
  };
  const tx = {
    labTestResultParam,
    labTestReferenceRange,
    labTestReferenceValue,
  };
  const service = new LabTestService(
    {} as unknown as PrismaService,
    {} as unknown as MasterDataService,
  );
  const priv = service as unknown as {
    upsertParamsByCode: (...a: unknown[]) => Promise<void>;
    createParams: (...a: unknown[]) => Promise<void>;
    assertParam: (p: unknown) => void;
    assertImportParam: (p: unknown) => void;
    assertNoRangeOverlap: (r: unknown[], code: string) => void;
  };
  const save = (params: unknown[]): Promise<void> =>
    priv.upsertParamsByCode(
      tx,
      't1',
      'b1',
      'lt1',
      params,
      new Date('2026-10-20'),
    );
  return {
    save,
    priv,
    tx,
    order,
    labTestResultParam,
    labTestReferenceRange,
    labTestReferenceValue,
  };
}

/** A range as the editor sends it. */
const sent = (over: Fields = {}): Fields => ({
  gender: ALL,
  ageFrom: 0,
  ageFromUnit: Y,
  ageTo: 999,
  ageToUnit: Y,
  method: 'SLS',
  unit: 'g/dL',
  lowerLimit: 12,
  upperLimit: 16,
  ...over,
});
/** The same range as the database returns it (limits are Decimals, defaults filled in). */
const live = (id: string, over: Fields = {}): Fields => ({
  id,
  paramId: 'p1',
  labAdapterId: null,
  isDefault: false,
  displayOfReferenceRange: null,
  criticalMin: null,
  criticalMax: null,
  abnormalFlagLogic: AbnormalFlag.BOLD_AND_RED,
  ...sent(),
  lowerLimit: dec('12.0000'),
  upperLimit: dec('16.0000'),
  ...over,
});
const param = (over: Fields = {}) => ({
  parameterCode: 'HB',
  parameterName: 'Hemoglobin',
  referenceRanges: [sent()],
  ...over,
});
const rangeWrites = (m: ReturnType<typeof build>) => ({
  updated: m.labTestReferenceRange.update.mock.calls.map((c) => c[0]),
  softDeleted: m.labTestReferenceRange.updateMany.mock.calls.map((c) => c[0]),
  created: m.labTestReferenceRange.createMany.mock.calls.map((c) => c[0].data),
});

describe('a range that did not change keeps its row and id', () => {
  it('writes nothing for an unchanged range (limits compared as Decimals)', async () => {
    const m = build({ ranges: [live('r1')] });
    await m.save([param()]);
    expect(rangeWrites(m)).toEqual({
      updated: [],
      softDeleted: [],
      created: [],
    });
  });

  it('a value the editor leaves out equals the database default (gender, age band, flag)', async () => {
    const m = build({ ranges: [live('r1')] });
    await m.save([
      param({
        referenceRanges: [
          { method: 'SLS', unit: 'g/dL', lowerLimit: 12, upperLimit: 16 },
        ],
      }),
    ]);
    expect(rangeWrites(m)).toEqual({
      updated: [],
      softDeleted: [],
      created: [],
    });
  });

  it('a changed limit soft-deletes only that range (by id) and creates the new one; the other range is untouched', async () => {
    const m = build({
      ranges: [
        live('r1'),
        live('r2', {
          gender: ReferenceGender.MALE,
          lowerLimit: dec('13'),
          upperLimit: dec('18'),
        }),
      ],
    });
    await m.save([
      param({
        referenceRanges: [
          sent({ lowerLimit: 11 }),
          sent({
            gender: ReferenceGender.MALE,
            lowerLimit: 13,
            upperLimit: 18,
          }),
        ],
      }),
    ]);
    const w = rangeWrites(m);
    expect(w.updated).toEqual([]);
    expect(w.softDeleted).toHaveLength(1);
    expect(w.softDeleted[0]!.where).toEqual({
      id: { in: ['r1'] },
      deletedAt: null,
    });
    expect(w.softDeleted[0]!.data).toEqual({
      deletedAt: new Date('2026-10-20'),
    });
    expect(w.created).toHaveLength(1);
    expect(w.created[0]).toHaveLength(1);
    expect(w.created[0]![0]).toMatchObject({
      lowerLimit: 11,
      upperLimit: 16,
      paramId: 'p1',
      labTestId: 'lt1',
      tenantId: 't1',
      branchId: 'b1',
    });
  });

  it('a removed range is soft-deleted and nothing is created', async () => {
    const m = build({ ranges: [live('r1'), live('r2', { method: 'Cyan' })] });
    await m.save([param()]);
    const w = rangeWrites(m);
    expect(w.softDeleted[0]!.where).toEqual({
      id: { in: ['r2'] },
      deletedAt: null,
    });
    expect(w.created).toEqual([]);
  });

  it('a different analyzer, unit, method or critical limit is a different range', async () => {
    for (const change of [
      { labAdapterId: 'A1' },
      { unit: 'g/L' },
      { method: 'Cyan' },
      { criticalMin: 5 },
      { abnormalFlagLogic: AbnormalFlag.ITALIC },
    ]) {
      const m = build({ ranges: [live('r1')] });
      await m.save([param({ referenceRanges: [sent(change)] })]);
      const w = rangeWrites(m);
      expect(w.softDeleted[0]!.where).toEqual({
        id: { in: ['r1'] },
        deletedAt: null,
      });
      expect(w.created[0]).toHaveLength(1);
    }
  });

  it('the Default flag and the Display text are patched in place: the range keeps its id', async () => {
    const m = build({ ranges: [live('r1')] });
    await m.save([
      param({
        referenceRanges: [
          sent({ isDefault: true, displayOfReferenceRange: '12 - 16' }),
        ],
      }),
    ]);
    const w = rangeWrites(m);
    expect(w.updated).toEqual([
      {
        where: { id: 'r1' },
        data: { isDefault: true, displayOfReferenceRange: '12 - 16' },
      },
    ]);
    expect(w.softDeleted).toEqual([]);
    expect(w.created).toEqual([]);
  });

  it('two ranges with the same key and different limits both keep their rows, in any order', async () => {
    const stored = [
      live('r1', { isDefault: true }),
      live('r2', { lowerLimit: dec('10'), upperLimit: dec('14') }),
    ];
    for (const incoming of [
      [sent({ isDefault: true }), sent({ lowerLimit: 10, upperLimit: 14 })],
      [sent({ lowerLimit: 10, upperLimit: 14 }), sent({ isDefault: true })],
    ]) {
      const m = build({ ranges: stored });
      await m.save([param({ referenceRanges: incoming })]);
      expect(rangeWrites(m)).toEqual({
        updated: [],
        softDeleted: [],
        created: [],
      });
    }
  });

  it('a live row is matched at most once: a repeated range in the payload gets its own new row', async () => {
    const m = build({ ranges: [live('r1')] });
    await m.save([param({ referenceRanges: [sent(), sent()] })]);
    const w = rangeWrites(m);
    expect(w.softDeleted).toEqual([]);
    expect(w.created[0]).toHaveLength(1);
  });

  it('a brand-new parameter has nothing to keep: its ranges are created as sent', async () => {
    const m = build({ params: [] });
    await m.save([
      param({ referenceRanges: [sent(), sent({ gender: 'MALE' })] }),
    ]);
    expect(m.labTestReferenceRange.findMany).not.toHaveBeenCalled();
    expect(rangeWrites(m).created[0]).toHaveLength(2);
  });
});

describe('a parameter keeps its id across a rename', () => {
  const dataOf = (m: ReturnType<typeof build>) =>
    m.labTestResultParam.update.mock.calls[0]![0].data!;

  it('an id that names a live parameter updates that parameter, even though its code changed', async () => {
    const m = build({ params: [{ id: 'p1', parameterCode: 'PH' }] });
    await m.save([
      param({ id: 'p1', parameterCode: 'PH2', referenceRanges: [] }),
    ]);
    expect(m.labTestResultParam.update.mock.calls[0]![0].where).toEqual({
      id: 'p1',
    });
    expect(dataOf(m)).toMatchObject({ parameterCode: 'PH2' });
    expect(m.labTestResultParam.create).not.toHaveBeenCalled();
    expect(m.labTestResultParam.updateMany).not.toHaveBeenCalled();
  });

  it('the client id is never written to a row (update or create)', async () => {
    const m = build({ params: [{ id: 'p1', parameterCode: 'HB' }] });
    await m.save([
      param({ id: 'p1' }),
      param({ id: 'client-made-up', parameterCode: 'NEW', parameterName: 'N' }),
    ]);
    expect(dataOf(m)).not.toHaveProperty('id');
    expect(
      m.labTestResultParam.create.mock.calls[0]![0].data,
    ).not.toHaveProperty('id');
  });

  it('a code a parameter gives up can be taken by a new parameter in the same save (renames run first)', async () => {
    const m = build({ params: [{ id: 'p1', parameterCode: 'PH' }] });
    await m.save([
      param({
        parameterCode: 'PH',
        parameterName: 'brand new',
        referenceRanges: [],
      }),
      param({ id: 'p1', parameterCode: 'PH2', referenceRanges: [] }),
    ]);
    expect(m.order).toEqual(['param.update', 'param.create']);
    expect(m.labTestResultParam.update.mock.calls[0]![0].where).toEqual({
      id: 'p1',
    });
    expect(m.labTestResultParam.create.mock.calls[0]![0].data).toMatchObject({
      parameterCode: 'PH',
      parameterName: 'brand new',
    });
  });

  it('an id that is not a live parameter of this test is ignored: the code decides, as before', async () => {
    const m = build({ params: [{ id: 'p1', parameterCode: 'HB' }] });
    await m.save([param({ id: 'belongs-to-another-test' })]);
    expect(m.labTestResultParam.update.mock.calls[0]![0].where).toEqual({
      id: 'p1',
    });
    expect(m.labTestResultParam.create).not.toHaveBeenCalled();
  });

  it('with no id the code still matches, ignoring letter case', async () => {
    const m = build({ params: [{ id: 'p1', parameterCode: 'HB' }] });
    await m.save([param({ parameterCode: 'hb' })]);
    expect(m.labTestResultParam.update.mock.calls[0]![0].where).toEqual({
      id: 'p1',
    });
  });

  it('a parameter nothing matched is soft-deleted with its ranges and values', async () => {
    const m = build({
      params: [
        { id: 'p1', parameterCode: 'HB' },
        { id: 'p2', parameterCode: 'PH' },
      ],
    });
    await m.save([param({ id: 'p1' })]);
    expect(m.labTestResultParam.updateMany.mock.calls[0]![0].where).toEqual({
      id: { in: ['p2'] },
    });
    expect(
      m.labTestReferenceRange.updateMany.mock.calls.some(
        (c) =>
          JSON.stringify(c[0].where) ===
          JSON.stringify({ paramId: { in: ['p2'] }, deletedAt: null }),
      ),
    ).toBe(true);
  });

  it('the same id sent twice is refused', async () => {
    const m = build({ params: [{ id: 'p1', parameterCode: 'HB' }] });
    await expect(
      m.save([param({ id: 'p1' }), param({ id: 'p1', parameterCode: 'X' })]),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(m.labTestResultParam.update).not.toHaveBeenCalled();
  });

  it('create never uses a client id either', async () => {
    const m = build();
    await m.priv.createParams(m.tx, 't1', 'b1', 'lt1', [
      { id: 'client-id', parameterCode: 'HB', parameterName: 'Hb' },
    ]);
    expect(
      m.labTestResultParam.create.mock.calls[0]![0].data,
    ).not.toHaveProperty('id');
  });
});

describe('the same analyzer, method, unit, gender and age band with different limits', () => {
  const m = build();
  const run = (fn: () => void): string => {
    try {
      fn();
      return 'ACCEPTED';
    } catch (e) {
      const body = (e as ValidationException).getResponse() as {
        error?: { message?: string };
      };
      return body?.error?.message ?? (e as Error).message;
    }
  };
  const save = (ranges: unknown[]) =>
    run(() =>
      m.priv.assertParam({ parameterCode: 'HB', referenceRanges: ranges }),
    );
  const SIMILAR = /similar reference range already exists/;

  it('is allowed when exactly one of them is the Default', () => {
    expect(
      save([
        sent({ isDefault: true }),
        sent({ lowerLimit: 10, upperLimit: 14 }),
      ]),
    ).toBe('ACCEPTED');
  });

  it('is allowed when only the lower, or only the upper, limit differs', () => {
    expect(save([sent({ isDefault: true }), sent({ lowerLimit: 10 })])).toBe(
      'ACCEPTED',
    );
    expect(save([sent({ isDefault: true }), sent({ upperLimit: 20 })])).toBe(
      'ACCEPTED',
    );
  });

  it('three of them are fine too, with one Default', () => {
    expect(
      save([
        sent({ isDefault: true }),
        sent({ lowerLimit: 10, upperLimit: 14 }),
        sent({ lowerLimit: 9, upperLimit: 13 }),
      ]),
    ).toBe('ACCEPTED');
  });

  it('still needs a Default: none is refused, two are refused', () => {
    expect(save([sent(), sent({ lowerLimit: 10, upperLimit: 14 })])).toMatch(
      /Mark a Default range/,
    );
    expect(
      save([
        sent({ isDefault: true }),
        sent({ isDefault: true, lowerLimit: 10, upperLimit: 14 }),
      ]),
    ).toMatch(/Only one range can be Default/);
  });

  it('identical limits are still "a similar range" (critical values and Display do not make a range different)', () => {
    expect(save([sent(), sent()])).toMatch(SIMILAR);
    expect(
      save([sent(), sent({ criticalMin: 5, displayOfReferenceRange: 'x' })]),
    ).toMatch(SIMILAR);
  });

  it('limits are compared to the 4 decimals the database stores', () => {
    expect(
      save([sent({ lowerLimit: 10 }), sent({ lowerLimit: 10.00001 })]),
    ).toMatch(SIMILAR);
    expect(
      save([sent({ isDefault: true }), sent({ lowerLimit: 10.0001 })]),
    ).toBe('ACCEPTED');
  });

  it('two of three with the same limits are still refused', () => {
    expect(
      save([
        sent({ isDefault: true }),
        sent({ lowerLimit: 10, upperLimit: 14 }),
        sent({ lowerLimit: 10, upperLimit: 14 }),
      ]),
    ).toMatch(SIMILAR);
  });

  it('a partial Gender or Age overlap is still "overlapping", whatever the limits', () => {
    expect(
      save([sent(), sent({ gender: ReferenceGender.MALE, lowerLimit: 10 })]),
    ).toMatch(/Overlapping reference range/);
    expect(
      save([
        sent({ ageFrom: 0, ageTo: 10 }),
        sent({ ageFrom: 5, ageTo: 20, lowerLimit: 10 }),
      ]),
    ).toMatch(/Overlapping reference range/);
  });

  it('a different method, unit or analyzer is still its own group (no Default needed for a group of one)', () => {
    expect(save([sent({ method: 'A' }), sent({ method: 'B' })])).toBe(
      'ACCEPTED',
    );
    expect(save([sent({ unit: 'g/L' }), sent({ unit: 'g/dL' })])).toBe(
      'ACCEPTED',
    );
  });

  it('the Excel import keeps refusing it', () => {
    expect(
      run(() =>
        m.priv.assertImportParam({
          parameterCode: 'HB',
          referenceRanges: [sent(), sent({ lowerLimit: 10, upperLimit: 14 })],
        }),
      ),
    ).toMatch(SIMILAR);
    expect(
      run(() =>
        m.priv.assertNoRangeOverlap(
          [sent(), sent({ lowerLimit: 10, upperLimit: 14 })],
          'HB',
        ),
      ),
    ).toMatch(SIMILAR);
  });
});
