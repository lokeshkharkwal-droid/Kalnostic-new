import { OrderStatus } from '@prisma/client';
import { OrderService } from './order.service';
import { OrderNotDeletableException } from './exceptions/order.exceptions';

/** Only a DRAFT order can be deleted; everything else is cancelled, never deleted. */
describe('OrderService.remove - draft only', () => {
  const build = (status: OrderStatus, claimCount = 1) => {
    const tx = {
      order: {
        updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1' }),
      },
      orderItem: { updateMany: jest.fn() },
      orderDiagnostics: { updateMany: jest.fn() },
      orderOpd: { updateMany: jest.fn() },
      orderRadiology: { updateMany: jest.fn() },
      paymentDetails: { updateMany: jest.fn() },
      homeVisitCollection: { updateMany: jest.fn() },
    };
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue({ status }) },
      withTenant: jest.fn((_t: string, cb: (x: typeof tx) => unknown) =>
        cb(tx),
      ),
    };
    const deps = Array(14).fill(undefined) as unknown[];
    deps[0] = prisma;
    const service = new OrderService(
      ...(deps as ConstructorParameters<typeof OrderService>),
    );
    (service as unknown as Record<string, unknown>).findById = jest
      .fn()
      .mockResolvedValue({ id: 'o1', status });
    return { service, tx, prisma };
  };

  it.each([
    OrderStatus.ORDER,
    OrderStatus.CANCELLED,
    OrderStatus.QUOTE,
    OrderStatus.APPOINTMENT,
  ])('a %s order is refused and nothing is written', async (status) => {
    const { service, tx, prisma } = build(status);
    await expect(service.remove('o1', 't1')).rejects.toBeInstanceOf(
      OrderNotDeletableException,
    );
    expect(prisma.withTenant).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
  });

  it('carries the 409 code the screen can recognise', async () => {
    const { service } = build(OrderStatus.ORDER);
    await expect(service.remove('o1', 't1')).rejects.toMatchObject({
      response: { error: { code: 'ORDER_NOT_DELETABLE' } },
    });
  });

  it('a draft is deleted, claimed with the status in the update filter', async () => {
    const { service, tx } = build(OrderStatus.DRAFT);
    await expect(service.remove('o1', 't1')).resolves.toEqual({ id: 'o1' });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'o1',
        tenantId: 't1',
        status: OrderStatus.DRAFT,
        deletedAt: null,
      },
      data: { deletedAt: expect.any(Date) as unknown },
    });
    // and its children go with it
    expect(tx.orderItem.updateMany).toHaveBeenCalled();
    expect(tx.paymentDetails.updateMany).toHaveBeenCalled();
  });

  it('a draft finalized a moment before the delete is refused, children untouched', async () => {
    // the up-front read still said DRAFT, but the claim matches nothing
    const { service, tx } = build(OrderStatus.DRAFT, 0);
    await expect(service.remove('o1', 't1')).rejects.toBeInstanceOf(
      OrderNotDeletableException,
    );
    expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    expect(tx.paymentDetails.updateMany).not.toHaveBeenCalled();
  });
});
