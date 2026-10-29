import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransferKind, TransferStatus } from '@prisma/client';
import {
  InvalidSampleTransitionException,
  SampleItemRemovedException,
  TransferItemRemovedException,
} from './exceptions/accession.exceptions';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import { SampleTransferService } from './sample-transfer.service';
import {
  findItemRemovedSampleIds,
  isAllItemsRemoved,
} from './utils/item-removed.util';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { BarcodeService } from './barcode.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';
import { AppointmentService } from '../appointment/appointment.service';

/**
 * "Test removed from order": a test with a report that is removed from its order
 * keeps its sample / transfer / report but they are frozen. Removal is derived from
 * the order item's `deletedAt`; a sample is item-removed when every live test link
 * belongs to a removed item.
 */

const REMOVED = { orderItem: { deletedAt: new Date('2026-10-01T00:00:00Z') } };
const LIVE = { orderItem: { deletedAt: null } };

describe('isAllItemsRemoved', () => {
  it('is true only when there is a live link and every one is on a removed item', () => {
    expect(isAllItemsRemoved([REMOVED])).toBe(true);
    expect(isAllItemsRemoved([REMOVED, REMOVED])).toBe(true);
    expect(isAllItemsRemoved([REMOVED, LIVE])).toBe(false);
    expect(isAllItemsRemoved([LIVE])).toBe(false);
    expect(isAllItemsRemoved([])).toBe(false);
  });
});

