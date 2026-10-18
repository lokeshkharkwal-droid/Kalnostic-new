import { SampleTransferService } from './sample-transfer.service';
import { SampleTransferNotFoundException } from './exceptions/accession.exceptions';

const TENANT = 't1';

/** A transfer A (sender/holder) -> B with its sample id. */
function setup(
  over: Record<string, unknown> = {},
  exists = true,
  sampleReadable = false,
) {
  const transfer = {
    id: 'tr1',
    sampleId: 's1',
    branchId: 'A',
    originBranchId: 'A',
    destinationBranchId: 'B',
    ...over,
  };
  const prisma = {
    sampleTransfer: {
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve(exists ? transfer : null)),
    },
    // the "test removed from the order" probe: no removed test
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const samples = {
    branchMayReadSample: jest.fn().mockResolvedValue(sampleReadable),
  };
  const svc = new SampleTransferService(
    prisma as never,
    samples as never,
    {} as never,
    {} as never,
  );
  return { svc, prisma, samples, transfer };
}

describe('SampleTransferService - a transfer can only be opened by a branch with a stake in it', () => {
  it.each([
    ['the sender', 'A'],
    ['the receiver', 'B'],
  ])('opens for %s without looking at the sample', async (_who, branch) => {
    const { svc, samples, transfer } = setup();
    await expect(
      svc.findTransferById('tr1', TENANT, branch),
    ).resolves.toMatchObject(transfer);
    expect(samples.branchMayReadSample).not.toHaveBeenCalled();
  });

  it('opens for the holder of the hop when it differs from sender and receiver', async () => {
    const { svc, transfer } = setup({
      branchId: 'H',
      originBranchId: 'S',
      destinationBranchId: 'R',
    });
    await expect(
      svc.findTransferById('tr1', TENANT, 'H'),
    ).resolves.toMatchObject(transfer);
  });

  it('opens for a branch that is none of the three but has a stake in the sample (e.g. the chain origin)', async () => {
    const { svc, samples, transfer } = setup(
      { branchId: 'B', originBranchId: 'B', destinationBranchId: 'C' },
      true,
      true,
    );
    await expect(
      svc.findTransferById('tr1', TENANT, 'A'),
    ).resolves.toMatchObject(transfer);
    expect(samples.branchMayReadSample).toHaveBeenCalledWith('s1', TENANT, 'A');
  });

  it('answers "not found" (not "forbidden") to a branch that never touched it', async () => {
    const { svc } = setup(
      { branchId: 'B', originBranchId: 'B', destinationBranchId: 'C' },
      true,
      false,
    );
    await expect(
      svc.findTransferById('tr1', TENANT, 'A'),
    ).rejects.toBeInstanceOf(SampleTransferNotFoundException);
  });

  it("opens without any branch check when no branch is passed (the service's own reads)", async () => {
    const { svc, samples, transfer } = setup({
      branchId: 'B',
      originBranchId: 'B',
      destinationBranchId: 'C',
    });
    await expect(svc.findTransferById('tr1', TENANT)).resolves.toMatchObject(
      transfer,
    );
    expect(samples.branchMayReadSample).not.toHaveBeenCalled();
  });

  it('opens for a tenant-wide caller (null branch)', async () => {
    const { svc, transfer } = setup({
      branchId: 'B',
      originBranchId: 'B',
      destinationBranchId: 'C',
    });
    await expect(
      svc.findTransferById('tr1', TENANT, null),
    ).resolves.toMatchObject(transfer);
  });

  it('a missing transfer is still "not found"', async () => {
    const { svc } = setup({}, false);
    await expect(
      svc.findTransferById('tr1', TENANT, 'A'),
    ).rejects.toBeInstanceOf(SampleTransferNotFoundException);
  });

  it('an EXTERNAL transfer (no destination branch) opens for its sender', async () => {
    const { svc, transfer } = setup({
      destinationBranchId: null,
      kind: 'EXTERNAL',
    });
    await expect(
      svc.findTransferById('tr1', TENANT, 'A'),
    ).resolves.toMatchObject(transfer);
  });
});
