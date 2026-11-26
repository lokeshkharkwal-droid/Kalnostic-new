import { OrderService } from './order.service';
import { OrderNotFoundException } from './exceptions/order.exceptions';
import { ReferralPanelAccessDeniedException } from '../../common/exceptions/referral-panel-access.exception';
import { tenantContext } from '../../prisma/tenant-context';

/**
 * `GET /orders/:id/notifications` — the Share & Inform "Past Notifications".
 * The order itself is the access boundary: it must exist in the caller's tenant
 * and (for a B2B panel session) belong to the session's panel before its
 * notification history is listed.
 */
describe('OrderService.findNotifications', () => {
  const orderFindFirst = jest.fn();
  const listOrderNotifications = jest.fn();
  const deps = Array(17).fill(undefined) as unknown[];
  deps[0] = { order: { findFirst: orderFindFirst } }; // prisma
  deps[10] = { listOrderNotifications }; // shareService
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );

  const page = {
    data: [{ id: 'log-1' }],
    total: 1,
    page: 1,
    limit: 100,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    listOrderNotifications.mockResolvedValue(page);
  });

  it("checks the order in the caller's tenant, then lists its notifications", async () => {
    orderFindFirst.mockResolvedValue({ id: 'o-1', referralPanelId: null });

    await expect(
      service.findNotifications('o-1', 't-1', { limit: 100 }),
    ).resolves.toBe(page);

    expect(orderFindFirst).toHaveBeenCalledWith({
      where: { id: 'o-1', tenantId: 't-1', deletedAt: null },
      select: { id: true, referralPanelId: true },
    });
    expect(listOrderNotifications).toHaveBeenCalledWith('t-1', 'o-1', {
      limit: 100,
    });
  });

  it('404s for an order that is missing / deleted / in another tenant', async () => {
    orderFindFirst.mockResolvedValue(null);

    await expect(
      service.findNotifications('o-x', 't-1', {}),
    ).rejects.toBeInstanceOf(OrderNotFoundException);
    expect(listOrderNotifications).not.toHaveBeenCalled();
  });

  it("refuses a B2B panel session another panel's order", async () => {
    orderFindFirst.mockResolvedValue({ id: 'o-1', referralPanelId: 'panel-B' });

    await expect(
      tenantContext.run({ tenantId: 't-1', referralPanelId: 'panel-A' }, () =>
        service.findNotifications('o-1', 't-1', {}),
      ),
    ).rejects.toBeInstanceOf(ReferralPanelAccessDeniedException);
    expect(listOrderNotifications).not.toHaveBeenCalled();
  });

  it("lets a B2B panel session read its own panel's order", async () => {
    orderFindFirst.mockResolvedValue({ id: 'o-1', referralPanelId: 'panel-A' });

    await expect(
      tenantContext.run({ tenantId: 't-1', referralPanelId: 'panel-A' }, () =>
        service.findNotifications('o-1', 't-1', {}),
      ),
    ).resolves.toBe(page);
  });
});