describe('findItemRemovedSampleIds', () => {
  it('answers for many samples with ONE query and groups the links per sample', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { sampleId: 's1', ...REMOVED },
      { sampleId: 's2', ...REMOVED },
      { sampleId: 's2', ...LIVE },
      { sampleId: 's3', ...LIVE },
    ]);
    const db = { orderSampleTest: { findMany } };
    const out = await findItemRemovedSampleIds(db as never, 't1', [
      's1',
      's2',
      's3',
      's4',
      's1',
    ]);
    expect([...out]).toEqual(['s1']);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect((findMany.mock.calls as unknown[][])[0]![0]).toMatchObject({
      where: {
        tenantId: 't1',
        sampleId: { in: ['s1', 's2', 's3', 's4'] },
        deletedAt: null,
      },
    });
  });

  it('asks nothing for an empty set', async () => {
    const findMany = jest.fn();
    const out = await findItemRemovedSampleIds(
      { orderSampleTest: { findMany } } as never,
      't1',
      [],
    );
    expect(out.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

function makeSampleService() {
  return new OrderSampleService(
    {} as unknown as PrismaService,
    {} as unknown as AccessionSettingsService,
    {} as unknown as LabReportService,
    {} as unknown as PdfReportTemplateService,
    {} as unknown as PdfTemplateConfigService,
    {} as unknown as EventEmitter2,
    {} as unknown as TenantService,
    {} as unknown as BarcodeService,
    {} as unknown as UserDepartmentScopeService,
    {} as unknown as AppointmentService,
  );
}

describe('OrderSampleService.transitionInTx - a removed test freezes its sample', () => {
  const build = (
    removed: boolean,
    over: Record<string, unknown> = {},
    opts: { received?: boolean } = {},
  ) => {
    const sample = {
      id: 's1',
      orderId: 'o1',
      tenantId: 't1',
      branchId: 'A',
      status: 'ACCEPTED',
      previousStatus: 'COLLECTED',
      sourceTransferId: null,
      ...over,
    };
    const tx = {
      orderSample: {
        findFirst: jest.fn().mockResolvedValue(sample),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(sample),
      },
      orderSampleStatusHistory: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ fromStatus: 'COLLECTED' }),
      },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      // names + audit entry of the recall
      branch: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      orderSampleTest: {
        findMany: jest.fn().mockResolvedValue([
          {
            sampleId: 's1',
            ...(removed ? REMOVED : LIVE),
          },
        ]),
      },
      sampleTransfer: {
        // Two reads share this mock: the OPEN transfers a Retrieve takes back (asks for
        // In-Transit / Picked Up) - one is open - and "did the receiving branch send it
        // back?" (the newest INTERNAL transfer) - it did not.
        findMany: jest.fn(
          (args: { where?: { transferStatus?: { in?: string[] } } }) =>
            Promise.resolve(
              args?.where?.transferStatus?.in
                ? [
                    {
                      id: 'tr1',
                      destinationBranchId: 'B',
                      transferStatus: 'IN_TRANSIT',
                      logisticsType: 'Courier',
                    },
                  ]
                : [],
            ),
        ),
        // the "has the receiver received it?" probe of Retrieve
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.received ? { id: 'tr1' } : null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = makeSampleService();
    const transition = (action: string, note: object = {}) =>
      (
        service as unknown as {
          transitionInTx: (...a: unknown[]) => Promise<unknown>;
        }
      ).transitionInTx(
        tx,
        't1',
        'p1',
        's1',
        action,
        () => ({ data: {} }),
        note,
      );
    return { tx, transition };
  };

  it.each([
    'send',
    'forward',
    'outsource',
    'repeat',
    'return',
    'accept',
    'hold',
    'collect',
    'acquire',
    'cancel',
  ])(
    '%s is refused with SAMPLE_ITEM_REMOVED and nothing is written',
    async (a) => {
      const { tx, transition } = build(true);
      const err = await transition(a).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SampleItemRemovedException);
      // a group "skip invalid" action skips it: it is an InvalidSampleTransitionException
      expect(err).toBeInstanceOf(InvalidSampleTransitionException);
      expect((err as SampleItemRemovedException).errorCode).toBe(
        'SAMPLE_ITEM_REMOVED',
      );
      expect(tx.orderSample.updateMany).not.toHaveBeenCalled();
      expect(tx.orderSample.update).not.toHaveBeenCalled();
      expect(tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
    },
  );

  it('Retrieve of a sample that is still here is refused too', async () => {
    const { transition } = build(true);
    await expect(transition('retrieve')).rejects.toBeInstanceOf(
      SampleItemRemovedException,
    );
  });

  it('store and discard stay open (the physical tube can be wound down)', async () => {
    for (const [action, status] of [
      ['store', 'ACCEPTED'],
      ['discard', 'STORED'],
    ] as const) {
      const { tx, transition } = build(true, { status });
      await transition(action);
      expect(tx.orderSample.update).toHaveBeenCalledTimes(1);
      // the freeze probe is not even asked for these two
      expect(tx.orderSampleTest.findMany).not.toHaveBeenCalled();
    }
  });

  it("the sender's Retrieve of a sample that is OUT at another branch stays open and removes (soft-deletes) the transfer", async () => {
    const { tx, transition } = build(true, { status: 'SENT_INTERNAL' });
    await transition('retrieve');
    expect(tx.orderSample.update).toHaveBeenCalledTimes(1);
    const closed = (
      tx.sampleTransfer.updateMany.mock.calls as unknown[][]
    )[0]![0];
    expect(closed).toMatchObject({
      data: { rejectionReason: 'Recalled via Retrieve' },
    });
    expect(
      (closed as { data: { deletedAt?: unknown } }).data.deletedAt,
    ).toBeInstanceOf(Date);
  });

  it('Retrieve of a removed sample is still refused once the receiver has RECEIVED/ACCEPTED it', async () => {
    const { tx, transition } = build(
      true,
      { status: 'SENT_INTERNAL' },
      { received: true },
    );
    const err = await transition('retrieve').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(SampleItemRemovedException);
    expect(err).toMatchObject({ errorCode: 'SAMPLE_RETRIEVE_BLOCKED' });
    expect(tx.orderSample.update).not.toHaveBeenCalled();
  });

  it('the system-driven moves are not user actions and pass', async () => {
    const { tx, transition } = build(true, { status: 'SENT_INTERNAL' });
    await transition('repeat', { system: true, force: true });
    expect(tx.orderSample.update).toHaveBeenCalledTimes(1);
    expect(tx.orderSampleTest.findMany).not.toHaveBeenCalled();
  });

  it('a sample shared with a surviving test is not frozen', async () => {
    const { tx, transition } = build(false);
    await transition('return', {});
    expect(tx.orderSample.update).toHaveBeenCalledTimes(1);
  });
});

describe('OrderSampleService.reconcileForOrderInTx - keep only where the work sits at the holder', () => {
  /**
   * `reportedItems`: removed items that have a live report. `outSamples`: samples with a transfer
   * still IN_TRANSIT / PICKED_UP / RECEIVED (what the "still out, not accepted" probe returns).
   */
  const build = (
    reportedItems: string[],
    samples: unknown[],
    outSamples: string[] = [],
  ) => {
    const tx = {
      labReport: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            reportedItems.map((orderItemId) => ({ orderItemId })),
          ),
        updateMany: jest.fn(),
      },
      orderSample: {
        findMany: jest.fn().mockResolvedValue(samples),
        update: jest.fn().mockResolvedValue({}),
      },
      orderSampleTest: { updateMany: jest.fn() },
      sampleTransfer: {
        findMany: jest
          .fn()
          .mockResolvedValue(outSamples.map((sampleId) => ({ sampleId }))),
        updateMany: jest.fn(),
      },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const run = (removed: string[]) =>
      (
        makeSampleService() as unknown as {
          reconcileForOrderInTx: (...a: unknown[]) => Promise<void>;
        }
      ).reconcileForOrderInTx(tx, 't1', 'A', 'p1', 'o1', {
        addedItemIds: [],
        removedItemIds: removed,
        now: new Date(),
      });
    const reportDeleteIds = () => {
      const call = (
        tx.labReport.updateMany.mock.calls as unknown[][]
      )[0]![0] as {
        where: { orderItemId: { in: string[] } };
      };
      return call.where.orderItemId.in;
    };
    return { tx, run, reportDeleteIds };
  };

  it('in-house accepted sample with a report: nothing is voided, unlinked, closed or deleted', async () => {
    const { tx, run, reportDeleteIds } = build(
      ['R1'],
      [{ id: 'S1', tests: [{ id: 'l1', orderItemId: 'R1' }] }],
    );
    await run(['R1']);
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(tx.orderSampleTest.updateMany).not.toHaveBeenCalled();
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    expect(reportDeleteIds()).toEqual([]); // the report is kept
  });

  it('a transfer already ACCEPTED (copy + report at the receiver) is kept whole: original and copy', async () => {
    // ACCEPTED is not in the "still out" probe, so both the sender's original and B's copy are kept
    const { tx, run, reportDeleteIds } = build(
      ['R1'],
      [
        { id: 'orig', tests: [{ id: 'l1', orderItemId: 'R1' }] },
        { id: 'copy', tests: [{ id: 'l2', orderItemId: 'R1' }] },
      ],
      [],
    );
    await run(['R1']);
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    expect(reportDeleteIds()).toEqual([]);
  });

  it.each(['IN_TRANSIT', 'PICKED_UP', 'RECEIVED'])(
    'a sample still out in a %s transfer is cleaned up as before even though a report exists (transfer closed, sample voided, report deleted)',
    async () => {
      const { tx, run, reportDeleteIds } = build(
        ['R1'],
        [{ id: 'S1', tests: [{ id: 'l1', orderItemId: 'R1' }] }],
        ['S1'],
      );
      await run(['R1']);
      expect(tx.sampleTransfer.updateMany).toHaveBeenCalledTimes(1);
      expect(
        (tx.sampleTransfer.updateMany.mock.calls as unknown[][])[0]![0],
      ).toMatchObject({
        where: {
          sampleId: 'S1',
          transferStatus: {
            in: ['IN_TRANSIT', 'PICKED_UP', 'RECEIVED', 'ACCEPTED'],
          },
        },
        data: {
          transferStatus: 'REJECTED',
          rejectionReason: 'Order item removed',
          clonedSampleId: null,
        },
      });
      expect(tx.orderSample.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'S1' },
          data: expect.objectContaining({ status: 'CANCELLED' }) as unknown,
        }),
      );
      expect(reportDeleteIds()).toEqual(['R1']);
    },
  );

  describe('a received COPY passed on to a third branch that has not accepted it yet', () => {
    const copy = (over: Record<string, unknown> = {}) => ({
      id: 'COPY',
      branchId: 'B',
      status: 'SENT_INTERNAL',
      previousStatus: 'ACCEPTED',
      sourceTransferId: 'tr-AB',
      tests: [{ id: 'l1', orderItemId: 'R1' }],
      ...over,
    });

    it.each(['IN_TRANSIT', 'PICKED_UP', 'RECEIVED'])(
      'the copy and its report are KEPT (frozen); only the onward %s hop is closed and the copy returns to Accepted',
      async () => {
        const { tx, run, reportDeleteIds } = build(['R1'], [copy()], ['COPY']);
        await run(['R1']);
        // the onward hop (B -> C) is closed as "Order item removed"
        expect(tx.sampleTransfer.updateMany).toHaveBeenCalledTimes(1);
        expect(
          (tx.sampleTransfer.updateMany.mock.calls as unknown[][])[0]![0],
        ).toMatchObject({
          where: {
            sampleId: 'COPY',
            kind: 'INTERNAL',
            transferStatus: { in: ['IN_TRANSIT', 'PICKED_UP', 'RECEIVED'] },
          },
          data: {
            transferStatus: 'REJECTED',
            rejectionReason: 'Order item removed',
          },
        });
        // the copy is NOT voided: it goes back from Sent to Accepted, still live, still at B
        expect(tx.orderSample.update).toHaveBeenCalledTimes(1);
        const upd = (
          tx.orderSample.update.mock.calls as unknown[][]
        )[0]![0] as {
          where: { id: string };
          data: Record<string, unknown>;
        };
        expect(upd.where).toEqual({ id: 'COPY' });
        expect(upd.data).toMatchObject({
          status: 'ACCEPTED',
          previousStatus: 'SENT_INTERNAL',
          processingBranchId: 'B',
          dispatchedAt: null,
        });
        expect(upd.data).not.toHaveProperty('deletedAt');
        expect(tx.orderSampleTest.updateMany).not.toHaveBeenCalled();
        expect(reportDeleteIds()).toEqual([]); // the report is kept
      },
    );

    it('with no usable previous status the copy goes back to Accepted', async () => {
      const { tx, run } = build(
        ['R1'],
        [copy({ previousStatus: 'OUTSOURCED' })],
        ['COPY'],
      );
      await run(['R1']);
      const upd = (tx.orderSample.update.mock.calls as unknown[][])[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(upd.data).toMatchObject({ status: 'ACCEPTED' });
    });

    it("the SENDER's original (no source transfer) out in the same state is still cleaned up as before", async () => {
      const { tx, run, reportDeleteIds } = build(
        ['R1'],
        [copy({ id: 'ORIG', branchId: 'A', sourceTransferId: null })],
        ['ORIG'],
      );
      await run(['R1']);
      expect(tx.orderSample.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ORIG' },
          data: expect.objectContaining({ status: 'CANCELLED' }) as unknown,
        }),
      );
      expect(reportDeleteIds()).toEqual(['R1']);
    });

    it('a copy with no report is cleaned up as before (nothing to keep)', async () => {
      const { tx, run } = build([], [copy()], []);
      await run(['R1']);
      expect(tx.orderSample.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'COPY' },
          data: expect.objectContaining({ status: 'CANCELLED' }) as unknown,
        }),
      );
    });
  });

  it('the "still out" probe only looks at INTERNAL transfers: an outsourced / forwarded tube (report worked by the sender) is kept and frozen, never cleaned up', async () => {
    // The probe finds nothing for an outsourced / forwarded tube (it asks for INTERNAL only), so the
    // tube, its transfer and its report - with the results already typed in - are all left alone.
    const { tx, run, reportDeleteIds } = build(
      ['R1'],
      [{ id: 'OUT1', tests: [{ id: 'l1', orderItemId: 'R1' }] }],
      [],
    );
    await run(['R1']);
    expect(
      (tx.sampleTransfer.findMany.mock.calls as unknown[][])[0]![0],
    ).toMatchObject({
      where: {
        kind: 'INTERNAL',
        transferStatus: { in: ['IN_TRANSIT', 'PICKED_UP', 'RECEIVED'] },
      },
    });
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    expect(reportDeleteIds()).toEqual([]);
  });

  it("without a report: today's clean-up still runs", async () => {
    const { tx, run, reportDeleteIds } = build(
      [],
      [{ id: 'S2', tests: [{ id: 'l2', orderItemId: 'R2' }] }],
    );
    await run(['R2']);
    expect(tx.sampleTransfer.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.orderSample.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'S2' } }),
    );
    expect(reportDeleteIds()).toEqual(['R2']);
    // no report: the "still out" probe is not even asked
    expect(tx.sampleTransfer.findMany).not.toHaveBeenCalled();
  });

  it('a tube that also carries a kept removed test stays whole', async () => {
    const { tx, run, reportDeleteIds } = build(
      ['R1'],
      [
        {
          id: 'S3',
          tests: [
            { id: 'l1', orderItemId: 'R1' },
            { id: 'l3', orderItemId: 'R3' },
          ],
        },
      ],
    );
    await run(['R1', 'R3']);
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(tx.orderSampleTest.updateMany).not.toHaveBeenCalled();
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    expect(reportDeleteIds()).toEqual([]);
  });

  it('a shared tube (removed + live test) that is out: only the removed link is dropped, as before', async () => {
    const { tx, run } = build(
      ['R1'],
      [
        {
          id: 'S4',
          tests: [
            { id: 'l1', orderItemId: 'R1' },
            { id: 'l9', orderItemId: 'LIVE' },
          ],
        },
      ],
      ['S4'],
    );
    await run(['R1']);
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(
      (tx.orderSampleTest.updateMany.mock.calls as unknown[][])[0]![0],
    ).toMatchObject({ where: { id: { in: ['l1'] } } });
  });
});

