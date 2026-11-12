import { SampleTransferService } from './sample-transfer.service';

/**
 * Each transfer row's sample carries its department names as a LIST next to the joined text
 * label, so a client building a group's "Barcode / Dept" cell never has to split the text (a
 * department name may itself contain a comma).
 */
describe('SampleTransferService.findTransfers - department names', () => {
  const findMany = jest.fn<Promise<unknown[]>, [Record<string, unknown>]>();
  const deptFindMany = jest.fn<Promise<unknown[]>, [Record<string, unknown>]>();
  const tx = {
    tenant: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ groupingMode: 'DEPARTMENT_SAMPLE_NAME' }),
    },
    sampleTransfer: { findMany, count: jest.fn().mockResolvedValue(1) },
    department: { findMany: deptFindMany },
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
    outsourceCenter: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const service = new SampleTransferService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );

  const test = (departmentId: string | null, panel = false) => ({
    orderItem: {
      branchLabTest: panel ? null : { departmentId },
      branchLabPanel: panel ? { departmentId } : null,
    },
  });
  const row = (id: string, tests: unknown[]) => ({
    id,
    sampleId: `s-${id}`,
    clonedSampleId: null,
    outsourceCenterId: null,
    sample: {
      id: `s-${id}`,
      orderId: 'o1',
      departmentId: null,
      sampleGroupLabel: null,
      tests,
    },
  });

  const list = async (rows: unknown[]) => {
    findMany.mockReset().mockResolvedValue(rows);
    return service.findTransfers('t1', 'b1', {});
  };

  beforeEach(() => {
    deptFindMany.mockReset().mockResolvedValue([
      { id: 'dA', name: 'Biochemistry' },
      { id: 'dB', name: 'Pathology, Clinical' },
    ]);
  });

  it('gives the distinct names as a list (a comma inside a name stays inside it) and the joined label', async () => {
    const r = await list([row('t1', [test('dA'), test('dB'), test('dA')])]);
    const sample = r.data[0]!.sample as unknown as {
      departmentNames: string[];
      departmentLabel: string | null;
    };
    expect(sample.departmentNames).toEqual([
      'Biochemistry',
      'Pathology, Clinical',
    ]);
    expect(sample.departmentLabel).toBe('Biochemistry, Pathology, Clinical');
  });

  it('a sample with no department has an empty list and a null label', async () => {
    const r = await list([row('t2', [test(null)])]);
    const sample = r.data[0]!.sample as unknown as {
      departmentNames: string[];
      departmentLabel: string | null;
    };
    expect(sample.departmentNames).toEqual([]);
    expect(sample.departmentLabel).toBeNull();
  });

  it('reads a panel line the same way', async () => {
    const r = await list([row('t3', [test('dA', true)])]);
    expect(
      (r.data[0]!.sample as unknown as { departmentNames: string[] })
        .departmentNames,
    ).toEqual(['Biochemistry']);
  });
});
