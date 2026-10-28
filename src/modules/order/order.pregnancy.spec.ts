import { BillingType, Gender, OrderStatus, OrderType } from '@prisma/client';
import { OrderService } from './order.service';
import { OrderPregnancyRequiresFemalePatientException } from './exceptions/order.exceptions';
import type { CreateOrderDto } from './dto/create-order.dto';

/**
 * "Pregnant" is stored per order and is only valid for a FEMALE patient. The
 * check runs against the patient's current gender before anything else is
 * written, on both create and update.
 */
describe('OrderService — isPregnant is FEMALE-only', () => {
  const build = (gender: Gender | null) => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'pt1', gender });
    const deps = Array(14).fill(undefined) as unknown[];
    deps[0] = { patient: { findFirst } };
    const service = new OrderService(
      ...(deps as ConstructorParameters<typeof OrderService>),
    );
    const internals = service as unknown as Record<string, unknown>;
    // Everything after the pregnancy check is out of scope: stop at the next
    // validation step so a passing check is observable as this sentinel.
    const afterCheck = jest
      .fn()
      .mockRejectedValue(new Error('PAST_PREGNANCY_CHECK'));
    internals.assertItems = afterCheck;
    internals.findById = jest.fn().mockResolvedValue({
      id: 'o1',
      status: OrderStatus.ORDER,
      patientId: 'pt1',
    });
    internals.assertNotInvoiced = jest.fn().mockResolvedValue(undefined);
    return { service, findFirst, afterCheck };
  };

  const createDto = (isPregnant?: boolean): CreateOrderDto => ({
    orderDate: '2026-10-27',
    orderType: OrderType.WALK_IN,
    billingType: BillingType.CASH_CLIENT,
    patientId: 'pt1',
    ...(isPregnant !== undefined ? { isPregnant } : {}),
  });

  describe('create', () => {
    it('allows a pregnant FEMALE patient', async () => {
      const { service, afterCheck } = build(Gender.FEMALE);
      await expect(
        service.create('t1', 'b1', 'p1', createDto(true)),
      ).rejects.toThrow('PAST_PREGNANCY_CHECK');
      expect(afterCheck).toHaveBeenCalled();
    });

    it.each([Gender.MALE, Gender.OTHER, Gender.PREFER_NOT_TO_SAY, null])(
      'rejects isPregnant=true for a %s patient with 422',
      async (gender) => {
        const { service, afterCheck } = build(gender);
        await expect(
          service.create('t1', 'b1', 'p1', createDto(true)),
        ).rejects.toBeInstanceOf(OrderPregnancyRequiresFemalePatientException);
        expect(afterCheck).not.toHaveBeenCalled();
      },
    );

    it('carries the ORDER_PREGNANCY_REQUIRES_FEMALE code', async () => {
      const { service } = build(Gender.MALE);
      await expect(
        service.create('t1', 'b1', 'p1', createDto(true)),
      ).rejects.toMatchObject({
        response: { error: { code: 'ORDER_PREGNANCY_REQUIRES_FEMALE' } },
      });
    });

    it.each([false, undefined])(
      'never blocks isPregnant=%s, whatever the gender',
      async (isPregnant) => {
        const { service } = build(Gender.MALE);
        await expect(
          service.create('t1', 'b1', 'p1', createDto(isPregnant)),
        ).rejects.toThrow('PAST_PREGNANCY_CHECK');
      },
    );
  });

  describe('update', () => {
    it('allows a pregnant FEMALE patient', async () => {
      const { service, findFirst } = build(Gender.FEMALE);
      await expect(
        service.update('o1', 't1', 'p1', { isPregnant: true }),
      ).rejects.toThrow('PAST_PREGNANCY_CHECK');
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pt1', tenantId: 't1', deletedAt: null },
        }),
      );
    });

    it('rejects isPregnant=true once the patient is no longer FEMALE', async () => {
      const { service, afterCheck } = build(Gender.MALE);
      await expect(
        service.update('o1', 't1', 'p1', { isPregnant: true }),
      ).rejects.toBeInstanceOf(OrderPregnancyRequiresFemalePatientException);
      expect(afterCheck).not.toHaveBeenCalled();
    });

    it.each([{ isPregnant: false }, {}])(
      'skips the patient lookup for %o',
      async (dto) => {
        const { service, findFirst } = build(Gender.MALE);
        await expect(service.update('o1', 't1', 'p1', dto)).rejects.toThrow(
          'PAST_PREGNANCY_CHECK',
        );
        expect(findFirst).not.toHaveBeenCalled();
      },
    );
  });
});