describe('OrderSampleService.returnCopyToOrigin - a removed test cannot be sent back', () => {
  it('refuses before reading anything else', async () => {
    const tx = {
      orderSample: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'copy1',
          branchId: 'B',
          status: 'ACCEPTED',
          sourceTransferId: 'tr1',
          tests: [],
        }),
      },
      orderSampleTest: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ sampleId: 'copy1', ...REMOVED }]),
      },
      sampleTransfer: { findFirst: jest.fn() },
    };
    await expect(
      makeSampleService().returnCopyToOrigin(
        tx as never,
        't1',
        'p1',
        'copy1',
        'why',
      ),
    ).rejects.toBeInstanceOf(SampleItemRemovedException);
    expect(tx.sampleTransfer.findFirst).not.toHaveBeenCalled();
  });
});

describe('SampleTransferService - a removed test freezes its transfer', () => {
  /** Transfers t1, t2; `removedSamples` are the sample ids whose test was removed. */
  function setup(
    removedSamples: string[],
    status: TransferStatus = TransferStatus.ACCEPTED,
  ) {
    const links = removedSamples.map((sampleId) => ({ sampleId, ...REMOVED }));
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      sampleTransfer: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: { where: { id: string } }) =>
            Promise.resolve({
              id: where.id,
              sampleId: `s-${where.id}`,
              kind: TransferKind.INTERNAL,
              transferStatus: status,
              destinationBranchId: 'B',
              logisticsType: 'Courier',
              receiveCondition: null,
              clonedSampleId: null,
            }),
          ),
        findMany: jest.fn().mockImplementation(() =>
          Promise.resolve(
            ['t1', 't2'].map((id) => ({
              id,
              sample: { accessionNo: `ACC-${id}` },
            })),
          ),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderSample: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ orderId: 'o1' }),
      },
      orderSampleTest: {
        findMany: jest.fn().mockImplementation(() => Promise.resolve(links)),
      },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
        fn(tx),
      ),
      sampleTransfer: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: { where: { id: string } }) =>
            Promise.resolve({
              id: where.id,
              sampleId: `s-${where.id}`,
              kind: TransferKind.INTERNAL,
              branchId: 'A',
              transferStatus: status,
              clonedSampleId: null,
            }),
          ),
      },
      orderSample: {
        findFirst: jest.fn().mockResolvedValue({ orderId: 'o1' }),
      },
      orderSampleTest: tx.orderSampleTest,
    };
    const samples = {
      isOrderCancelled: jest.fn().mockResolvedValue(false),
      transitionInTx: jest.fn().mockResolvedValue({}),
      returnCopyToOrigin: jest.fn().mockResolvedValue('sA'),
      recordReturnedByReceiverInTx: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new SampleTransferService(
      prisma as never,
      samples as never,
      {} as never,
      {} as never,
    );
    return { svc, tx, samples, prisma };
  }

  type Res = {
    succeeded: { id: string; itemRemoved: boolean }[];
    skipped: { id: string; code?: string; reason: string }[];
  };

  const actions: Array<
    [string, (s: SampleTransferService, skip: boolean) => Promise<Res>]
  > = [
    [
      'pick-up',
      (s, k) =>
        s.pickUp(['t1'], 't1', 'p1', 'B', {}, k) as unknown as Promise<Res>,
    ],
    [
      'receive',
      (s, k) =>
        s.receive(
          ['t1'],
          't1',
          'p1',
          'B',
          {} as never,
          k,
        ) as unknown as Promise<Res>,
    ],
    [
      'accept',
      (s, k) =>
        s.accept(['t1'], 't1', 'p1', 'B', {}, k) as unknown as Promise<Res>,
    ],
    [
      'reject',
      (s, k) =>
        s.reject(
          ['t1'],
          't1',
          'p1',
          'B',
          { rejectionReason: 'x' },
          k,
        ) as unknown as Promise<Res>,
    ],
    [
      'repeat',
      (s, k) =>
        s.repeatTransfer(
          ['t1'],
          't1',
          'p1',
          'B',
          { repeatReason: 'x' },
          k,
        ) as unknown as Promise<Res>,
    ],
  ];

  it.each(actions)(
    '%s is refused 409 TRANSFER_ITEM_REMOVED and writes nothing',
    async (_n, run) => {
      const m = setup(['s-t1']);
      const err = await run(m.svc, false).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TransferItemRemovedException);
      expect((err as TransferItemRemovedException).errorCode).toBe(
        'TRANSFER_ITEM_REMOVED',
      );
      expect(m.tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
      expect(m.samples.transitionInTx).not.toHaveBeenCalled();
      expect(m.samples.returnCopyToOrigin).not.toHaveBeenCalled();
    },
  );

  it.each(actions)(
    '%s with skip invalid skips it with its own sentence',
    async (_n, run) => {
      const m = setup(['s-t1']);
      const out = await run(m.svc, true);
      expect(out.succeeded).toEqual([]);
      expect(out.skipped).toHaveLength(1);
      expect(out.skipped[0]).toMatchObject({
        id: 't1',
        code: 'TRANSFER_ITEM_REMOVED',
        reason:
          'This test was removed from the order, so no further work is allowed on it.',
      });
      expect(m.tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    },
  );

  it('in a mixed group only the removed one is skipped', async () => {
    const m = setup(['s-t1'], TransferStatus.IN_TRANSIT);
    const out = (await m.svc.pickUp(
      ['t1', 't2'],
      't1',
      'p1',
      'B',
      {},
      true,
    )) as unknown as Res;
    expect(out.skipped.map((s) => s.id)).toEqual(['t1']);
    expect(out.succeeded.map((s) => s.id)).toEqual(['t2']);
  });

  it('Assign Center is refused too', async () => {
    const m = setup(['s-t1'], TransferStatus.IN_TRANSIT);
    await expect(
      m.svc.assignCenter('t1', 't1', 'p1', {}),
    ).rejects.toBeInstanceOf(TransferItemRemovedException);
  });

  it('findTransferById flags a removed transfer (and a normal one is not flagged)', async () => {
    const removed = await setup(['s-t1']).svc.findTransferById('t1', 't1');
    expect(removed.itemRemoved).toBe(true);
    const normal = await setup([]).svc.findTransferById('t1', 't1');
    expect(normal.itemRemoved).toBe(false);
  });
});
