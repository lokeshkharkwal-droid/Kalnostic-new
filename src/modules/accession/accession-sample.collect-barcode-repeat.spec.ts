import { AccessionGroupingMode } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import {
  BARCODE_REMOVED_ACTION,
  BARCODE_RESTORED_ACTION,
  BARCODE_RESTORE_SKIPPED_ACTION,
  barcodeRemovedNote,
} from './utils/repeat-barcode.util';

/**
 * Collect makes the barcode of a repeated sample. A repeated sample stays in the same group as its mates (the group, and so
 * its actions, do not change), but:
 *  - it never borrows the old barcode that a group mate which was not repeated still carries;
 *  - the samples repeated together (same `repeatBatchId`) share ONE new barcode;
 *  - a group that was never repeated behaves exactly as before (the first collect allocates, later collects borrow).
 */
interface Row {
  id: string;
  orderId: string;
  branchId: string | null;
  departmentId: string | null;
  sampleGroupLabel: string | null;
  repeatBatchId: string | null;
  barcode: string | null;
  orderIdBarcode: string | null;
}

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  orderId: 'o1',
  branchId: 'b1',
  departmentId: 'd1',
  sampleGroupLabel: 'Serum',
  repeatBatchId: null,
  barcode: null,
  orderIdBarcode: null,
  ...over,
});

