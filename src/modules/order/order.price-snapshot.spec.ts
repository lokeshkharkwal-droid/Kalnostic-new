import { AppointmentStatus, OrderStatus } from '@prisma/client';
import { OrderService } from './order.service';
import type { UpdateOrderDto } from './dto/update-order.dto';

/**
 * Historical pricing on Update Order. Master-data edits/syncs change
 * BranchLabTest/Panel in place, so an already-billed order must keep each kept
 * line's price + catalogue snapshot, while a newly added line is priced (and
 * snapshotted) from the current master data. DRAFT/APPOINTMENT/QUOTE rows have
 * not been billed yet and keep following the current list.
 */
describe('OrderService.update — historical price snapshot', () => {
  const PRISMA = 0;
  const EXTERNAL_ID = 8;
  const TENANT = 11;
  const REFERRAL_CREDIT = 12;
  const EMERGENCY_PRICING = 16;

  const testRow = (id: string, listPrice: number, name = id) => ({
    id,
    testName: name,
    testDisplayName: null,
    testCode: id.toUpperCase(),
    departmentId: 'dep1',
    listId: 'list1',
    listPrice,
    emergencyPrice: 0,
    priceMsrp: listPrice,
    isAllowDiscounts: true,
    tatMinValue: 1,
    tatMinUnit: 'HOURS',
    tatMaxValue: 2,
    tatMaxUnit: 'HOURS',
    scheduleDays: [],
    scheduleFrom: null,
    scheduleTo: null,
  });

  /**
   * Master data AFTER the price change: A 500→700, B 300→400, C is new at 250.
   * Stored order: A sold at 500 (item iA), B sold at 300 (item iB).
   */
  const build = (
    status: OrderStatus,
    appointmentStatus?: AppointmentStatus,
  ) => {
    const master = [testRow('A', 700), testRow('B', 400), testRow('C', 250)];
    const stored = [
      {
        id: 'iA',
        unitPrice: 500,
        branchLabTestId: 'A',
        branchLabPanelId: null,
      },
      {
        id: 'iB',
        unitPrice: 300,
        branchLabTestId: 'B',
        branchLabPanelId: null,
      },
    ];
    const existing = {
      branchId: 'b1',
      status,
      patientId: 'pt1',
      isEmergencyPricing: false,
      isBillGenerated: false,
      appointment: appointmentStatus ? { status: appointmentStatus } : null,
    };
    const txItem = {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'new1' }),
    };
    const tx = new Proxy(
      { orderItem: txItem },
      {
        get: (t, k: string) =>
          k in t
            ? (t as Record<string, unknown>)[k]
            : new Proxy({}, { get: () => jest.fn().mockResolvedValue(null) }),
      },
    );
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(existing) },
      orderItem: {
        findMany: jest.fn((args: { where: { id?: { in: string[] } } }) =>
          Promise.resolve(
            args.where.id
              ? stored.filter((s) => args.where.id!.in.includes(s.id))
              : stored.map((s) => ({ id: s.id })),
          ),
        ),
      },
      branchLabTest: {
        findMany: jest.fn((args: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            master.filter((m) => args.where.id.in.includes(m.id)),
          ),
        ),
      },
      branchLabPanel: { findMany: jest.fn().mockResolvedValue([]) },
      labReport: { findMany: jest.fn().mockResolvedValue([]) },
      withTenant: jest.fn((_t: string, fn: (t: unknown) => unknown) => fn(tx)),
    };
    const autoMock = () =>
      new Proxy({}, { get: () => jest.fn().mockResolvedValue(undefined) });
    const deps = Array.from({ length: 17 }, autoMock) as unknown[];
    deps[PRISMA] = prisma;
    deps[TENANT] = {
      getLocale: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }),
    };
    deps[EXTERNAL_ID] = {
      getConfiguredFormat: jest.fn().mockResolvedValue('NONE'),
    };
    deps[REFERRAL_CREDIT] = {
      assertOrderCreationAllowed: jest.fn().mockResolvedValue(undefined),
    };
    deps[EMERGENCY_PRICING] = {
      resolve: jest.fn().mockResolvedValue({ active: false }),
    };
    const service = new OrderService(
      ...(deps as ConstructorParameters<typeof OrderService>),
    );
    const internals = service as unknown as Record<string, jest.Mock>;
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
    internals.findById = jest.fn().mockResolvedValue({
      id: 'o1',
      status,
      patientId: 'pt1',
      items: [],
    });
    return { service, txItem };
  };

  const run = async (
    ctx: ReturnType<typeof build>,
    items: UpdateOrderDto['items'],
  ) => {
    await ctx.service.update('o1', 't1', 'p1', { items });
  };

  type UpdateArg = { where: { id: string }; data: Record<string, unknown> };
  const keptUpdate = (ctx: ReturnType<typeof build>, id: string) =>
    (ctx.txItem.update.mock.calls as Array<[UpdateArg]>).find(
      (c) => c[0].where.id === id,
    )?.[0];

  it('Scenario A — an ORDER keeps A=500 and B=300 after master → 700/400', async () => {
    const ctx = build(OrderStatus.ORDER);
    await run(ctx, [
      { id: 'iA', branchLabTestId: 'A' },
      { id: 'iB', branchLabTestId: 'B' },
    ]);
    for (const id of ['iA', 'iB']) {
      const call = keptUpdate(ctx, id);
      expect(call).toBeDefined();
      expect(call!.data).not.toHaveProperty('unitPrice');
      expect(call!.data).not.toHaveProperty('catalogSnapshot');
    }
    expect(ctx.txItem.create).not.toHaveBeenCalled();
  });

  it('Scenario B — removing A and adding C: A soft-deleted, B kept at 300, C at the current price + snapshot', async () => {
    const ctx = build(OrderStatus.ORDER);
    await run(ctx, [
      { id: 'iB', branchLabTestId: 'B' },
      { branchLabTestId: 'C' },
    ]);
    const removal = (
      ctx.txItem.updateMany.mock.calls as Array<
        [{ where: { id: { in: string[] } } }]
      >
    )[0][0];
    expect(removal.where.id.in).toEqual(['iA']);
    expect(keptUpdate(ctx, 'iB')!.data).not.toHaveProperty('unitPrice');
    expect(ctx.txItem.create).toHaveBeenCalledTimes(1);
    const created = (
      ctx.txItem.create.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(created.unitPrice).toBe(250);
    expect(created.catalogSnapshot).toMatchObject({
      v: 1,
      kind: 'TEST',
      code: 'C',
      listPrice: 250,
    });
  });

  it('a checked-in appointment is frozen too', async () => {
    const ctx = build(OrderStatus.APPOINTMENT, AppointmentStatus.CHECKED_IN);
    await run(ctx, [{ id: 'iA', branchLabTestId: 'A' }]);
    expect(keptUpdate(ctx, 'iA')!.data).not.toHaveProperty('unitPrice');
  });

  it.each([OrderStatus.DRAFT, OrderStatus.QUOTE])(
    'a %s (not yet billed) still follows the current list and refreshes the snapshot',
    async (status) => {
      const ctx = build(status);
      await run(ctx, [{ id: 'iA', branchLabTestId: 'A' }]);
      const data = keptUpdate(ctx, 'iA')!.data;
      expect(data.unitPrice).toBe(700);
      expect(data.catalogSnapshot).toMatchObject({ code: 'A', listPrice: 700 });
    },
  );
});
