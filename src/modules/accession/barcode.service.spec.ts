import { AccessionBarcodeSeparator, BarcodeCounterKind } from '@prisma/client';
import {
  BARCODE_CLASH_PROBE_MAX_SIZE,
  BARCODE_CLASH_PROBE_MIN_SIZE,
  BarcodeService,
} from './barcode.service';

/**
 * Order / sample barcode allocation from the tenant-wide counter.
 *
 * Regression for the 2026-11-07 outage: barcodes must be unique across all of
 * a tenant's branches, but each branch kept its own counter and skipped the
 * other branches' numbers one at a time. DIAGNOSTICS-BHAINSA (counter 10201)
 * had to skip 10202..11980; that ran past the 5 s transaction timeout and every
 * POST /orders for the branch returned 500. With one counter per tenant, every
 * branch gets the next number in two queries, however busy the others are.
 *
 * Real-database concurrency (simultaneous allocations, rollback) is covered by
 * test/barcode-counter-concurrency.e2e-spec.ts.
 */
describe('BarcodeService barcode allocation (tenant-wide counter)', () => {
  const TENANT = 'tenant-1';

  type Format = {
    prefix: string;
    separator: AccessionBarcodeSeparator;
    numberLength: number;
    suffix: string;
  };
  type Taken = { tenantId: string; value: string; deletedAt: Date | null };
  type Where = {
    tenantId: string;
    deletedAt: null;
    orderIdBarcode?: { in: string[] };
    barcode?: { in: string[] };
  };

  /**
   * In-memory stand-in for the tenant-scoped transaction client. `$queryRaw`
   * models the counter's `INSERT … ON CONFLICT DO UPDATE … RETURNING`
   * (create at the floor, else increment). Only the methods the allocator is
   * meant to use exist, so a regression to another access pattern (e.g. reading
   * the counter before writing it) fails loudly.
   */
  function fakeTx(
    opts: {
      counters?: Partial<Record<BarcodeCounterKind, number>>;
      orderFormats?: Record<string, Format>;
      sampleFormats?: Record<string, Format>;
      orderBarcodes?: Taken[];
      sampleBarcodes?: Taken[];
    } = {},
  ) {
    const counters = new Map<BarcodeCounterKind, number>(
      Object.entries(opts.counters ?? {}) as Array<
        [BarcodeCounterKind, number]
      >,
    );
    const orders = opts.orderBarcodes ?? [];
    const samples = opts.sampleBarcodes ?? [];
    const calls: string[] = [];
    const sqls: string[] = [];

    const takenIn = (rows: Taken[], where: Where, values: string[]) => {
      expect(where.tenantId).toBe(TENANT);
      expect(where.deletedAt).toBeNull();
      const wanted = new Set(values);
      return rows.filter(
        (r) =>
          r.tenantId === where.tenantId &&
          r.deletedAt === null &&
          wanted.has(r.value),
      );
    };

    const formatRow = (
      formats: Record<string, Format> | undefined,
      branchId: string,
      prefix: 'Order' | 'Sample',
    ) => {
      const f = formats?.[branchId];
      if (!f) return null;
      return {
        [`${prefix}BarcodeSettings_Prefix`]: f.prefix,
        [`${prefix}BarcodeSettings_Separator`]: f.separator,
        [`${prefix}BarcodeSettings_NumberLength`]: f.numberLength,
        [`${prefix}BarcodeSettings_Suffix`]: f.suffix,
      };
    };

    const tx = {
      $queryRaw: jest.fn(
        (strings: TemplateStringsArray, ...values: unknown[]) => {
          calls.push('counter.increment');
          sqls.push(strings.join('?'));
          const [tenantId, kind, first] = values as [
            string,
            BarcodeCounterKind,
            number,
          ];
          expect(tenantId).toBe(TENANT);
          const current = counters.get(kind);
          const next =
            current === undefined ? first : Math.max(current + 1, first);
          counters.set(kind, next);
          return Promise.resolve([{ current_number: next }]);
        },
      ),
      tenantBarcodeCounter: {
        update: jest.fn(
          (args: {
            where: {
              tenantId_kind: { tenantId: string; kind: BarcodeCounterKind };
            };
            data: { currentNumber: number };
          }) => {
            calls.push('counter.update');
            counters.set(
              args.where.tenantId_kind.kind,
              args.data.currentNumber,
            );
            return Promise.resolve({});
          },
        ),
      },
      accessionSetting: {
        findFirst: jest.fn(
          (args: {
            where: { tenantId: string; branchId: string };
            select: Record<string, boolean>;
          }) => {
            calls.push('settings.findFirst');
            const isOrder = 'OrderBarcodeSettings_Prefix' in args.select;
            return Promise.resolve(
              isOrder
                ? formatRow(opts.orderFormats, args.where.branchId, 'Order')
                : formatRow(opts.sampleFormats, args.where.branchId, 'Sample'),
            );
          },
        ),
      },
      order: {
        findMany: jest.fn((args: { where: Where }) => {
          calls.push('order.findMany');
          return Promise.resolve(
            takenIn(orders, args.where, args.where.orderIdBarcode!.in).map(
              (r) => ({ orderIdBarcode: r.value }),
            ),
          );
        }),
      },
      orderSample: {
        findMany: jest.fn((args: { where: Where }) => {
          calls.push('orderSample.findMany');
          return Promise.resolve(
            takenIn(samples, args.where, args.where.barcode!.in).map((r) => ({
              barcode: r.value,
            })),
          );
        }),
      },
    };
    return { tx, counters, orders, samples, calls, sqls };
  }

  const service = () => new BarcodeService(undefined as never);
  const taken = (values: string[], deletedAt: Date | null = null): Taken[] =>
    values.map((value) => ({ tenantId: TENANT, value, deletedAt }));
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

  describe('allocateOrderNumberInTx', () => {
    it('gives DIAGNOSTICS-BHAINSA the next tenant number in three queries, however far its old branch counter lagged', async () => {
      // Counter started by the migration at the tenant's highest issued number;
      // the other branches already used 10001..11980.
      const { tx, counters, calls } = fakeTx({
        counters: { ORDER: 11980 },
        orderBarcodes: taken(range(10001, 11980)),
      });

      const value = await service().allocateOrderNumberInTx(
        tx as never,
        TENANT,
        'bhainsa',
      );

      expect(value).toBe('11981');
      expect(counters.get(BarcodeCounterKind.ORDER)).toBe(11981);
      expect(calls).toEqual([
        'settings.findFirst',
        'counter.increment',
        'order.findMany',
      ]);
    });

    it('lets every branch draw from one sequence, so barcodes are unique tenant-wide', async () => {
      const fake = fakeTx({ counters: { ORDER: 11980 } });
      const branches = [
        'armoor',
        'bhainsa',
        'bodhan',
        'nirmal',
        'nzb',
        'varni',
      ];
      const svc = service();
      const issued: string[] = [];

      for (let round = 0; round < 3; round++) {
        for (const branchId of branches) {
          const value = await svc.allocateOrderNumberInTx(
            fake.tx as never,
            TENANT,
            branchId,
          );
          issued.push(value);
          fake.orders.push(...taken([value]));
        }
      }

      expect(issued).toEqual(range(11981, 11980 + branches.length * 3));
      expect(fake.calls.filter((c) => c === 'counter.update')).toHaveLength(0);
    });

    it("starts a tenant's first order barcode at 10001", async () => {
      const { tx, counters } = fakeTx();

      await expect(
        service().allocateOrderNumberInTx(tx as never, TENANT, 'new-branch'),
      ).resolves.toBe('10001');
      expect(counters.get(BarcodeCounterKind.ORDER)).toBe(10001);
    });

    it('advances the counter with one atomic upsert-increment, never a separate read', async () => {
      const { tx, sqls } = fakeTx({ counters: { ORDER: 12000 } });

      await service().allocateOrderNumberInTx(tx as never, TENANT, 'b1');

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const sql = sqls[0]!.replace(/\s+/g, ' ');
      expect(sql).toContain('INSERT INTO "tenant_barcode_counters"');
      expect(sql).toContain('ON CONFLICT ("tenant_id", "kind") DO UPDATE');
      expect(sql).toContain('"current_number" + 1');
      expect(sql).toContain('RETURNING "current_number"');
      expect(tx.$queryRaw.mock.calls[0]!.slice(1)).toEqual([
        TENANT,
        BarcodeCounterKind.ORDER,
        10001,
        10001,
      ]);
    });

    it('formats the tenant number with the branch format', async () => {
      const { tx } = fakeTx({
        counters: { ORDER: 10041 },
        orderFormats: {
          b1: {
            prefix: 'BH',
            separator: AccessionBarcodeSeparator.HYPHEN,
            numberLength: 7,
            suffix: 'X',
          },
        },
      });

      await expect(
        service().allocateOrderNumberInTx(tx as never, TENANT, 'b1'),
      ).resolves.toBe('BH-0010042-X');
    });

    it('skips past numbers already in use and moves the counter there (deploy window / imported data)', async () => {
      // e.g. the old per-branch code issued 10001..11985 while the counter row
      // still read 10000.
      const { tx, counters, calls } = fakeTx({
        counters: { ORDER: 10000 },
        orderBarcodes: taken(range(10001, 11985)),
      });

      const value = await service().allocateOrderNumberInTx(
        tx as never,
        TENANT,
        'b1',
      );

      expect(value).toBe('11986');
      expect(counters.get(BarcodeCounterKind.ORDER)).toBe(11986);
      // 100 + 400 + 1,600 candidates cover 10001..12100.
      expect(calls.filter((c) => c === 'order.findMany')).toHaveLength(3);
      expect(tx.tenantBarcodeCounter.update).toHaveBeenCalledWith({
        where: {
          tenantId_kind: { tenantId: TENANT, kind: BarcodeCounterKind.ORDER },
        },
        data: { currentNumber: 11986 },
      });
    });

    it('grows the clash probe from the min size to the max size, so even huge runs stay cheap', async () => {
      const { tx } = fakeTx({
        counters: { ORDER: 10000 },
        orderBarcodes: taken(range(10001, 60000)),
      });

      await expect(
        service().allocateOrderNumberInTx(tx as never, TENANT, 'b1'),
      ).resolves.toBe('60001');

      const sizes = tx.order.findMany.mock.calls.map(
        ([args]) => args.where.orderIdBarcode!.in.length,
      );
      expect(sizes).toEqual([
        100,
        400,
        1600,
        ...new Array<number>(10).fill(5000),
      ]);
      expect(sizes[0]).toBe(BARCODE_CLASH_PROBE_MIN_SIZE);
      expect(Math.max(...sizes)).toBe(BARCODE_CLASH_PROBE_MAX_SIZE);
      const probed = tx.order.findMany.mock.calls.flatMap(
        ([args]) => args.where.orderIdBarcode!.in,
      );
      expect(probed).toEqual(range(10001, 10000 + probed.length));
    });

    it('does not count soft-deleted orders as clashes', async () => {
      const { tx, calls } = fakeTx({
        counters: { ORDER: 10000 },
        orderBarcodes: taken(['10001'], new Date()),
      });

      await expect(
        service().allocateOrderNumberInTx(tx as never, TENANT, 'b1'),
      ).resolves.toBe('10001');
      expect(calls).not.toContain('counter.update');
    });

    it('never issues a number below 10001, even from a counter stored lower', async () => {
      const { tx } = fakeTx({ counters: { ORDER: 42 } });

      await expect(
        service().allocateOrderNumberInTx(tx as never, TENANT, 'b1'),
      ).resolves.toBe('10001');
    });
  });

  describe('allocateNumberInTx (sample barcodes)', () => {
    it('uses the SAMPLE counter and checks only samples, independent of order barcodes', async () => {
      const { tx, counters, calls } = fakeTx({
        counters: { ORDER: 11980, SAMPLE: 13187 },
        orderBarcodes: taken(range(13180, 13200)),
      });

      const value = await service().allocateNumberInTx(
        tx as never,
        TENANT,
        'bodhan',
      );

      expect(value).toBe('13188');
      expect(counters.get(BarcodeCounterKind.SAMPLE)).toBe(13188);
      expect(counters.get(BarcodeCounterKind.ORDER)).toBe(11980);
      expect(calls).toEqual([
        'settings.findFirst',
        'counter.increment',
        'orderSample.findMany',
      ]);
      expect(tx.$queryRaw.mock.calls[0]![2]).toBe(BarcodeCounterKind.SAMPLE);
    });

    it('gives two branches different sample barcodes even when their old counters converged (BHAINSA/NIRMAL both computed 10097)', async () => {
      const fake = fakeTx({ counters: { SAMPLE: 13187 } });
      const svc = service();

      const a = await svc.allocateNumberInTx(
        fake.tx as never,
        TENANT,
        'bhainsa',
      );
      const b = await svc.allocateNumberInTx(
        fake.tx as never,
        TENANT,
        'nirmal',
      );

      expect([a, b]).toEqual(['13188', '13189']);
    });

    it('skips sample barcodes already in use and uses the branch sample format', async () => {
      const { tx } = fakeTx({
        counters: { SAMPLE: 10000 },
        sampleFormats: {
          b1: {
            prefix: 'S',
            separator: AccessionBarcodeSeparator.SLASH,
            numberLength: 6,
            suffix: '',
          },
        },
        sampleBarcodes: taken(['S/010001', 'S/010002', '10003']),
      });

      await expect(
        service().allocateNumberInTx(tx as never, TENANT, 'b1'),
      ).resolves.toBe('S/010003');
    });
  });
});
