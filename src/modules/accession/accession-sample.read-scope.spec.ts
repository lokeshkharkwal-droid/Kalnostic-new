import { OrderSampleService } from './accession-sample.service';
import { OrderSampleNotFoundException } from './exceptions/accession.exceptions';

const TENANT = 't1';

interface SampleRow {
  branchId: string | null;
  originBranchId: string | null;
  processingBranchId: string | null;
  heldBranchIds: string[];
  sourceTransferId: string | null;
  order: { branchId: string | null } | null;
}
interface TransferRow {
  branchId: string | null;
  originBranchId: string | null;
  destinationBranchId: string | null;
}

/** A sample held by B (origin A) with the given transfers touching it. */
function setup(
  over: Partial<SampleRow> = {},
  transfers: TransferRow[] = [],
  exists = true,
) {
  const row: SampleRow = {
    branchId: 'B',
    originBranchId: 'A',
    processingBranchId: 'B',
    heldBranchIds: ['A', 'B'],
    sourceTransferId: 'tr1',
    order: { branchId: 'A' },
    ...over,
  };
  const prisma = {
    orderSample: {
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve(exists ? row : null)),
    },
    sampleTransfer: { findMany: jest.fn().mockResolvedValue(transfers) },
    orderSampleStatusHistory: { findMany: jest.fn().mockResolvedValue([]) },
    order: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const service = new OrderSampleService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  // The enrichment steps need many collaborators; they are not what is tested.
  const internals = service as unknown as {
    withDepartments: jest.Mock;
    enrichHistoryActors: jest.Mock;
  };
  internals.withDepartments = jest
    .fn()
    .mockImplementation((s: unknown) => Promise.resolve(s));
  internals.enrichHistoryActors = jest.fn().mockResolvedValue([]);
  return { service, prisma };
}

