import { OrderStatus, QuotationStatus } from '@prisma/client';
import { OrderService } from './order.service';

/**
 * Convert → Save as Draft marks the source quote CONVERTED. Deleting that DRAFT
 * order abandons the conversion, so the quote is reopened (CONVERTED → DRAFT) —
 * unless another live order still points at it, and never when the deleted order
 * was a real (non-draft) order.
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
  const txOrderUpdate = jest.fn();
  const noop = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
  const tx = {
    order: { count, updateMany, update: txOrderUpdate },
    orderItem: noop,
    orderDiagnostics: noop,
    orderOpd: noop,
    orderRadiology: noop,
    paymentDetails: noop,
    homeVisitCollection: noop,
  };
  const findFirst = jest.fn();

  const remove = () =>
    (
      service as unknown as {
        remove: (id: string, t: string) => Promise<unknown>;
      }
    ).remove('draft-1', 'tenant-1');

  beforeEach(() => {
    [count, updateMany, txOrderUpdate, findFirst].forEach((m) => m.mockReset());
    txOrderUpdate.mockResolvedValue({ id: 'draft-1' });
    updateMany.mockResolvedValue({ count: 1 });
    const internals = service as unknown as Record<string, unknown>;
    internals.findById = jest.fn().mockResolvedValue({ id: 'draft-1' });
    internals.prisma = {
      order: { findFirst },
      withTenant: (_t: string, cb: (t: unknown) => unknown) => cb(tx),
    };
  });

  const deletedOrder = (
    status: OrderStatus,
    sourceQuotationId: string | null,
  ) =>
    findFirst.mockResolvedValue({
      branchId: 'b1',
      status,
      sourceQuotationId,
      appointment: null,
      diagnostics: null,
    });

  it('reopens the quote when its DRAFT order is deleted and nothing else points at it', async () => {
    deletedOrder(OrderStatus.DRAFT, 'quote-1');
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
    expect(updateMany).toHaveBeenCalledWith({
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
    deletedOrder(OrderStatus.DRAFT, 'quote-1');
    count.mockResolvedValue(1);
    await remove();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not reopen the quote when a finalized ORDER is deleted', async () => {
    deletedOrder(OrderStatus.ORDER, 'quote-1');
    await remove();
    expect(count).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does nothing for a draft that did not come from a quote', async () => {
    deletedOrder(OrderStatus.DRAFT, null);
    await remove();
    expect(count).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('only ever touches a CONVERTED quote (never rewrites another status)', async () => {
    deletedOrder(OrderStatus.DRAFT, 'quote-1');
    count.mockResolvedValue(0);
    await remove();
    expect(updateMany.mock.calls[0]?.[0].where.quotationStatus).toBe(
      QuotationStatus.CONVERTED,
    );
  });

  it('still soft-deletes the draft order itself', async () => {
    deletedOrder(OrderStatus.DRAFT, 'quote-1');
    count.mockResolvedValue(0);
    await remove();
    expect(txOrderUpdate).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: { deletedAt: expect.any(Date) },
    });
  });
});
