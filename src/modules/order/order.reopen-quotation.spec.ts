import { OrderStatus, QuotationStatus } from '@prisma/client';
import { OrderService } from './order.service';
import { OrderNotDeletableException } from './exceptions/order.exceptions';

/**
 * Convert → Save as Draft marks the source quote CONVERTED. Deleting that DRAFT
 * order abandons the conversion, so the quote is reopened (CONVERTED → DRAFT) —
 * unless another live order still points at it. Only a DRAFT order can be deleted
 * at all (a finalized order is a real business event and is refused), and the
 * delete claims the row while it is still a draft, so a quote is never reopened
 * for an order that was finalized in the meantime.
 */
/** The shape of the `updateMany` call the code under test makes. */
interface UpdateManyArg {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}

describe('OrderService — reopen the source quote when its draft order is deleted', () => {
  const service = new OrderService(
    ...(Array(13).fill(undefined) as ConstructorParameters<
      typeof OrderService
    >),
  );

  const count = jest.fn();
  const updateMany = jest.fn<Promise<{ count: number }>, [UpdateManyArg]>();
  const findUniqueOrThrow = jest.fn();
  const withTenant = jest.fn();
  const noop = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
  const tx = {
    order: { count, updateMany, findUniqueOrThrow },
    orderItem: noop,
    orderDiagnostics: noop,
    orderOpd: noop,
    orderRadiology: noop,
    paymentDetails: noop,
    homeVisitCollection: noop,
  };
  const findFirst = jest.fn();
  let claimCount = 1;

  const remove = () =>
    (
      service as unknown as {
        remove: (id: string, t: string) => Promise<unknown>;
      }
    ).remove('draft-1', 'tenant-1');

  /** The two kinds of `updateMany` on `orders`: the draft claim and the quote reopen. */
  const claimCalls = () =>
    updateMany.mock.calls.filter(([a]) => a.where.status === OrderStatus.DRAFT);
  const reopenCalls = () =>
    updateMany.mock.calls.filter(([a]) => 'quotationStatus' in a.where);

  const setup = (status: OrderStatus, sourceQuotationId: string | null) => {
    (service as unknown as Record<string, unknown>).findById = jest
      .fn()
      .mockResolvedValue({ id: 'draft-1', status });
    findFirst.mockResolvedValue({
      branchId: 'b1',
      status,
      sourceQuotationId,
      appointment: null,
      diagnostics: null,
    });
  };

  beforeEach(() => {
    [count, updateMany, findUniqueOrThrow, withTenant, findFirst].forEach((m) =>
      m.mockReset(),
    );
    claimCount = 1;
    withTenant.mockImplementation((_t: string, cb: (t: unknown) => unknown) =>
      cb(tx),
    );
    updateMany.mockImplementation((a) =>
      Promise.resolve({
        count: a.where.status === OrderStatus.DRAFT ? claimCount : 1,
      }),
    );
    findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      deletedAt: new Date(),
    });
    (service as unknown as Record<string, unknown>).prisma = {
      order: { findFirst },
      withTenant,
    };
  });

  it('reopens the quote when its DRAFT order is deleted and nothing else points at it', async () => {
    setup(OrderStatus.DRAFT, 'quote-1');
    count.mockResolvedValue(0);
    await remove();
    expect(count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        sourceQuotationId: 'quote-1',
        deletedAt: null,
        id: { not: 'draft-1' },
      },
    });
    expect(reopenCalls()).toHaveLength(1);
    expect(reopenCalls()[0]![0]).toEqual({
      where: {
        id: 'quote-1',
        tenantId: 'tenant-1',
        deletedAt: null,
        quotationStatus: QuotationStatus.CONVERTED,
      },
      data: { quotationStatus: QuotationStatus.DRAFT },
    });
  });

  it('leaves the quote CONVERTED when another live order still comes from it', async () => {
    setup(OrderStatus.DRAFT, 'quote-1');
    count.mockResolvedValue(1);
    await remove();
    expect(reopenCalls()).toHaveLength(0);
  });

  it('a finalized ORDER cannot be deleted at all, so its quote is never touched', async () => {
    setup(OrderStatus.ORDER, 'quote-1');
    await expect(remove()).rejects.toBeInstanceOf(OrderNotDeletableException);
    expect(withTenant).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('a draft finalized between the check and the claim is refused and its quote is not reopened', async () => {
    setup(OrderStatus.DRAFT, 'quote-1');
    claimCount = 0;
    await expect(remove()).rejects.toBeInstanceOf(OrderNotDeletableException);
    expect(reopenCalls()).toHaveLength(0);
    expect(count).not.toHaveBeenCalled();
  });

  it('does nothing to any quote for a draft that did not come from one', async () => {
    setup(OrderStatus.DRAFT, null);
    await remove();
    expect(count).not.toHaveBeenCalled();
    expect(reopenCalls()).toHaveLength(0);
  });

  it('only ever touches a CONVERTED quote (never rewrites another status)', async () => {
    setup(OrderStatus.DRAFT, 'quote-1');
    count.mockResolvedValue(0);
    await remove();
    expect(reopenCalls()[0]![0].where.quotationStatus).toBe(
      QuotationStatus.CONVERTED,
    );
  });

  it('soft-deletes the draft order itself by claiming it while it is still a draft, then reopens the quote', async () => {
    setup(OrderStatus.DRAFT, 'quote-1');
    count.mockResolvedValue(0);
    const out = await remove();
    expect(claimCalls()).toHaveLength(1);
    const claim = claimCalls()[0]![0];
    expect(claim.where).toEqual({
      id: 'draft-1',
      tenantId: 'tenant-1',
      status: OrderStatus.DRAFT,
      deletedAt: null,
    });
    expect(claim.data.deletedAt).toBeInstanceOf(Date);
    // the claim happens before the quote is reopened
    const order = updateMany.mock.calls.map(([a]) => a);
    expect(order.indexOf(claim)).toBeLessThan(
      order.indexOf(reopenCalls()[0]![0]),
    );
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
    });
    expect(out).toMatchObject({ id: 'draft-1' });
  });
});