/** `all` = every live sample of the order; `collecting` = the ids being collected now (they have no barcode). */
function build(all: Row[], collecting: string[]) {
  const tx = {
    orderSample: {
      findMany: jest
        .fn()
        .mockImplementation((a: { where: { barcode?: unknown } }) =>
          Promise.resolve(
            a.where.barcode === null
              ? all.filter((r) => collecting.includes(r.id))
              : all.filter((r) => r.barcode !== null),
          ),
        ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        groupingMode: AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME,
      }),
    },
    orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  let n = 20000;
  const barcodeService = {
    allocateNumberInTx: jest.fn().mockImplementation(() => {
      n += 1;
      return Promise.resolve(String(n));
    }),
    generateAndUpload: jest
      .fn()
      .mockImplementation((v: string) => Promise.resolve(`https://img/${v}`)),
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
  const run = () =>
    service.assignBarcodesOnCollectInTx(tx, 't1', 'p1', collecting);
  /** The barcode each updateMany call wrote, with the ids it wrote it to. */
  const writes = () =>
    (
      tx.orderSample.updateMany.mock.calls as [
        { where: { id: { in: string[] } }; data: { barcode: string } },
      ][]
    ).map((c) => ({ ids: [...c[0].where.id.in].sort(), barcode: c[0].data.barcode }));
  return { tx, barcodeService, run, writes };
}

describe('Collect: the barcode of a repeated sample', () => {
  it('a repeated sample does NOT borrow the old barcode its group mate still carries: it gets a new one', async () => {
    const m = build(
      [
        row('s1', { barcode: '10001', orderIdBarcode: 'https://img/10001' }), // mate, not repeated
        row('s2', { repeatBatchId: 'batch-1' }), // repeated, barcode cleared
      ],
      ['s2'],
    );
    await m.run();
    expect(m.barcodeService.allocateNumberInTx).toHaveBeenCalledTimes(1);
    expect(m.writes()).toEqual([{ ids: ['s2'], barcode: '20001' }]);
  });

  it('samples repeated together (one batch) share ONE new barcode', async () => {
    const m = build(
      [
        row('s1', { barcode: '10001' }),
        row('s2', { repeatBatchId: 'batch-1' }),
        row('s3', { repeatBatchId: 'batch-1' }),
      ],
      ['s2', 's3'],
    );
    await m.run();
    expect(m.barcodeService.allocateNumberInTx).toHaveBeenCalledTimes(1);
    expect(m.writes()).toEqual([{ ids: ['s2', 's3'], barcode: '20001' }]);
  });

  it('a batch collected in two steps still shares the one new barcode (the second borrows it)', async () => {
    const m = build(
      [
        row('s1', { barcode: '10001' }),
        row('s2', {
          repeatBatchId: 'batch-1',
          barcode: '20001',
          orderIdBarcode: 'https://img/20001',
        }), // already collected
        row('s3', { repeatBatchId: 'batch-1' }),
      ],
      ['s3'],
    );
    await m.run();
    expect(m.barcodeService.allocateNumberInTx).not.toHaveBeenCalled();
    expect(m.writes()).toEqual([{ ids: ['s3'], barcode: '20001' }]);
  });

  it('samples repeated in different actions (different batches) get a barcode each', async () => {
    const m = build(
      [
        row('s2', { repeatBatchId: 'batch-1' }),
        row('s3', { repeatBatchId: 'batch-2' }),
      ],
      ['s2', 's3'],
    );
    await m.run();
    expect(m.barcodeService.allocateNumberInTx).toHaveBeenCalledTimes(2);
  });

  it('a group that was never repeated behaves as before: one allocation, later samples borrow it', async () => {
    const m = build([row('s1'), row('s2')], ['s1', 's2']);
    await m.run();
    expect(m.barcodeService.allocateNumberInTx).toHaveBeenCalledTimes(1);
    expect(m.writes()).toEqual([{ ids: ['s1', 's2'], barcode: '20001' }]);
  });

  it('a never-repeated sample still borrows the barcode of its never-repeated mate', async () => {
    const m = build(
      [
        row('s1', { barcode: '10001', orderIdBarcode: 'https://img/10001' }),
        row('s2'),
      ],
      ['s2'],
    );
    await m.run();
    expect(m.barcodeService.allocateNumberInTx).not.toHaveBeenCalled();
    expect(m.writes()).toEqual([{ ids: ['s2'], barcode: '10001' }]);
  });
});

describe('Retrieve out of Repeat puts the old barcode back', () => {
  const REMOVED = barcodeRemovedNote('10001');

  /**
   * @param notes the sample's latest "barcode removed" line (null = none)
   * @param opts clash: another order already uses the number; current: the barcode the sample holds now
   */
  const run = async (
    notes: string | null,
    opts: {
      clash?: boolean;
      current?: string | null;
      storageDown?: boolean;
      /** which barcode the history says the undone Repeat took off (default: the history cannot say -> latest line) */
      paired?: { known: boolean; barcode: string | null };
      branchId?: string | null;
    } = {},
  ) => {
    const tx = {
      orderSampleStatusHistory: {
        findFirst: jest
          .fn()
          .mockResolvedValue(notes === null ? null : { notes }),
        create: jest.fn().mockResolvedValue({}),
      },
      orderSample: {
        findFirst: jest
          .fn()
          .mockImplementation((a: { where: { orderId?: unknown } }) =>
            Promise.resolve(
              a.where.orderId !== undefined
                ? opts.clash
                  ? { id: 'other' }
                  : null
                : { barcode: opts.current ?? null },
            ),
          ),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const barcodeService = {
      generateAndUpload: opts.storageDown
        ? jest.fn().mockRejectedValue(new Error('storage down'))
        : jest.fn().mockResolvedValue('https://img/10001'),
      allocateNumberInTx: jest.fn().mockResolvedValue('10500'),
    };
    const service = Object.create(OrderSampleService.prototype) as {
      barcodeService: unknown;
      restoreBarcodeAfterRepeatUndoInTx: (
        ...a: unknown[]
      ) => Promise<unknown>;
    };
    service.barcodeService = barcodeService;
    (service as unknown as { logger: unknown }).logger = { warn: jest.fn() };
    const out = await service.restoreBarcodeAfterRepeatUndoInTx(
      tx,
      't1',
      'p1',
      {
        id: 's1',
        branchId: opts.branchId === undefined ? 'b1' : opts.branchId,
        orderId: 'o1',
      },
      'ACCEPTED',
      opts.paired ?? { known: false, barcode: null },
    );
    const lines = (
      tx.orderSampleStatusHistory.create.mock.calls as [
        { data: { action: string; notes: string } },
      ][]
    ).map((c) => c[0].data);
    return { tx, out, lines, barcodeService };
  };

  it('restores the barcode named in the latest "barcode removed" line, with its image, drops the batch tag and records it', async () => {
    const { tx, out, lines } = await run(REMOVED);
    expect(out).toEqual({
      barcode: '10001',
      orderIdBarcode: 'https://img/10001',
      repeatBatchId: null,
    });
    expect(tx.orderSample.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        barcode: '10001',
        orderIdBarcode: 'https://img/10001',
        repeatBatchId: null,
        updatedBy: 'p1',
      },
    });
    expect(lines).toEqual([
      expect.objectContaining({
        action: BARCODE_RESTORED_ACTION,
        notes: 'Repeat undone: barcode 10001 is back on the sample.',
      }),
    ]);
  });

  it('it reads the LATEST removed line (newest first, one row)', async () => {
    const { tx } = await run(REMOVED);
    expect(tx.orderSampleStatusHistory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: BARCODE_REMOVED_ACTION,
        }) as Record<string, unknown>,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('a new tube was collected in between: its barcode is replaced and the audit line names both', async () => {
    const { out, lines } = await run(REMOVED, { current: '10846' });
    expect(out).toMatchObject({ barcode: '10001' });
    expect(lines[0]!.notes).toBe(
      'Repeat undone: barcode 10001 is back on the sample (barcode 10846 removed).',
    );
  });

  it('the number is now used by a sample of ANOTHER order and the sample still holds a barcode: it keeps it, the audit line says why', async () => {
    const { tx, out, lines } = await run(REMOVED, { clash: true, current: '10846' });
    expect(out).toBeNull();
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(lines).toEqual([
      expect.objectContaining({
        action: BARCODE_RESTORE_SKIPPED_ACTION,
        notes:
          'Repeat undone, but barcode 10001 was not put back: it is now used by a sample of another order.',
      }),
    ]);
  });

  it('the number is used by ANOTHER order and the sample holds none (the usual case right after a Repeat): it is given a NEW barcode and the line says so', async () => {
    const { tx, out, lines, barcodeService } = await run(REMOVED, { clash: true });
    expect(barcodeService.allocateNumberInTx).toHaveBeenCalledWith(tx, 't1', 'b1');
    expect(out).toEqual({ barcode: '10500', orderIdBarcode: 'https://img/10001', repeatBatchId: null });
    expect(tx.orderSample.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { barcode: '10500', orderIdBarcode: 'https://img/10001', repeatBatchId: null, updatedBy: 'p1' },
    });
    expect(lines).toEqual([
      expect.objectContaining({
        action: BARCODE_RESTORE_SKIPPED_ACTION,
        notes:
          'Repeat undone, but barcode 10001 was not put back: it is now used by a sample of another order. New barcode 10500 was given to the sample instead: reprint its label.',
      }),
    ]);
  });

  it('the number is used by ANOTHER order and the sample has no branch (no counter): nothing is made, the line says why', async () => {
    const { tx, out, barcodeService } = await run(REMOVED, { clash: true, branchId: null });
    expect(out).toBeNull();
    expect(barcodeService.allocateNumberInTx).not.toHaveBeenCalled();
    expect(tx.orderSample.update).not.toHaveBeenCalled();
  });

  it('the history says WHICH Repeat is undone: that Repeat\'s barcode is restored, not the latest line (a sample repeated twice gets its barcodes back one by one)', async () => {
    // the latest "barcode removed" line names 10999 (the newer Repeat), but the Repeat being undone took 10001 off
    const { tx, out } = await run(barcodeRemovedNote('10999'), { paired: { known: true, barcode: '10001' } });
    expect(out).toMatchObject({ barcode: '10001' });
    expect(tx.orderSampleStatusHistory.findFirst).not.toHaveBeenCalled();
  });

  it('the Repeat being undone took off NO barcode (history says so): nothing is restored, an older line is NOT used', async () => {
    const { tx, out, lines } = await run(REMOVED, { paired: { known: true, barcode: null } });
    expect(out).toBeNull();
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it('the clash check looks at OTHER orders only (mates of the same order may share a number)', async () => {
    const { tx } = await run(REMOVED);
    const clashQuery = (
      tx.orderSample.findFirst.mock.calls as [
        { where: { orderId?: unknown; barcode?: string } },
      ][]
    )
      .map((c) => c[0].where)
      .find((w) => w.orderId !== undefined);
    expect(clashQuery).toMatchObject({
      barcode: '10001',
      orderId: { not: 'o1' },
    });
  });

  it('the file storage is down: the barcode STILL comes back (the picture is made when the label is printed), and the audit line says so', async () => {
    const { tx, out, lines } = await run(REMOVED, { storageDown: true });
    expect(out).toEqual({ barcode: '10001', orderIdBarcode: null, repeatBatchId: null });
    expect(tx.orderSample.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { barcode: '10001', orderIdBarcode: null, repeatBatchId: null, updatedBy: 'p1' },
    });
    expect(lines[0]!.notes).toContain('image could not be made now');
  });

  it('does nothing when no barcode was removed (the Repeat took off none, or there is no line)', async () => {
    const none = await run(null);
    expect(none.out).toBeNull();
    expect(none.tx.orderSample.update).not.toHaveBeenCalled();
    expect(none.lines).toEqual([]);
  });
});
