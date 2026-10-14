import { OrderSampleService } from './accession-sample.service';
import { TransferWrongBranchException } from './exceptions/accession.exceptions';

/**
 * Retrieve of a sample that was sent to another branch belongs to the SENDING
 * branch only: the caller's active branch must be the branch that holds the
 * sample. Other samples (not sent out) are not affected by this check.
 */
function build(sentSamples: { id: string; branchId: string }[]) {
  const tx = {
    orderSample: { findMany: jest.fn().mockResolvedValue(sentSamples) },
  };
  const prisma = {
    withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
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
  );
  // the status transition itself is covered elsewhere; here only the guard matters
  const transition = jest
    .spyOn(service as never, 'transitionIds')
    .mockResolvedValue({ succeeded: [], skipped: [] } as never);
  return { service, tx, transition };
}

describe('OrderSampleService.retrieve - only the sending branch can pull a sent sample back', () => {
  it("asks only about samples that are out at another branch (SENT_INTERNAL), in the caller's tenant", async () => {
    const { service, tx } = build([]);
    await service.retrieve(['s1', 's2'], 't1', 'p1', 'A', {});
    const where = (
      tx.orderSample.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ]
    )[0].where;
    expect(where).toMatchObject({
      id: { in: ['s1', 's2'] },
      tenantId: 't1',
      status: 'SENT_INTERNAL',
      deletedAt: null,
    });
  });

  it.each([
    ['the receiving branch', 'B'],
    ['an uninvolved branch', 'C'],
    ['a caller with no active branch (business admin)', null],
  ])('is refused for %s, and nothing is retrieved', async (_who, branch) => {
    const { service, transition } = build([{ id: 's1', branchId: 'A' }]);
    await expect(
      service.retrieve(['s1'], 't1', 'p1', branch, {}),
    ).rejects.toBeInstanceOf(TransferWrongBranchException);
    expect(transition).not.toHaveBeenCalled();
  });

  it('works for the sending branch (A)', async () => {
    const { service, transition } = build([{ id: 's1', branchId: 'A' }]);
    await service.retrieve(['s1'], 't1', 'p1', 'A', {});
    expect(transition).toHaveBeenCalledTimes(1);
  });

  it('refuses a whole group when any sent sample belongs to another branch', async () => {
    const { service, transition } = build([
      { id: 'mine', branchId: 'A' },
      { id: 'foreign', branchId: 'C' },
    ]);
    await expect(
      service.retrieve(['mine', 'foreign'], 't1', 'p1', 'A', {
        skipInvalid: true,
      } as never),
    ).rejects.toBeInstanceOf(TransferWrongBranchException);
    expect(transition).not.toHaveBeenCalled();
  });

  it('does not interfere with samples that are not sent out (nothing returned by the query)', async () => {
    const { service, transition } = build([]);
    await service.retrieve(['plain'], 't1', 'p1', 'ANY', {});
    expect(transition).toHaveBeenCalledTimes(1);
  });
});
