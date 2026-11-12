import {
  AccessionBarcodeResetCycle,
  AccessionBarcodeSeparator,
  BarcodeCounterKind,
} from '@prisma/client';
import { AccessionSettingsService } from './accession-settings.service';
import { DEFAULT_ACCESSION_TYPED_SETTINGS } from './constants/accession-settings.default';

/**
 * Accession Settings — barcode section. Barcode numbers come from the
 * tenant-wide counter (`TenantBarcodeCounter`), so every branch shows the same
 * current number / next barcode (in its own format), and the retired reset
 * cycle always reads NEVER and is never stored.
 */
describe('AccessionSettingsService barcode counters', () => {
  const TENANT = 'tenant-1';

  function setup(opts: {
    counters?: Array<{ kind: BarcodeCounterKind; currentNumber: number }>;
    rows?: Record<string, Partial<typeof DEFAULT_ACCESSION_TYPED_SETTINGS>>;
  }) {
    const rowFor = (branchId: string) =>
      opts.rows?.[branchId]
        ? {
            id: `settings-${branchId}`,
            config: {},
            ...DEFAULT_ACCESSION_TYPED_SETTINGS,
            ...opts.rows[branchId],
          }
        : null;
    const prisma = {
      tenantBarcodeCounter: {
        findMany: jest.fn().mockResolvedValue(opts.counters ?? []),
      },
      accessionSetting: {
        findFirst: jest.fn((args: { where: { branchId: string } }) =>
          Promise.resolve(rowFor(args.where.branchId)),
        ),
        upsert: jest.fn(
          (args: { where: { tenantId_branchId: { branchId: string } } }) =>
            Promise.resolve(
              rowFor(args.where.tenantId_branchId.branchId) ?? {
                id: 'new',
                config: {},
                ...DEFAULT_ACCESSION_TYPED_SETTINGS,
              },
            ),
        ),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'settings-b1',
            config: {},
            ...DEFAULT_ACCESSION_TYPED_SETTINGS,
            ...args.data,
          }),
        ),
      },
    };
    const branchService = { findById: jest.fn().mockResolvedValue({}) };
    const svc = new AccessionSettingsService(
      prisma as never,
      branchService as never,
    );
    return { svc, prisma };
  }

  it('shows the tenant counters as the current number and next barcode on every branch, in each branch format', async () => {
    const { svc, prisma } = setup({
      counters: [
        { kind: BarcodeCounterKind.ORDER, currentNumber: 11985 },
        { kind: BarcodeCounterKind.SAMPLE, currentNumber: 13192 },
      ],
      rows: {
        bhainsa: {
          // Stale per-branch columns from before the tenant counter.
          OrderBarcodeSettings_CurrentNumber: 10201,
          SampleBarcodeSettings_CurrentNumber: 10072,
        },
        nzb: {
          OrderBarcodeSettings_Prefix: 'NZ',
          OrderBarcodeSettings_Separator: AccessionBarcodeSeparator.HYPHEN,
        },
      },
    });

    const bhainsa = await svc.getForBranch(TENANT, 'bhainsa');
    const nzb = await svc.getForBranch(TENANT, 'nzb');

    expect(prisma.tenantBarcodeCounter.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
      select: { kind: true, currentNumber: true },
    });
    expect(bhainsa.OrderBarcodeSettings_CurrentNumber).toBe(11985);
    expect(bhainsa.OrderBarcodeSettings_Preview).toBe('11986');
    expect(bhainsa.SampleBarcodeSettings_CurrentNumber).toBe(13192);
    expect(bhainsa.SampleBarcodeSettings_Preview).toBe('13193');
    expect(nzb.OrderBarcodeSettings_CurrentNumber).toBe(11985);
    expect(nzb.OrderBarcodeSettings_Preview).toBe('NZ-11986');
  });

  it('previews 10001 for a tenant that has not issued a barcode yet', async () => {
    const { svc } = setup({ rows: { b1: {} } });

    const res = await svc.getForBranch(TENANT, 'b1');

    expect(res.OrderBarcodeSettings_CurrentNumber).toBe(10000);
    expect(res.OrderBarcodeSettings_Preview).toBe('10001');
    expect(res.SampleBarcodeSettings_Preview).toBe('10001');
  });

  it('always reports reset intervals as NEVER, even if an old value is stored', async () => {
    const { svc } = setup({
      rows: {
        b1: {
          OrderBarcodeSettings_ResetInterval: AccessionBarcodeResetCycle.DAILY,
          SampleBarcodeSettings_ResetInterval:
            AccessionBarcodeResetCycle.MONTHLY,
        },
      },
    });

    const res = await svc.getForBranch(TENANT, 'b1');

    expect(res.OrderBarcodeSettings_ResetInterval).toBe(
      AccessionBarcodeResetCycle.NEVER,
    );
    expect(res.SampleBarcodeSettings_ResetInterval).toBe(
      AccessionBarcodeResetCycle.NEVER,
    );
  });

  it('accepts but never stores a reset interval sent by an older client', async () => {
    const { svc, prisma } = setup({ rows: { b1: {} } });

    const res = await svc.saveForBranch(TENANT, 'b1', {
      OrderBarcodeSettings_ResetInterval: AccessionBarcodeResetCycle.DAILY,
      SampleBarcodeSettings_ResetInterval: AccessionBarcodeResetCycle.YEARLY,
      OrderBarcodeSettings_Prefix: 'BH',
    });

    const data = prisma.accessionSetting.update.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty('OrderBarcodeSettings_ResetInterval');
    expect(data).not.toHaveProperty('SampleBarcodeSettings_ResetInterval');
    expect(data).toHaveProperty('OrderBarcodeSettings_Prefix', 'BH');
    expect(res.OrderBarcodeSettings_ResetInterval).toBe(
      AccessionBarcodeResetCycle.NEVER,
    );
    expect(res.OrderBarcodeSettings_Preview).toBe('BH10001');
  });
});
