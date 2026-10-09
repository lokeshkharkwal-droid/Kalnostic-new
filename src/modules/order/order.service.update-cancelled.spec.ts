import { OrderStatus } from '@prisma/client';
import { OrderService } from './order.service';
import { OrderAlreadyCancelledException } from './exceptions/order.exceptions';

/** A cancelled order is final: saving an edit must never reopen it. */
describe('OrderService.update - a cancelled order', () => {
  const build = (status: OrderStatus) => {
    const deps = Array(14).fill(undefined) as unknown[];
    const service = new OrderService(
      ...(deps as ConstructorParameters<typeof OrderService>),
    );
    const internals = service as unknown as Record<string, unknown>;
    internals.findById = jest.fn().mockResolvedValue({ id: 'o1', status });
    const afterGuard = jest
      .fn()
      .mockRejectedValue(new Error('PAST_CANCELLED_CHECK'));
    internals.assertNotInvoiced = afterGuard;
    return { service, afterGuard };
  };

  it('is refused, and nothing after the check runs', async () => {
    const { service, afterGuard } = build(OrderStatus.CANCELLED);
    await expect(
      service.update('o1', 't1', 'p1', { status: OrderStatus.ORDER }),
    ).rejects.toBeInstanceOf(OrderAlreadyCancelledException);
    expect(afterGuard).not.toHaveBeenCalled();
  });

  it('carries the 409 code the screen can recognise', async () => {
    const { service } = build(OrderStatus.CANCELLED);
    await expect(service.update('o1', 't1', 'p1', {})).rejects.toMatchObject({
      response: { error: { code: 'ORDER_ALREADY_CANCELLED' } },
    });
  });

  it('a live order goes on to the normal update checks', async () => {
    const { service, afterGuard } = build(OrderStatus.ORDER);
    await expect(service.update('o1', 't1', 'p1', {})).rejects.toThrow(
      'PAST_CANCELLED_CHECK',
    );
    expect(afterGuard).toHaveBeenCalled();
  });
});
