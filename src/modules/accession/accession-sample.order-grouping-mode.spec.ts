import { AccessionGroupingMode } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';

/**
 * Every order carries its OWN grouping mode (`orders.grouping_mode`), decided once when it first gets
 * samples. These tests pin the three places that depend on it: the helper that decides it, Collect (barcode
 * groups) and the display grouping - so a change of the tenant's mode can never regroup an existing order.
 */

const ORDER = AccessionGroupingMode.ORDER;
const DEPARTMENT = AccessionGroupingMode.DEPARTMENT;
const DSN = AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME;

type Mode = AccessionGroupingMode | null;

interface OrderRow {
  id: string;
  groupingMode: Mode;
}

/** A tx with `orders` (each with its stored mode) and a tenant whose CURRENT mode is `tenantMode`. */
function txWith(orders: OrderRow[], tenantMode: AccessionGroupingMode) {
  const store = new Map(orders.map((o) => [o.id, o.groupingMode]));
  const order = {
    findMany: jest
      .fn()
      .mockImplementation((a: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          a.where.id.in
            .filter((id) => store.has(id))
            .map((id) => ({ id, groupingMode: store.get(id) ?? null })),
        ),
      ),
    // `WHERE grouping_mode IS NULL`: only an order with no mode yet takes the value (like the database does)
    updateMany: jest
      .fn()
      .mockImplementation(
        (a: {
          where: { id: { in: string[] } };
          data: { groupingMode: Mode };
        }) => {
          let count = 0;
          for (const id of a.where.id.in) {
            if (store.get(id) === null) {
              store.set(id, a.data.groupingMode);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        },
      ),
  };
  const tenant = {
    update: jest.fn().mockResolvedValue({ groupingMode: tenantMode }),
  };
  return { order, tenant, store };
}

const serviceOf = () =>
  Object.create(OrderSampleService.prototype) as unknown as {
    resolveOrderGroupingModesInTx: (
      tx: unknown,
      tenantId: string,
      orderIds: string[],
    ) => Promise<Map<string, AccessionGroupingMode>>;
  };

describe('OrderSampleService.resolveOrderGroupingModesInTx - the mode an order follows', () => {
  it('an order that has a mode keeps it, whatever the tenant mode is now - and the tenant row is never touched', async () => {
    const tx = txWith(
      [
        { id: 'o1', groupingMode: DEPARTMENT },
        { id: 'o2', groupingMode: ORDER },
      ],
      DSN, // the tenant switched to something else meanwhile
    );
    const modes = await serviceOf().resolveOrderGroupingModesInTx(tx, 't1', [
      'o1',
      'o2',
    ]);
    expect(modes.get('o1')).toBe(DEPARTMENT);
    expect(modes.get('o2')).toBe(ORDER);
    expect(tx.tenant.update).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('an order with no mode yet is decided from the tenant mode, read under the tenant row lock, and stored for good', async () => {
    const tx = txWith([{ id: 'o1', groupingMode: null }], ORDER);
    const modes = await serviceOf().resolveOrderGroupingModesInTx(tx, 't1', [
      'o1',
    ]);
    expect(modes.get('o1')).toBe(ORDER);
    // the lock + read is ONE statement on the tenant row ...
    expect(tx.tenant.update).toHaveBeenCalledTimes(1);
    expect(tx.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        select: { groupingMode: true },
      }),
    );
    // ... and the order is only changed WHERE it still has no mode
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['o1'] }, tenantId: 't1', groupingMode: null },
      data: { groupingMode: ORDER },
    });
    expect(tx.store.get('o1')).toBe(ORDER);
  });

  it('when another transaction decided the order first, THAT mode wins (never two different ones)', async () => {
    const tx = txWith([{ id: 'o1', groupingMode: null }], ORDER);
    // between our first read and our update, the other transaction stored DEPARTMENT
    tx.order.updateMany.mockImplementationOnce(() => {
      tx.store.set('o1', DEPARTMENT);
      return Promise.resolve({ count: 0 });
    });
    const modes = await serviceOf().resolveOrderGroupingModesInTx(tx, 't1', [
      'o1',
    ]);
    expect(modes.get('o1')).toBe(DEPARTMENT);
  });

  it('decides only the orders that have no mode: a mixed batch touches the tenant once', async () => {
    const tx = txWith(
      [
        { id: 'o1', groupingMode: DEPARTMENT },
        { id: 'o2', groupingMode: null },
      ],
      ORDER,
    );
    const modes = await serviceOf().resolveOrderGroupingModesInTx(tx, 't1', [
      'o1',
      'o2',
      'o1',
    ]);
    expect(modes.get('o1')).toBe(DEPARTMENT);
    expect(modes.get('o2')).toBe(ORDER);
    expect(tx.tenant.update).toHaveBeenCalledTimes(1);
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['o2'] }, tenantId: 't1', groupingMode: null },
      data: { groupingMode: ORDER },
    });
  });

  it('no orders: no query at all', async () => {
    const tx = txWith([], ORDER);
    const modes = await serviceOf().resolveOrderGroupingModesInTx(tx, 't1', []);
    expect(modes.size).toBe(0);
    expect(tx.order.findMany).not.toHaveBeenCalled();
  });
});

