import {
  AgeType,
  AgeUnit,
  BillingType,
  Gender,
  OrderStatus,
  OrderType,
} from '@prisma/client';
import { OrderService } from './order.service';
import {
  OrderPatientAgeRequiredException,
  OrderTestAgeRestrictedException,
} from './exceptions/order.exceptions';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { UpdateOrderDto } from './dto/update-order.dto';

/**
 * Lab test Age Restriction is enforced server-side on every saved order except a
 * quotation: a restricted test (alone or inside a panel) is rejected with 422
 * when the patient's age on the order date is outside its range.
 */
describe('OrderService — lab test Age Restriction', () => {
  const ADULT_ONLY = {
    id: 'blt-adult',
    testName: 'Vitamin B12',
    isAgeRestricted: true,
    minAgeValue: 18,
    minAgeUnit: AgeUnit.YEARS,
    maxAgeValue: 60,
    maxAgeUnit: AgeUnit.YEARS,
  };

  interface PatientRow {
    dateOfBirth: Date | null;
    age: number | null;
    ageType: AgeType | null;
    createdAt: Date;
  }

  const build = (opts: {
    patient: PatientRow | null;
    restricted?: (typeof ADULT_ONLY)[];
    junctions?: { branchLabPanelId: string; branchLabTestId: string }[];
    current?: Record<string, unknown>;
  }) => {
    const patientFindFirst = jest
      .fn()
      .mockImplementation(({ select }: { select: Record<string, boolean> }) =>
        Promise.resolve(
          select.gender ? { id: 'pt1', gender: Gender.FEMALE } : opts.patient,
        ),
      );
    const branchLabTestFindMany = jest
      .fn()
      .mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          (opts.restricted ?? []).filter((t) => where.id.in.includes(t.id)),
        ),
      );
    const prisma = {
      patient: { findFirst: patientFindFirst },
      branchLabTest: { findMany: branchLabTestFindMany },
      branchLabPanelTest: {
        findMany: jest.fn().mockResolvedValue(opts.junctions ?? []),
      },
      branchLabPanel: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'panel-1', panelName: 'Lipid Profile' }]),
      },
    };
    const getLocale = jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' });
    const deps = Array(16).fill(undefined) as unknown[];
    deps[0] = prisma;
    deps[11] = { getLocale };
    const service = new OrderService(
      ...(deps as ConstructorParameters<typeof OrderService>),
    );
    const internals = service as unknown as Record<string, unknown>;
    internals.assertItems = jest.fn().mockResolvedValue(undefined);
    // Everything after the age gate is out of scope.
    const afterGate = jest.fn().mockRejectedValue(new Error('PAST_AGE_GATE'));
    internals.assertReferrals = afterGate;
    internals.findById = jest.fn().mockResolvedValue({
      id: 'o1',
      status: OrderStatus.ORDER,
      patientId: 'pt1',
      orderDate: new Date('2026-11-11T00:00:00.000Z'),
      items: [],
      ...opts.current,
    });
    internals.assertNotInvoiced = jest.fn().mockResolvedValue(undefined);
    return { service, afterGate, patientFindFirst, getLocale };
  };

  const bornOn = (iso: string): PatientRow => ({
    dateOfBirth: new Date(`${iso}T00:00:00.000Z`),
    age: null,
    ageType: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  const createDto = (
    items: CreateOrderDto['items'],
    status?: OrderStatus,
  ): CreateOrderDto => ({
    orderDate: '2026-11-11T00:00:00.000Z',
    orderType: OrderType.WALK_IN,
    billingType: BillingType.CASH_CLIENT,
    patientId: 'pt1',
    items,
    ...(status ? { status } : {}),
  });

  describe('create', () => {
    it('rejects a restricted test for a patient below the minimum age, naming the range', async () => {
      const { service, afterGate } = build({
        patient: bornOn('2021-06-01'),
        restricted: [ADULT_ONLY],
      });
      const err = await service
        .create('t1', 'b1', 'p1', createDto([{ branchLabTestId: 'blt-adult' }]))
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OrderTestAgeRestrictedException);
      expect(err).toMatchObject({
        response: {
          error: {
            code: 'ORDER_TEST_AGE_RESTRICTED',
            message:
              'Patient\'s age (5 Years) does not meet the age requirement for "Vitamin B12" (allowed age: 18 Years - 60 Years).',
          },
        },
      });
      expect(afterGate).not.toHaveBeenCalled();
    });

    it('allows a patient inside the range', async () => {
      const { service, afterGate } = build({
        patient: bornOn('1990-01-01'),
        restricted: [ADULT_ONLY],
      });
      await expect(
        service.create(
          't1',
          'b1',
          'p1',
          createDto([{ branchLabTestId: 'blt-adult' }]),
        ),
      ).rejects.toThrow('PAST_AGE_GATE');
      expect(afterGate).toHaveBeenCalled();
    });

    it('treats the bounds inclusively: exactly 18 passes, 60 years 364 days passes, 61 fails', async () => {
      const run = (dob: string) =>
        build({
          patient: bornOn(dob),
          restricted: [ADULT_ONLY],
        }).service.create(
          't1',
          'b1',
          'p1',
          createDto([{ branchLabTestId: 'blt-adult' }]),
        );
      // 18th birthday on the order date.
      await expect(run('2008-11-11')).rejects.toThrow('PAST_AGE_GATE');
      // One day short of 18.
      await expect(run('2008-11-12')).rejects.toBeInstanceOf(
        OrderTestAgeRestrictedException,
      );
      // 60 years 364 days — "Max 60 Years" covers the whole 60th year.
      await expect(run('1965-11-12')).rejects.toThrow('PAST_AGE_GATE');
      // 61st birthday.
      await expect(run('1965-11-11')).rejects.toBeInstanceOf(
        OrderTestAgeRestrictedException,
      );
    });

    it('rejects a panel whose member test is restricted, naming the panel and the test', async () => {
      const { service } = build({
        patient: bornOn('2021-06-01'),
        restricted: [ADULT_ONLY],
        junctions: [
          { branchLabPanelId: 'panel-1', branchLabTestId: 'blt-free' },
          { branchLabPanelId: 'panel-1', branchLabTestId: 'blt-adult' },
        ],
      });
      await expect(
        service.create(
          't1',
          'b1',
          'p1',
          createDto([{ branchLabPanelId: 'panel-1' }]),
        ),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: 'ORDER_TEST_AGE_RESTRICTED',
            message:
              'Patient\'s age (5 Years) does not meet the age requirement for panel "Lipid Profile" (test "Vitamin B12" allows age 18 Years - 60 Years).',
          },
        },
      });
    });

    it('requires an age when a restricted test is ordered for a patient with neither DOB nor age', async () => {
      const { service } = build({
        patient: {
          dateOfBirth: null,
          age: null,
          ageType: null,
          createdAt: new Date(),
        },
        restricted: [ADULT_ONLY],
      });
      await expect(
        service.create(
          't1',
          'b1',
          'p1',
          createDto([{ branchLabTestId: 'blt-adult' }]),
        ),
      ).rejects.toBeInstanceOf(OrderPatientAgeRequiredException);
    });

    it('ages an age-only patient from the day the age was told', async () => {
      // Told "17 Years" on 2026-01-01 → implied DOB 2009-01-01 → 17 on 2026-11-11.
      const { service, getLocale } = build({
        patient: {
          dateOfBirth: null,
          age: 17,
          ageType: AgeType.YEARS,
          createdAt: new Date('2026-01-01T06:00:00.000Z'),
        },
        restricted: [ADULT_ONLY],
      });
      await expect(
        service.create(
          't1',
          'b1',
          'p1',
          createDto([{ branchLabTestId: 'blt-adult' }]),
        ),
      ).rejects.toBeInstanceOf(OrderTestAgeRestrictedException);
      expect(getLocale).toHaveBeenCalled();
    });

    it('ages the patient on the (back-dated) order date', async () => {
      // 18 on 2026-11-01, but the order is dated 2026-10-31.
      const { service } = build({
        patient: bornOn('2008-11-01'),
        restricted: [ADULT_ONLY],
      });
      await expect(
        service.create('t1', 'b1', 'p1', {
          ...createDto([{ branchLabTestId: 'blt-adult' }]),
          orderDate: '2026-10-31T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(OrderTestAgeRestrictedException);
    });

    it('never loads the patient age for unrestricted tests (existing behaviour unchanged)', async () => {
      const { service, patientFindFirst } = build({
        patient: bornOn('2021-06-01'),
        restricted: [],
      });
      await expect(
        service.create(
          't1',
          'b1',
          'p1',
          createDto([{ branchLabTestId: 'blt-free' }, { direct: 'Misc' }]),
        ),
      ).rejects.toThrow('PAST_AGE_GATE');
      // Only the existing gender lookup (assertPatient) ran.
      expect(patientFindFirst).toHaveBeenCalledTimes(1);
    });

    it('skips the gate for a quotation', async () => {
      const { service } = build({
        patient: bornOn('2021-06-01'),
        restricted: [ADULT_ONLY],
      });
      await expect(
        service.create(
          't1',
          'b1',
          'p1',
          createDto([{ branchLabTestId: 'blt-adult' }], OrderStatus.QUOTE),
        ),
      ).rejects.toThrow('PAST_AGE_GATE');
    });

    it('applies to a draft too', async () => {
      const { service } = build({
        patient: bornOn('2021-06-01'),
        restricted: [ADULT_ONLY],
      });
      await expect(
        service.create(
          't1',
          'b1',
          'p1',
          createDto([{ branchLabTestId: 'blt-adult' }], OrderStatus.DRAFT),
        ),
      ).rejects.toBeInstanceOf(OrderTestAgeRestrictedException);
    });
  });

  describe('update', () => {
    const child = bornOn('2021-06-01');

    it('rejects a newly added restricted line', async () => {
      const { service } = build({ patient: child, restricted: [ADULT_ONLY] });
      const dto: UpdateOrderDto = { items: [{ branchLabTestId: 'blt-adult' }] };
      await expect(
        service.update('o1', 't1', 'p1', dto),
      ).rejects.toBeInstanceOf(OrderTestAgeRestrictedException);
    });

    it('keeps an existing line of a finalized order (restriction added later)', async () => {
      const { service } = build({
        patient: child,
        restricted: [ADULT_ONLY],
        current: {
          items: [
            { id: 'oi1', branchLabTestId: 'blt-adult', branchLabPanelId: null },
          ],
        },
      });
      const dto: UpdateOrderDto = {
        items: [{ id: 'oi1', branchLabTestId: 'blt-adult' }],
      };
      await expect(service.update('o1', 't1', 'p1', dto)).rejects.toThrow(
        'PAST_AGE_GATE',
      );
    });

    it('checks every stored line when a draft is finalized without items', async () => {
      const { service } = build({
        patient: child,
        restricted: [ADULT_ONLY],
        current: {
          status: OrderStatus.DRAFT,
          items: [
            { id: 'oi1', branchLabTestId: 'blt-adult', branchLabPanelId: null },
          ],
        },
      });
      await expect(
        service.update('o1', 't1', 'p1', { status: OrderStatus.ORDER }),
      ).rejects.toBeInstanceOf(OrderTestAgeRestrictedException);
    });

    it('does not let a kept line id smuggle in a different test', async () => {
      const { service } = build({
        patient: child,
        restricted: [ADULT_ONLY],
        current: {
          items: [
            { id: 'oi1', branchLabTestId: 'blt-free', branchLabPanelId: null },
          ],
        },
      });
      const dto: UpdateOrderDto = {
        items: [{ id: 'oi1', branchLabTestId: 'blt-adult' }],
      };
      await expect(
        service.update('o1', 't1', 'p1', dto),
      ).rejects.toBeInstanceOf(OrderTestAgeRestrictedException);
    });

    it('skips the gate for a quotation edit', async () => {
      const { service } = build({
        patient: child,
        restricted: [ADULT_ONLY],
        current: { status: OrderStatus.QUOTE },
      });
      const dto: UpdateOrderDto = { items: [{ branchLabTestId: 'blt-adult' }] };
      await expect(service.update('o1', 't1', 'p1', dto)).rejects.toThrow(
        'PAST_AGE_GATE',
      );
    });
  });
});
