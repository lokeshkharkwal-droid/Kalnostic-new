import { SampleTransferService } from './sample-transfer.service';

/**
 * The referral queues group transfers into the SAME Order → final-group buckets
 * the In-House list uses. `findTransfers` must tag each row with its final-group
 * key (`${orderId}::${barcodeGroupKey}`) + the tenant's grouping mode, read from
 * the sample's PERSISTED `departmentId` / `sampleGroupLabel` columns — the exact
 * columns `buildOrderGroup` groups on, so the two lists never drift.
 */
describe('SampleTransferService.findTransfers — group-key tagging', () => {
  /** One transfer row as Prisma would return it under TRANSFER_INCLUDE. */
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'tr1',
    outsourceCenterId: null,
    sample: {
      id: 's1',
      orderId: 'o1',
      departmentId: 'd1',
      sampleGroupLabel: 'EDTA',
      tests: [],
      order: { id: 'o1', orderCode: 'DIG-001' },
      ...(over.sample as object),
    },
    ...over,
  });

  const run = async (groupingMode: string, rows: unknown[]) => {
    const tx = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ groupingMode }) },
      sampleTransfer: {
        findMany: jest.fn().mockResolvedValue(rows),
        count: jest.fn().mockResolvedValue(rows.length),
      },
      // Only hit when a row resolves a department / outsource center — unused
      // here (tests:[] and outsourceCenterId:null short-circuit both lookups).
      department: { findMany: jest.fn().mockResolvedValue([]) },
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
    const res = await service.findTransfers('t1', 'b1', {});
    return res.data as Array<{ groupKey?: string; groupingMode?: string }>;
  };

  it('tags DEPARTMENT_SAMPLE_NAME rows with `${orderId}::DEPT_SAMPLE::dept::name`', async () => {
    const [r] = await run('DEPARTMENT_SAMPLE_NAME', [row()]);
    expect(r!.groupKey).toBe('o1::DEPT_SAMPLE::d1::EDTA');
    expect(r!.groupingMode).toBe('DEPARTMENT_SAMPLE_NAME');
  });

  it('two samples of one order + department + name share a key (one group)', async () => {
    const rows = await run('DEPARTMENT_SAMPLE_NAME', [
      row({ id: 'tr1', sample: { id: 's1', orderId: 'o1', departmentId: 'd1', sampleGroupLabel: 'EDTA', tests: [], order: { id: 'o1', orderCode: 'DIG-001' } } }),
      row({ id: 'tr2', sample: { id: 's2', orderId: 'o1', departmentId: 'd1', sampleGroupLabel: 'EDTA', tests: [], order: { id: 'o1', orderCode: 'DIG-001' } } }),
    ]);
    expect(rows[0]!.groupKey).toBe(rows[1]!.groupKey);
  });

  it('ORDER mode collapses every sample of an order into one group key', async () => {
    const [r] = await run('ORDER', [row()]);
    expect(r!.groupKey).toBe('o1::ORDER');
  });

  it('SAMPLE_NAME mode gives each sample its own key', async () => {
    const [r] = await run('SAMPLE_NAME', [row()]);
    expect(r!.groupKey).toBe('o1::SAMPLE::s1');
  });

  it('uses the sample\'s own order id for the key prefix (not a different field)', async () => {
    const [r] = await run('DEPARTMENT', [
      row({ sample: { id: 's9', orderId: 'oZ', departmentId: null, sampleGroupLabel: null, tests: [], order: { id: 'oZ', orderCode: 'DIG-009' } } }),
    ]);
    // Null department falls back to the stable "none" token, prefixed by oZ.
    expect(r!.groupKey).toBe('oZ::DEPT::none');
  });
});
