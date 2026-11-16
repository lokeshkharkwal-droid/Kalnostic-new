import 'reflect-metadata';
import { OrderStatus, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  OrderCodeConflictException,
  OrderIdempotencyKeyConflictException,
} from './exceptions/order.exceptions';

/**
 * Duplicate-submission guard for POST /orders (incident 2026-11-16,
 * DIAGNOSTICS-NIRMAL ORD-02869/02870 etc.): the Create Order screen sent the
 * same submission twice ~200 ms apart and each request created its own order +
 * payment rows. Every retry of one submission now carries the same
 * `idempotencyKey`, stored on the order under a per-tenant unique index:
 *  - a sequential repeat returns the stored order without writing anything;
 *  - a concurrent repeat loses on the unique index (P2002) and also returns it;
 *  - a key that belongs to a different patient/branch, or to a deleted order,
 *    is refused (409) instead of answering with — or creating — another order.
 */
describe('OrderService.create — idempotent submissions', () => {
  const TENANT = 'tenant-1';
  const BRANCH = 'branch-1';
  const PATIENT = 'patient-1';
  const PERSON = 'person-1';
  const KEY = '7b0c6a52-3f4e-4d0a-9a51-2f1c4b7e9d10';

  const orderFindFirst = jest.fn();
  const withTenant = jest.fn();
  const emitAsync = jest.fn().mockResolvedValue([]);
  const prisma = { order: { findFirst: orderFindFirst }, withTenant };

  const service = new OrderService(
    prisma as never, // prisma
    undefined as never, // appointmentService
    undefined as never, // orderSamples
    undefined as never, // barcodeService
    undefined as never, // slotReservation
    undefined as never, // homeVisitCollections
    undefined as never, // pdfReportTemplateService
    { getForBranch: jest.fn().mockResolvedValue(null) } as never,
    {
      getConfiguredFormat: jest.fn().mockResolvedValue('NONE'),
    } as never, // externalIdService
    { emitAsync } as never, // eventEmitter
    undefined as never, // shareService
    {
      getLocale: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }),
    } as never, // tenantService
    {
      assertOrderCreationAllowed: jest.fn().mockResolvedValue(undefined),
    } as never, // referralCredit
    undefined as never, // patientService
    undefined as never, // userDepartmentScope
    undefined as never, // config
  );

  /** Private collaborators of create() that are not under test here. */
  const internals = service as unknown as Record<string, jest.Func>;
  const spyOn = (name: string): jest.SpyInstance => jest.spyOn(internals, name);

  const composed = (id: string) =>
    ({ id, orderCode: `CODE-${id}`, patientId: PATIENT }) as never;
  let findById: jest.SpyInstance;
  let assertPatient: jest.SpyInstance;

  const dto = (over: Partial<CreateOrderDto> = {}): CreateOrderDto => ({
    status: OrderStatus.ORDER,
    orderDate: '2026-11-16',
    orderType: 'WALK_IN',
    billingType: 'CASH_CLIENT',
    patientId: PATIENT,
    items: [{ branchLabTestId: 'blt-1' }],
    payments: [{ netAmount: 80, payableAmount: 80, paidAmount: 0 }],
    idempotencyKey: KEY,
    ...over,
  });

  const storedOrder = (over: Record<string, unknown> = {}) => ({
    id: 'order-1',
    orderCode: 'ORD-02875',
    patientId: PATIENT,
    branchId: BRANCH,
    deletedAt: null,
    ...over,
  });

  const p2002 = (target: unknown) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { modelName: 'Order', target },
    });

  const create = (body: CreateOrderDto) =>
    service.create(TENANT, BRANCH, PERSON, body);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    findById = jest
      .spyOn(service, 'findById')
      .mockImplementation((id: string) => Promise.resolve(composed(id)));
    assertPatient = spyOn('assertPatient').mockResolvedValue('FEMALE');
    for (const name of [
      'assertItems',
      'assertReferrals',
      'assertBillingRules',
    ]) {
      spyOn(name).mockResolvedValue(undefined);
    }
    for (const name of [
      'assertAppointmentSection',
      'assertFinalizedOrder',
      'assertDiscountAndTdsRules',
    ]) {
      spyOn(name).mockReturnValue(undefined);
    }
    spyOn('loadItemUnitPrices').mockResolvedValue(new Map());
  });

  it('returns the already-created order for a repeated submission, without validating or writing again', async () => {
    orderFindFirst.mockResolvedValue(storedOrder());

    await expect(create(dto())).resolves.toEqual(composed('order-1'));

    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT, idempotencyKey: KEY },
      }),
    );
    expect(findById).toHaveBeenCalledWith('order-1', TENANT);
    expect(withTenant).not.toHaveBeenCalled();
    expect(assertPatient).not.toHaveBeenCalled();
    // No second "order created" notification for the same order.
    expect(emitAsync).not.toHaveBeenCalled();
  });

  it('a concurrent repeat that loses on the unique index returns the winning order instead of a second one', async () => {
    // Pre-check: the winner has not committed yet. After the insert fails on the
    // unique index, the winner's row is visible.
    orderFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedOrder({ id: 'order-winner' }));
    withTenant.mockRejectedValue(p2002(['tenant_id', 'idempotency_key']));

    await expect(create(dto())).resolves.toEqual(composed('order-winner'));

    expect(withTenant).toHaveBeenCalledTimes(1);
    expect(orderFindFirst).toHaveBeenCalledTimes(2);
    expect(emitAsync).not.toHaveBeenCalled();
  });

  it('also recognises the violation when Prisma names the index instead of the columns', async () => {
    orderFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedOrder({ id: 'order-winner' }));
    withTenant.mockRejectedValue(p2002('orders_tenant_id_idempotency_key_key'));

    await expect(create(dto())).resolves.toEqual(composed('order-winner'));
  });

  it('stores the key on the order it inserts', async () => {
    const stop = new Error('stop after the order insert');
    const orderCreate = jest.fn().mockRejectedValue(stop);
    orderFindFirst.mockResolvedValue(null);
    withTenant.mockImplementation(
      (_tenant: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          tenant: {
            update: jest
              .fn()
              .mockResolvedValue({ orderCounter: 1, diagnosticBillCounter: 1 }),
          },
          order: { create: orderCreate, findFirst: jest.fn() },
          branch: { findUnique: jest.fn().mockResolvedValue(null) },
        }),
    );

    await expect(create(dto())).rejects.toBe(stop);

    expect(orderCreate).toHaveBeenCalledTimes(1);
    const firstCall = orderCreate.mock.calls[0] as [
      { data: { idempotencyKey: string | null } },
    ];
    expect(firstCall[0].data.idempotencyKey).toBe(KEY);
  });

  it('refuses a key that already belongs to another patient’s order (409), creating nothing', async () => {
    orderFindFirst.mockResolvedValue(storedOrder({ patientId: 'patient-2' }));

    await expect(create(dto())).rejects.toBeInstanceOf(
      OrderIdempotencyKeyConflictException,
    );
    expect(withTenant).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it('refuses a key that already belongs to another branch’s order (409)', async () => {
    orderFindFirst.mockResolvedValue(storedOrder({ branchId: 'branch-2' }));

    await expect(create(dto())).rejects.toBeInstanceOf(
      OrderIdempotencyKeyConflictException,
    );
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('refuses a key whose order has since been deleted (409) rather than creating a new one', async () => {
    orderFindFirst.mockResolvedValue(
      storedOrder({ deletedAt: new Date('2026-11-16T14:00:00Z') }),
    );

    await expect(create(dto())).rejects.toBeInstanceOf(
      OrderIdempotencyKeyConflictException,
    );
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('still reports any other unique violation as before (not as a replay)', async () => {
    orderFindFirst.mockResolvedValue(null);
    withTenant.mockRejectedValue(p2002(['tenant_id', 'order_code']));

    await expect(create(dto())).rejects.toBeInstanceOf(
      OrderCodeConflictException,
    );
    // Only the pre-check lookup — an unrelated conflict triggers no replay.
    expect(orderFindFirst).toHaveBeenCalledTimes(1);
  });

  it('a request without a key behaves exactly as before: no lookup, nothing stored', async () => {
    const stop = new Error('stop after the order insert');
    const orderCreate = jest.fn().mockRejectedValue(stop);
    withTenant.mockImplementation(
      (_tenant: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          tenant: {
            update: jest
              .fn()
              .mockResolvedValue({ orderCounter: 1, diagnosticBillCounter: 1 }),
          },
          order: { create: orderCreate, findFirst: jest.fn() },
          branch: { findUnique: jest.fn().mockResolvedValue(null) },
        }),
    );

    await expect(create(dto({ idempotencyKey: undefined }))).rejects.toBe(stop);

    expect(orderFindFirst).not.toHaveBeenCalled();
    const firstCall = orderCreate.mock.calls[0] as [
      { data: { idempotencyKey: string | null } },
    ];
    expect(firstCall[0].data.idempotencyKey).toBeNull();
  });
});

describe('CreateOrderDto.idempotencyKey', () => {
  const errorsFor = async (idempotencyKey: unknown) => {
    const instance = plainToInstance(CreateOrderDto, {
      orderDate: '2026-11-16',
      orderType: 'WALK_IN',
      billingType: 'CASH_CLIENT',
      patientId: '0b725080-7dcf-4ddc-ba18-867ba6729b2a',
      idempotencyKey,
    });
    const errors = await validate(instance);
    return errors.filter((e) => e.property === 'idempotencyKey');
  };

  it('accepts a UUID or no key at all', async () => {
    expect(await errorsFor('7b0c6a52-3f4e-4d0a-9a51-2f1c4b7e9d10')).toEqual([]);
    expect(await errorsFor(undefined)).toEqual([]);
  });

  it('rejects anything that is not a UUID', async () => {
    expect(await errorsFor('click-1')).toHaveLength(1);
    expect(await errorsFor(42)).toHaveLength(1);
  });
});
