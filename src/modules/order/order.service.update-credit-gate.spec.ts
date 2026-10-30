import { OrderStatus } from '@prisma/client';
import { OrderService } from './order.service';
import { ReferralOrderCreditLimitException } from '../referral-credit/referral-credit.exceptions';

/**
 * GAP 1 regression: the Referral Panel Settings credit gate must also fire on the
 * UPDATE path, not only on create(). Finalizing a DRAFT/QUOTE/APPOINTMENT to
 * ORDER (or editing an order into ORDER) must consult
 * `ReferralCreditService.assertOrderCreationAllowed` — excluding the order being
 * edited from its own balance — while a patch that keeps a non-ORDER status must
 * skip it (mirroring create(), which gates only `status === ORDER`).
 */
describe('OrderService.update — credit gate on finalize', () => {
  const service = new OrderService(
    ...(Array(13).fill(undefined) as ConstructorParameters<
      typeof OrderService
    >),
  );

  const assertOrderCreationAllowed = jest.fn();
  const orderFindFirst = jest.fn();
  const orderItemCount = jest.fn();

  /** Sentinel thrown just after the gate to prove control reached (or skipped) it. */
  class PostGateSentinel extends Error {}

  const callUpdate = (status: OrderStatus) =>
    service.update('order-1', 'tenant-1', 'actor-1', { status });

  beforeEach(() => {
    [assertOrderCreationAllowed, orderFindFirst, orderItemCount].forEach((m) =>
      m.mockReset(),
    );
    // Pre-gate steps stubbed to no-ops so update() reaches the gate.
    Object.assign(service as unknown as Record<string, unknown>, {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'order-1', status: OrderStatus.DRAFT }),
      assertNotInvoiced: jest.fn().mockResolvedValue(undefined),
      assertItems: jest.fn().mockResolvedValue(undefined),
      assertReferrals: jest.fn().mockResolvedValue(undefined),
      assertAppointmentSection: jest.fn(),
      referralCredit: { assertOrderCreationAllowed },
      prisma: {
        order: { findFirst: orderFindFirst },
        // First read after the gate — throwing here stops update() cleanly.
        orderItem: { count: orderItemCount },
      },
    });
    orderFindFirst.mockResolvedValue({
      branchId: null,
      status: OrderStatus.DRAFT,
      patientId: 'patient-1',
      referredByDoctorId: null,
      referralPanelId: 'panel-1',
      internalReferralId: null,
      externalReferralId: null,
      orderCode: 'O-1',
      externalOrderId: null,
      isBillGenerated: false,
      createdBy: 'actor-1',
      appointmentId: null,
      appointmentAt: null,
      appointment: null,
      diagnostics: null,
    });
    orderItemCount.mockRejectedValue(new PostGateSentinel());
  });

  it('gates finalize to ORDER, excluding the edited order from its own balance', async () => {
    assertOrderCreationAllowed.mockRejectedValue(
      new ReferralOrderCreditLimitException('Postpaid 30d', 5000, 1000),
    );
    await expect(callUpdate(OrderStatus.ORDER)).rejects.toBeInstanceOf(
      ReferralOrderCreditLimitException,
    );
    expect(assertOrderCreationAllowed).toHaveBeenCalledWith(
      'tenant-1',
      {
        referredByDoctorId: null,
        referralPanelId: 'panel-1',
        internalReferralId: null,
        externalReferralId: null,
      },
      'order-1',
    );
  });

  it('does not gate a patch that keeps the order non-ORDER (e.g. DRAFT)', async () => {
    await expect(callUpdate(OrderStatus.DRAFT)).rejects.toBeInstanceOf(
      PostGateSentinel,
    );
    expect(assertOrderCreationAllowed).not.toHaveBeenCalled();
  });
});
