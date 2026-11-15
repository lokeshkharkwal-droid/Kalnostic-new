import {
  AppointmentStatus,
  BillingType,
  OrderStatus,
  OrderType,
} from '@prisma/client';
import { OrderService } from './order.service';
import { EmergencyPricingChangedException } from './exceptions/order.exceptions';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { UpdateOrderDto } from './dto/update-order.dto';

/**
 * Registration Settings → Emergency Pricing on orders. The server decides
 * (EmergencyPricingService), stamps `isEmergencyPricing`, and prices lab-test
 * lines at their Emergency Price (falling back to the list price when unset).
 * The decision is re-made while the record is not yet an active order and
 * frozen afterwards; quotations are never emergency-priced. A client that sent a
 * different `emergencyPricing` gets 409 EMERGENCY_PRICING_CHANGED — the tests
 * below read the server's decision from that exception's `actual`.
 */
describe('OrderService — emergency pricing', () => {
  /** Constructor slot of each dependency (positional, see OrderService). */
  const PRISMA = 0;
  const REFERRAL_CREDIT = 12;
  const EMERGENCY_PRICING = 16;

  const build = (opts: {
    active?: boolean;
    existing?: Record<string, unknown>;
    tests?: Array<{ id: string; listPrice: number; emergencyPrice: number }>;
    panels?: Array<{ id: string; listPrice: number }>;
  }) => {
    const resolve = jest
      .fn()
      .mockResolvedValue({ active: opts.active ?? false });
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(opts.existing ?? null) },
      branchLabTest: {
        findMany: jest.fn().mockResolvedValue(opts.tests ?? []),
      },
      branchLabPanel: {
        findMany: jest.fn().mockResolvedValue(opts.panels ?? []),
      },
    };
    const deps = Array(17).fill(undefined) as unknown[];
    deps[PRISMA] = prisma;
    deps[REFERRAL_CREDIT] = {
      assertOrderCreationAllowed: jest.fn().mockResolvedValue(undefined),
    };
    deps[EMERGENCY_PRICING] = { resolve };
    const service = new OrderService(
      ...(deps as ConstructorParameters<typeof OrderService>),
    );
    const internals = service as unknown as Record<string, jest.Mock> & {
      loadItemUnitPrices: (
        tenantId: string,
        branchId: string | null,
        items: Array<{ branchLabTestId?: string; branchLabPanelId?: string }>,
        emergency?: boolean,
      ) => Promise<Map<string, number>>;
    };
    // Everything before the pricing step is out of scope here.
    for (const fn of [
      'assertItems',
      'assertAgeRestrictions',
      'assertReferrals',
      'assertNotInvoiced',
    ]) {
      internals[fn] = jest.fn().mockResolvedValue(undefined);
    }
    internals.assertPatient = jest.fn().mockResolvedValue('FEMALE');
    internals.assertAppointmentSection = jest.fn();
    internals.assertFinalizedOrder = jest.fn();
    return { service, internals, resolve, prisma };
  };

  describe('loadItemUnitPrices', () => {
    const tests = [
      { id: 'cbc', listPrice: 500, emergencyPrice: 900 },
      { id: 'kft', listPrice: 700, emergencyPrice: 0 }, // no emergency price set
    ];
    const panels = [{ id: 'p1', listPrice: 1200 }];
    const items = [
      { branchLabTestId: 'cbc' },
      { branchLabTestId: 'kft' },
      { branchLabPanelId: 'p1' },
    ];

    it('uses list prices when not emergency-priced', async () => {
      const { internals } = build({ tests, panels });
      const m = await internals.loadItemUnitPrices('t1', 'b1', items, false);
      expect([...m]).toEqual([
        ['cbc', 500],
        ['kft', 700],
        ['p1', 1200],
      ]);
    });

    it('uses Emergency Price for tests (list price when unset), panels unchanged', async () => {
      const { internals, prisma } = build({ tests, panels });
      const m = await internals.loadItemUnitPrices('t1', 'b1', items, true);
      expect([...m]).toEqual([
        ['cbc', 900],
        ['kft', 700],
        ['p1', 1200],
      ]);
      expect(prisma.branchLabTest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { id: true, listPrice: true, emergencyPrice: true },
        }),
      );
    });

    it('defaults to list prices when the flag is omitted', async () => {
      const { internals } = build({ tests, panels });
      const m = await internals.loadItemUnitPrices('t1', 'b1', items);
      expect(m.get('cbc')).toBe(500);
    });
  });

  describe('create', () => {
    const dto = (
      status: OrderStatus,
      emergencyPricing?: boolean,
    ): CreateOrderDto => ({
      orderDate: '2026-11-15',
      orderType: OrderType.WALK_IN,
      billingType: BillingType.CASH_CLIENT,
      patientId: 'pt1',
      status,
      items: [{ branchLabTestId: 'cbc' }],
      ...(emergencyPricing !== undefined ? { emergencyPricing } : {}),
    });

    /** Stop at the pricing step and report the emergency flag it was given. */
    const pricedWith = async (
      ctx: ReturnType<typeof build>,
      body: CreateOrderDto,
    ): Promise<boolean> => {
      let flag: boolean | undefined;
      ctx.internals.loadItemUnitPrices = jest.fn(
        (_t: string, _b: string | null, _i: unknown, e?: boolean) => {
          flag = e;
          return Promise.reject(new Error('PRICED'));
        },
      );
      await expect(ctx.service.create('t1', 'b1', 'p1', body)).rejects.toThrow(
        'PRICED',
      );
      return flag as boolean;
    };

    it.each([OrderStatus.ORDER, OrderStatus.DRAFT, OrderStatus.APPOINTMENT])(
      'prices a %s at the resolved emergency state',
      async (status) => {
        const on = build({ active: true });
        expect(await pricedWith(on, dto(status))).toBe(true);
        expect(on.resolve).toHaveBeenCalledWith('t1', 'b1');
        const off = build({ active: false });
        expect(await pricedWith(off, dto(status))).toBe(false);
      },
    );

    it('never emergency-prices a quotation (no resolve call)', async () => {
      const ctx = build({ active: true });
      expect(await pricedWith(ctx, dto(OrderStatus.QUOTE))).toBe(false);
      expect(ctx.resolve).not.toHaveBeenCalled();
    });

    it('never emergency-prices a branch-less order', async () => {
      const ctx = build({ active: true });
      ctx.internals.loadItemUnitPrices = jest
        .fn()
        .mockRejectedValue(new Error('PRICED'));
      await expect(
        ctx.service.create('t1', null, 'p1', dto(OrderStatus.ORDER)),
      ).rejects.toThrow('PRICED');
      expect(ctx.internals.loadItemUnitPrices).toHaveBeenCalledWith(
        't1',
        null,
        expect.any(Array),
        false,
      );
      expect(ctx.resolve).not.toHaveBeenCalled();
    });

    it('accepts a matching client flag', async () => {
      const ctx = build({ active: true });
      expect(await pricedWith(ctx, dto(OrderStatus.ORDER, true))).toBe(true);
    });

    it.each([
      [true, false],
      [false, true],
    ])(
      'rejects with 409 when the client priced with %s but the server says %s',
      async (expected, actual) => {
        const ctx = build({ active: actual });
        ctx.internals.loadItemUnitPrices = jest.fn();
        const p = ctx.service.create(
          't1',
          'b1',
          'p1',
          dto(OrderStatus.ORDER, expected),
        );
        await expect(p).rejects.toBeInstanceOf(
          EmergencyPricingChangedException,
        );
        await expect(p).rejects.toMatchObject({
          response: { error: { code: 'EMERGENCY_PRICING_CHANGED' } },
          context: { expected, actual },
        });
        expect(ctx.internals.loadItemUnitPrices).not.toHaveBeenCalled();
      },
    );
  });

  describe('update — when the decision is re-made vs frozen', () => {
    const existing = (
      status: OrderStatus,
      isEmergencyPricing: boolean,
      appointmentStatus: AppointmentStatus | null = null,
    ) => ({
      branchId: 'b1',
      status,
      patientId: 'pt1',
      isEmergencyPricing,
      appointment: appointmentStatus ? { status: appointmentStatus } : null,
    });

    /**
     * The server's decision for this save, read from the 409 raised when the
     * client claims the opposite of what the server is expected to decide.
     */
    const decided = async (
      stored: ReturnType<typeof existing>,
      patch: UpdateOrderDto,
      liveActive: boolean,
      expectDecision: boolean,
    ) => {
      const ctx = build({ active: liveActive, existing: stored });
      ctx.internals.findById = jest.fn().mockResolvedValue({
        id: 'o1',
        status: stored.status,
        patientId: 'pt1',
        items: [],
      });
      const p = ctx.service.update('o1', 't1', 'p1', {
        ...patch,
        emergencyPricing: !expectDecision,
      });
      await expect(p).rejects.toMatchObject({
        response: { error: { code: 'EMERGENCY_PRICING_CHANGED' } },
        context: { actual: expectDecision },
      });
      return ctx;
    };
    const items = [{ branchLabTestId: 'cbc' }];

    it('re-resolves a DRAFT being finalised to ORDER (live: on)', async () => {
      const ctx = await decided(
        existing(OrderStatus.DRAFT, false),
        { status: OrderStatus.ORDER, items },
        true,
        true,
      );
      expect(ctx.resolve).toHaveBeenCalledWith('t1', 'b1');
    });

    it('re-resolves a DRAFT re-saved as DRAFT (live: off clears an earlier on)', async () => {
      await decided(
        existing(OrderStatus.DRAFT, true),
        { status: OrderStatus.DRAFT, items },
        false,
        false,
      );
    });

    it('re-resolves an appointment being checked in', async () => {
      await decided(
        existing(OrderStatus.APPOINTMENT, false, AppointmentStatus.NEW),
        { checkIn: true, items },
        true,
        true,
      );
    });

    it('keeps the stored flag on an active ORDER whatever the live state', async () => {
      const ctx = await decided(
        existing(OrderStatus.ORDER, true),
        { items },
        false,
        true,
      );
      expect(ctx.resolve).not.toHaveBeenCalled();
      await decided(existing(OrderStatus.ORDER, false), { items }, true, false);
    });

    it('keeps the stored flag on an already checked-in appointment', async () => {
      const ctx = await decided(
        existing(OrderStatus.APPOINTMENT, true, AppointmentStatus.CHECKED_IN),
        { items },
        false,
        true,
      );
      expect(ctx.resolve).not.toHaveBeenCalled();
    });

    it('keeps the stored flag when the patch does not replace items', async () => {
      const ctx = await decided(
        existing(OrderStatus.DRAFT, false),
        { status: OrderStatus.ORDER },
        true,
        false,
      );
      expect(ctx.resolve).not.toHaveBeenCalled();
    });

    it('never emergency-prices a quotation', async () => {
      const ctx = await decided(
        existing(OrderStatus.QUOTE, false),
        { items },
        true,
        false,
      );
      expect(ctx.resolve).not.toHaveBeenCalled();
    });
  });
});
