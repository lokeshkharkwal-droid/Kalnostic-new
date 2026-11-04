import { AgeUnit, LabTest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestListView } from './entities/lab-test.entity';
import { LabTestService } from './lab-test.service';

/**
 * The Reference Range / Reference Value list views return each age bound WITH its unit: a bare number
 * ("28") cannot be read without it ("28 Days" is not "28 Years"), and the Master Data grid was showing
 * every bound as years.
 */
describe('LabTestService list views — age units', () => {
  const prisma = {
    labTestResultParam: { findMany: jest.fn() },
    labTestReferenceRange: { findMany: jest.fn() },
    labTestReferenceValue: { findMany: jest.fn() },
  };
  const service = new LabTestService(
    prisma as unknown as PrismaService,
    {} as MasterDataService,
  );
  const project = (view: LabTestListView) =>
    (
      service as unknown as {
        projectListRows: (
          v: LabTestListView,
          tenantId: string,
          tests: LabTest[],
        ) => Promise<Array<Record<string, unknown>>>;
      }
    ).projectListRows(view, 't1', [
      { id: 'lt1', testName: 'CBC', testCode: 'CBC' } as LabTest,
    ]);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.labTestResultParam.findMany.mockResolvedValue([
      { id: 'p1', labTestId: 'lt1', parameterName: 'Hb', method: null },
    ]);
  });

  it('reference ranges carry ageFromUnit and ageToUnit exactly as stored', async () => {
    prisma.labTestReferenceRange.findMany.mockResolvedValue([
      {
        id: 'r1',
        labTestId: 'lt1',
        paramId: 'p1',
        gender: 'ALL',
        ageFrom: 0,
        ageFromUnit: AgeUnit.DAYS,
        ageTo: 28,
        ageToUnit: AgeUnit.DAYS,
        abnormalFlagLogic: 'BOLD_RED',
      },
      {
        id: 'r2',
        labTestId: 'lt1',
        paramId: 'p1',
        gender: 'ALL',
        ageFrom: 6,
        ageFromUnit: AgeUnit.MONTHS,
        ageTo: 12,
        ageToUnit: AgeUnit.YEARS,
        abnormalFlagLogic: 'BOLD_RED',
      },
    ]);

    const [row] = await project(LabTestListView.REFERENCE_RANGE);
    const ranges = row?.referenceRanges as Array<Record<string, unknown>>;

    expect(ranges[0]).toMatchObject({
      ageFrom: 0,
      ageFromUnit: 'DAYS',
      ageTo: 28,
      ageToUnit: 'DAYS',
    });
    expect(ranges[1]).toMatchObject({
      ageFrom: 6,
      ageFromUnit: 'MONTHS',
      ageTo: 12,
      ageToUnit: 'YEARS',
    });
  });

  it('reference values carry ageFromUnit and ageToUnit exactly as stored', async () => {
    prisma.labTestReferenceValue.findMany.mockResolvedValue([
      {
        id: 'v1',
        labTestId: 'lt1',
        paramId: 'p1',
        gender: 'ALL',
        ageFrom: 1,
        ageFromUnit: AgeUnit.MONTHS,
        ageTo: 11,
        ageToUnit: AgeUnit.MONTHS,
        normalValueText: 'Negative',
        abnormalFlagLogic: 'BOLD_RED',
      },
    ]);

    const [row] = await project(LabTestListView.REFERENCE_VALUE);
    const values = row?.referenceValues as Array<Record<string, unknown>>;

    expect(values[0]).toMatchObject({
      ageFrom: 1,
      ageFromUnit: 'MONTHS',
      ageTo: 11,
      ageToUnit: 'MONTHS',
    });
  });
});