describe("Collect uses each order's own mode for its barcode groups", () => {
  interface Row {
    id: string;
    orderId: string;
    departmentId: string;
    sampleGroupLabel: string;
  }
  const r = (id: string, orderId: string, departmentId: string): Row => ({
    id,
    orderId,
    departmentId,
    sampleGroupLabel: 'Serum',
  });

  function collect(
    orders: OrderRow[],
    rows: Row[],
    tenantMode: AccessionGroupingMode,
  ) {
    const t = txWith(orders, tenantMode);
    const tx = {
      ...t,
      orderSample: {
        findMany: jest
          .fn()
          .mockImplementation((a: { where: { barcode?: unknown } }) =>
            Promise.resolve(
              a.where.barcode === null
                ? rows.map((x) => ({
                    ...x,
                    branchId: 'b1',
                    repeatBatchId: null,
                  }))
                : [],
            ),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenantBarcodeCounter: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    let n = 500;
    const barcodeService = {
      allocateNumberInTx: jest
        .fn()
        .mockImplementation(() => Promise.resolve(String(++n))),
      generateAndUpload: jest.fn().mockResolvedValue('https://img'),
    };
    const service = Object.create(
      OrderSampleService.prototype,
    ) as unknown as Record<string, unknown> & {
      assignBarcodesOnCollectInTx: (
        tx: unknown,
        tenantId: string,
        personId: string | null,
        ids: string[],
      ) => Promise<void>;
    };
    service.barcodeService = barcodeService;
    return {
      tx,
      barcodeService,
      run: () =>
        service.assignBarcodesOnCollectInTx(
          tx,
          't1',
          'p1',
          rows.map((x) => x.id),
        ),
      written: () =>
        (
          tx.orderSample.updateMany.mock.calls as [
            { where: { id: { in: string[] } }; data: { barcode: string } },
          ][]
        )
          .map((c) => ({
            ids: [...c[0].where.id.in].sort(),
            barcode: c[0].data.barcode,
          }))
          .sort((a, b) => a.ids[0]!.localeCompare(b.ids[0]!)),
    };
  }

  it('two orders collected together: the one in ORDER mode shares one barcode, the one in DEPARTMENT mode gets one per department', async () => {
    const m = collect(
      [
        { id: 'oA', groupingMode: ORDER },
        { id: 'oB', groupingMode: DEPARTMENT },
      ],
      [
        r('a1', 'oA', 'd1'),
        r('a2', 'oA', 'd2'),
        r('b1', 'oB', 'd1'),
        r('b2', 'oB', 'd2'),
      ],
      DSN,
    );
    await m.run();
    const w = m.written();
    expect(w).toHaveLength(3); // oA: one group; oB: two groups
    expect(w.find((x) => x.ids.includes('a1'))!.ids).toEqual(['a1', 'a2']);
    expect(w.find((x) => x.ids.includes('b1'))!.ids).toEqual(['b1']);
    expect(w.find((x) => x.ids.includes('b2'))!.ids).toEqual(['b2']);
  });

  it('the tenant mode now is irrelevant to an order that already has its own', async () => {
    const m = collect(
      [{ id: 'oA', groupingMode: DEPARTMENT }],
      [r('a1', 'oA', 'd1'), r('a2', 'oA', 'd2')],
      ORDER, // the tenant switched to "one barcode per order" after this order was made
    );
    await m.run();
    expect(m.written()).toHaveLength(2); // still one barcode per department
    expect(m.tx.tenant.update).not.toHaveBeenCalled();
  });

  it('an order with no mode yet is decided BEFORE the barcode counter lock (tenant row, then counter: the same order order creation takes)', async () => {
    const m = collect(
      [{ id: 'oA', groupingMode: null }],
      [r('a1', 'oA', 'd1')],
      ORDER,
    );
    await m.run();
    expect(m.tx.tenant.update.mock.invocationCallOrder[0]!).toBeLessThan(
      m.tx.tenantBarcodeCounter.updateMany.mock.invocationCallOrder[0]!,
    );
    expect(m.written()).toHaveLength(1);
  });
});

describe("the display grouping (buildOrderGroup) follows the order's own mode", () => {
  const group = (rows: unknown[], fallback: AccessionGroupingMode) =>
    (
      Object.create(OrderSampleService.prototype) as unknown as {
        buildOrderGroup: (
          orderId: string,
          rows: unknown[],
          fallbackMode: AccessionGroupingMode,
          deptNameById: Map<string, string>,
          tat: unknown,
          nowMs: number,
        ) => {
          groupingMode: AccessionGroupingMode;
          groups: { sampleIds: string[] }[];
        };
      }
    ).buildOrderGroup(
      'o1',
      rows,
      fallback,
      new Map(),
      { warningMinutes: 1, criticalMinutes: 2 },
      Date.now(),
    );

  const row = (id: string, dept: string, mode: Mode) => ({
    id,
    orderId: 'o1',
    departmentId: dept,
    sampleGroupLabel: 'Serum',
    barcode: null,
    status: 'NEW',
    createdAt: new Date(),
    order: { id: 'o1', groupingMode: mode },
  });

  it('an order in DEPARTMENT mode shows two groups even when the tenant is now ORDER', () => {
    const g = group(
      [row('s1', 'd1', DEPARTMENT), row('s2', 'd2', DEPARTMENT)],
      ORDER,
    );
    expect(g.groupingMode).toBe(DEPARTMENT);
    expect(g.groups).toHaveLength(2);
  });

  it('an order in ORDER mode shows one group even when the tenant is now DEPARTMENT', () => {
    const g = group(
      [row('s1', 'd1', ORDER), row('s2', 'd2', ORDER)],
      DEPARTMENT,
    );
    expect(g.groupingMode).toBe(ORDER);
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0]!.sampleIds.sort()).toEqual(['s1', 's2']);
  });

  it('an order with no mode yet falls back to the tenant mode', () => {
    const g = group([row('s1', 'd1', null), row('s2', 'd2', null)], ORDER);
    expect(g.groupingMode).toBe(ORDER);
    expect(g.groups).toHaveLength(1);
  });
});
