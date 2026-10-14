import { AgeUnit, ReferenceGender } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from './lab-test.service';

/**
 * Re-importing a test from Excel must not erase what the sheet cannot carry. The import's update path
 * (`upsertParamsByCode(..., { fromImport: true })`) keeps analyzer-tied ranges, carries a range's unit and
 * Default flag over to the range that replaces it, and leaves reflex tests alone; the normal edit form path
 * (no options) behaves exactly as before.
 */
type Fields = Record<string, unknown>;
type Where = { where: Fields; data?: Fields };

const Y = AgeUnit.YEARS;
const M = AgeUnit.MONTHS;

function build(previousRanges: Fields[] = []) {
  const labTestResultParam = {
    findMany: jest.fn().mockResolvedValue([{ id: 'p1', parameterCode: 'HB' }]),
    update: jest.fn<Promise<unknown>, [Where]>().mockResolvedValue({}),
    create: jest
      .fn<Promise<unknown>, [{ data: Fields }]>()
      .mockResolvedValue({ id: 'p-new' }),
    updateMany: jest.fn().mockResolvedValue({}),
  };
  const labTestReferenceRange = {
    findMany: jest
      .fn<Promise<unknown>, [Where]>()
      .mockResolvedValue(previousRanges),
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
  const run = (
    params: unknown[],
    options?: { fromImport?: boolean },
  ): Promise<void> =>
    (
      service as unknown as {
        upsertParamsByCode: (...a: unknown[]) => Promise<void>;
      }
    ).upsertParamsByCode(
      tx,
      't1',
      'b1',
      'lt1',
      params,
      new Date('2026-10-12'),
      options,
    );
  return {
    run,
    labTestResultParam,
    labTestReferenceRange,
    labTestReferenceValue,
  };
}

const range = (over: Fields = {}): Fields => ({
  gender: ReferenceGender.ALL,
  ageFrom: 18,
  ageFromUnit: Y,
  ageTo: 60,
  ageToUnit: Y,
  lowerLimit: 12,
  upperLimit: 17,
  method: 'SLS',
  ...over,
});
const previous = (over: Fields = {}): Fields => ({
  ...range(),
  unit: 'g/dL',
  isDefault: true,
  ...over,
});
const param = (over: Fields = {}) => ({
  parameterCode: 'HB',
  parameterName: 'Hemoglobin',
  referenceRanges: [range()],
  ...over,
});
const created = (m: ReturnType<typeof build>) =>
  m.labTestReferenceRange.createMany.mock.calls[0]![0].data;

describe('upsertParamsByCode — the edit form path is unchanged', () => {
  it("soft-deletes ALL of the parameter's ranges (including analyzer ones) and creates the sent ones as they are", async () => {
    const m = build();
    await m.run([
      param({
        referenceRanges: [
          range({ unit: 'g/L', isDefault: false, labAdapterId: 'A1' }),
        ],
      }),
    ]);
    expect(m.labTestReferenceRange.updateMany.mock.calls[0]![0].where).toEqual({
      paramId: 'p1',
      tenantId: 't1',
      deletedAt: null,
    });
    expect(m.labTestReferenceRange.findMany).not.toHaveBeenCalled();
    expect(created(m)[0]).toMatchObject({
      unit: 'g/L',
      isDefault: false,
      labAdapterId: 'A1',
    });
  });

  it('reflex tests that are not sent clear the parameter\'s reflex tests (the form means "none")', async () => {
    const m = build();
    await m.run([param()]);
    expect(m.labTestResultParam.update.mock.calls[0]![0].data).toMatchObject({
      reflexTests: [],
    });
  });
});

describe('upsertParamsByCode — a re-import keeps analyzer setup', () => {
  it('replaces only the ranges WITHOUT an analyzer; analyzer-tied ranges are never soft-deleted', async () => {
    const m = build();
    await m.run([param()], { fromImport: true });
    expect(m.labTestReferenceRange.updateMany.mock.calls[0]![0].where).toEqual({
      paramId: 'p1',
      tenantId: 't1',
      deletedAt: null,
      labAdapterId: null,
    });
    expect(
      m.labTestReferenceRange.findMany.mock.calls[0]![0].where,
    ).toMatchObject({ paramId: 'p1', labAdapterId: null });
  });

  it('a re-created range keeps the unit and Default flag of the previous range with the same method, gender and age band', async () => {
    const m = build([previous()]);
    await m.run([param()], { fromImport: true });
    expect(created(m)[0]).toMatchObject({ unit: 'g/dL', isDefault: true });
  });

  it("the sheet's own unit or Default wins over the previous one", async () => {
    const m = build([previous()]);
    await m.run(
      [param({ referenceRanges: [range({ unit: 'g/L', isDefault: false })] })],
      { fromImport: true },
    );
    expect(created(m)[0]).toMatchObject({ unit: 'g/L', isDefault: false });
  });

  it('a range with a different method, gender or age band gets nothing carried over', async () => {
    const m = build([previous()]);
    await m.run(
      [
        param({
          referenceRanges: [
            range({ method: 'Cyan' }),
            range({ gender: ReferenceGender.MALE }),
            range({ ageTo: 70 }),
          ],
        }),
      ],
      { fromImport: true },
    );
    for (const r of created(m)) {
      expect(r).not.toHaveProperty('unit');
      expect(r).not.toHaveProperty('isDefault');
    }
  });

  it('equivalent age spans match ("12-23 Months" is "1 Year-1 Year")', async () => {
    const m = build([
      previous({ ageFrom: 12, ageFromUnit: M, ageTo: 23, ageToUnit: M }),
    ]);
    await m.run(
      [
        param({
          referenceRanges: [
            range({ ageFrom: 1, ageFromUnit: Y, ageTo: 1, ageToUnit: Y }),
          ],
        }),
      ],
      { fromImport: true },
    );
    expect(created(m)[0]).toMatchObject({ unit: 'g/dL', isDefault: true });
  });

  it('a previous range without a unit leaves the unit unset', async () => {
    const m = build([previous({ unit: null, isDefault: false })]);
    await m.run([param()], { fromImport: true });
    expect(created(m)[0]!.unit).toBeUndefined();
    expect(created(m)[0]).toMatchObject({ isDefault: false });
  });

  it('reflex tests the sheet did not send are left alone', async () => {
    const m = build();
    await m.run([param()], { fromImport: true });
    expect(
      m.labTestResultParam.update.mock.calls[0]![0].data,
    ).not.toHaveProperty('reflexTests');
  });

  it('reflex tests the sheet does send are applied', async () => {
    const m = build();
    await m.run([param({ reflexTests: [{ id: 'x', name: 'Reflex' }] })], {
      fromImport: true,
    });
    expect(m.labTestResultParam.update.mock.calls[0]![0].data).toMatchObject({
      reflexTests: [{ id: 'x', name: 'Reflex' }],
    });
  });

  it('a new parameter in the sheet is created with no reflex tests and nothing carried over', async () => {
    const m = build([previous()]);
    await m.run([param({ parameterCode: 'NEW' })], { fromImport: true });
    expect(m.labTestResultParam.create.mock.calls[0]![0].data).toMatchObject({
      reflexTests: [],
    });
    expect(m.labTestReferenceRange.findMany).not.toHaveBeenCalled();
    expect(created(m)[0]).not.toHaveProperty('unit');
  });
});