describe('OrderSampleService - a sample can only be opened by a branch with a stake in it', () => {
  describe('branchMayReadSample', () => {
    it.each([
      ['the branch holding it', 'B'],
      ['the branch it was created in', 'A'],
    ])('allows %s', async (_who, branch) => {
      const { service } = setup();
      await expect(
        service.branchMayReadSample('s1', TENANT, branch),
      ).resolves.toBe(true);
    });

    it('allows the branch it is processed at', async () => {
      const { service } = setup({ processingBranchId: 'P', heldBranchIds: [] });
      await expect(
        service.branchMayReadSample('s1', TENANT, 'P'),
      ).resolves.toBe(true);
    });

    it('allows a branch the sample has been with', async () => {
      const { service } = setup({ heldBranchIds: ['A', 'B', 'D'] });
      await expect(
        service.branchMayReadSample('s1', TENANT, 'D'),
      ).resolves.toBe(true);
    });

    it("allows the order's own branch even when every sample has moved on", async () => {
      const { service } = setup({
        branchId: 'B',
        originBranchId: 'B',
        heldBranchIds: [],
        processingBranchId: 'B',
        order: { branchId: 'REG' },
      });
      await expect(
        service.branchMayReadSample('s1', TENANT, 'REG'),
      ).resolves.toBe(true);
    });

    it.each([
      [
        'the sender',
        { branchId: 'S', originBranchId: 'S', destinationBranchId: 'R' },
        'S',
      ],
      [
        'the receiver',
        { branchId: 'S', originBranchId: 'S', destinationBranchId: 'R' },
        'R',
      ],
      [
        'the holder of the hop',
        { branchId: 'H', originBranchId: 'S', destinationBranchId: 'R' },
        'H',
      ],
    ])('allows %s of a transfer that moved it', async (_who, t, branch) => {
      const { service } = setup(
        {
          branchId: 'X',
          originBranchId: 'X',
          processingBranchId: 'X',
          heldBranchIds: [],
          sourceTransferId: null,
          order: { branchId: 'X' },
        },
        [t],
      );
      await expect(
        service.branchMayReadSample('s1', TENANT, branch),
      ).resolves.toBe(true);
    });

    it('refuses a branch that never touched the sample', async () => {
      const { service } = setup(
        {
          branchId: 'B',
          originBranchId: 'B',
          processingBranchId: 'B',
          heldBranchIds: [],
          sourceTransferId: null,
          order: { branchId: 'B' },
        },
        [{ branchId: 'B', originBranchId: 'B', destinationBranchId: 'C' }],
      );
      await expect(
        service.branchMayReadSample('s1', TENANT, 'A'),
      ).resolves.toBe(false);
    });

    it('a caller with no active branch is never refused (and nothing is queried)', async () => {
      const { service, prisma } = setup();
      await expect(
        service.branchMayReadSample('s1', TENANT, null),
      ).resolves.toBe(true);
      expect(prisma.orderSample.findFirst).not.toHaveBeenCalled();
    });

    it('a missing sample is refused', async () => {
      const { service } = setup({}, [], false);
      await expect(
        service.branchMayReadSample('s1', TENANT, 'B'),
      ).resolves.toBe(false);
    });

    it('looks for the transfers of the sample, of its copy and the one that produced it, in this tenant', async () => {
      const { service, prisma } = setup();
      await service.branchMayReadSample('s1', TENANT, 'B');
      const [args] = prisma.sampleTransfer.findMany.mock.calls[0] as [
        { where: { tenantId: string; deletedAt: null; OR: object[] } },
      ];
      expect(args.where.tenantId).toBe(TENANT);
      expect(args.where.deletedAt).toBeNull();
      expect(args.where.OR).toEqual([
        { sampleId: 's1' },
        { clonedSampleId: 's1' },
        { id: 'tr1' },
      ]);
    });

    it('does not look for a producing transfer when the sample is not a copy', async () => {
      const { service, prisma } = setup({ sourceTransferId: null });
      await service.branchMayReadSample('s1', TENANT, 'B');
      const [args] = prisma.sampleTransfer.findMany.mock.calls[0] as [
        { where: { OR: object[] } },
      ];
      expect(args.where.OR).toEqual([
        { sampleId: 's1' },
        { clonedSampleId: 's1' },
      ]);
    });
  });

  describe('findById', () => {
    it('opens for a branch with a stake in the sample', async () => {
      const { service } = setup();
      await expect(service.findById('s1', TENANT, 'B')).resolves.toBeDefined();
    });

    it('answers "not found" (not "forbidden") to a branch without one', async () => {
      const { service } = setup({
        branchId: 'B',
        originBranchId: 'B',
        processingBranchId: 'B',
        heldBranchIds: [],
        sourceTransferId: null,
        order: { branchId: 'B' },
      });
      await expect(service.findById('s1', TENANT, 'A')).rejects.toBeInstanceOf(
        OrderSampleNotFoundException,
      );
    });

    it('opens without a branch check when no branch is passed (the internal callers)', async () => {
      const { service, prisma } = setup({
        branchId: 'B',
        originBranchId: 'B',
        processingBranchId: 'B',
        heldBranchIds: [],
        sourceTransferId: null,
        order: { branchId: 'B' },
      });
      await expect(service.findById('s1', TENANT)).resolves.toBeDefined();
      expect(prisma.sampleTransfer.findMany).not.toHaveBeenCalled();
    });

    it('opens for a tenant-wide caller (null branch)', async () => {
      const { service } = setup({
        branchId: 'B',
        originBranchId: 'B',
        processingBranchId: 'B',
        heldBranchIds: [],
        sourceTransferId: null,
        order: { branchId: 'B' },
      });
      await expect(service.findById('s1', TENANT, null)).resolves.toBeDefined();
    });

    it('a missing sample is still "not found"', async () => {
      const { service } = setup({}, [], false);
      await expect(service.findById('s1', TENANT, 'B')).rejects.toBeInstanceOf(
        OrderSampleNotFoundException,
      );
    });
  });

  describe('findHistory', () => {
    const outsider = {
      branchId: 'B',
      originBranchId: 'B',
      processingBranchId: 'B',
      heldBranchIds: [],
      sourceTransferId: null,
      order: { branchId: 'B' },
    };

    it('is refused for a branch without a stake, and reads no history', async () => {
      const { service, prisma } = setup(outsider);
      await expect(
        service.findHistory('s1', TENANT, 'A'),
      ).rejects.toBeInstanceOf(OrderSampleNotFoundException);
      expect(prisma.orderSampleStatusHistory.findMany).not.toHaveBeenCalled();
    });

    it('is returned for a branch with a stake', async () => {
      const { service, prisma } = setup();
      await expect(service.findHistory('s1', TENANT, 'B')).resolves.toEqual([]);
      expect(prisma.orderSampleStatusHistory.findMany).toHaveBeenCalled();
    });

    it('is returned for a tenant-wide caller (null branch)', async () => {
      const { service } = setup(outsider);
      await expect(service.findHistory('s1', TENANT, null)).resolves.toEqual(
        [],
      );
    });
  });
});
