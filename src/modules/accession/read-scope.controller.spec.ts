import { AccessionController } from './accession.controller';
import { SampleTransferController } from './sample-transfer.controller';

const TENANT = 't1';

describe("the three by-id reads pass the caller's ACTIVE branch to the service", () => {
  it('GET order-samples/:id', async () => {
    const sampleService = { findById: jest.fn().mockResolvedValue({}) };
    const ctrl = new AccessionController(sampleService as never);
    await ctrl.findOne(TENANT, { branchId: 'B' } as never, 's1');
    expect(sampleService.findById).toHaveBeenCalledWith('s1', TENANT, 'B');
  });

  it('GET order-samples/:id/history', async () => {
    const sampleService = { findHistory: jest.fn().mockResolvedValue([]) };
    const ctrl = new AccessionController(sampleService as never);
    await ctrl.findHistory(TENANT, { branchId: 'B' } as never, 's1');
    expect(sampleService.findHistory).toHaveBeenCalledWith('s1', TENANT, 'B');
  });

  it('GET transfers/:id', async () => {
    const transfers = { findTransferById: jest.fn().mockResolvedValue({}) };
    const ctrl = new SampleTransferController(transfers as never);
    await ctrl.findTransfer(TENANT, { branchId: 'B' } as never, 'tr1');
    expect(transfers.findTransferById).toHaveBeenCalledWith('tr1', TENANT, 'B');
  });

  it('a tenant-wide caller (no active branch) passes null, i.e. no restriction', async () => {
    const sampleService = { findById: jest.fn().mockResolvedValue({}) };
    const transfers = { findTransferById: jest.fn().mockResolvedValue({}) };
    await new AccessionController(sampleService as never).findOne(
      TENANT,
      { branchId: null } as never,
      's1',
    );
    await new SampleTransferController(transfers as never).findTransfer(
      TENANT,
      { branchId: null } as never,
      'tr1',
    );
    expect(sampleService.findById).toHaveBeenCalledWith('s1', TENANT, null);
    expect(transfers.findTransferById).toHaveBeenCalledWith(
      'tr1',
      TENANT,
      null,
    );
  });
});
