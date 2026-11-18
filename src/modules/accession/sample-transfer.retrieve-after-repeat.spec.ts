import { SampleStatus, TransferKind, TransferStatus } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import {
  TransferRetrieveAfterSenderConfirmedException,
  refusalMessage,
} from './exceptions/accession.exceptions';
import type { KaltrosException } from '../../common/exceptions/kaltros.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderSampleService } from './accession-sample.service';
import { BranchService } from '../branch/branch.service';
import { PermissionCheckService } from '../permissions/services/permission-check.service';

/**
 * The receiving branch asked for a Repeat (the transfer is closed as Repeat) and the SENDER confirmed it (its sample left
 * "Sent" and waits for a new tube). Retrieve on that transfer is refused: stepping it back to Received would leave the two
 * branches disagreeing (and the receiver could Accept again and take the report). Before the sender confirms, Retrieve stays.
 */
describe('SampleTransferService.retrieveTransfer - after the sender confirmed a Repeat', () => {
  const build = (opts: {
    kind?: TransferKind;
    transferStatus?: TransferStatus;
    senderSample: SampleStatus;
  }) => {
    const transfer = {
      id: 'tr1',
      kind: opts.kind ?? TransferKind.INTERNAL,
      transferStatus: opts.transferStatus ?? TransferStatus.REPEAT,
      sampleId: 's1',
      destinationBranchId: 'b2',
      clonedSampleId: null,
    };
    const tx = {
      sampleTransfer: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'tr1', sample: { accessionNo: 'ACC-1' } }]),
        findFirst: jest.fn().mockResolvedValue(transfer),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderSample: {
        findFirst: jest.fn().mockResolvedValue({
          id: 's1',
          branchId: 'b1',
          status: opts.senderSample,
        }),
      },
      orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
      orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, cb: (t: typeof tx) => unknown) =>
        cb(tx),
      ),
    };
    const service = new SampleTransferService(
      prisma as unknown as PrismaService,
      {} as unknown as OrderSampleService,
      {} as unknown as BranchService,
      {} as unknown as PermissionCheckService,
    );
    jest
      .spyOn(service as never, 'findTransferById')
      .mockImplementation(((id: string) => Promise.resolve({ id })) as never);
    // The receiving branch (b2) is the one retrieving.
    /** The status the transfer was written to (the claim that locks the row writes none). */
    const writtenStatus = () =>
      (
        tx.sampleTransfer.updateMany.mock.calls as unknown as [
          { data: { transferStatus?: TransferStatus } },
        ][]
      )
        .map((c) => c[0].data.transferStatus)
        .find((x) => x !== undefined);
    const retrieve = (skipInvalid = false) =>
      service.retrieveTransfer(['tr1'], 't1', 'p1', 'b2', {}, skipInvalid);
    return { tx, retrieve, writtenStatus };
  };

  it.each([
    SampleStatus.REPEAT, // the sender confirmed: it waits for a new tube
    SampleStatus.COLLECTED, // ... and has already been collected again
    SampleStatus.ACCEPTED,
  ])(
    'is refused while the sender sample is %s, and nothing is written',
    async (senderSample) => {
      const { retrieve, tx, writtenStatus } = build({ senderSample });
      const refusal = await retrieve().catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(
        TransferRetrieveAfterSenderConfirmedException,
      );
      expect(
        (refusal as TransferRetrieveAfterSenderConfirmedException).errorCode,
      ).toBe('TRANSFER_RETRIEVE_AFTER_SENDER_CONFIRMED');
      expect(writtenStatus()).toBeUndefined();
      expect(tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
    },
  );

  it('a group action with skip-invalid names the transfer instead of failing', async () => {
    const { retrieve, writtenStatus } = build({
      senderSample: SampleStatus.REPEAT,
    });
    const r = await retrieve(true);
    expect(r.succeeded).toEqual([]);
    expect(r.skipped).toEqual([
      expect.objectContaining({
        id: 'tr1',
        accessionNo: 'ACC-1',
        code: 'TRANSFER_RETRIEVE_AFTER_SENDER_CONFIRMED',
      }),
    ]);
    expect(writtenStatus()).toBeUndefined();
  });

  it('before the sender confirms (its sample is still Sent) Retrieve steps the transfer back to Received', async () => {
    const { retrieve, writtenStatus } = build({
      senderSample: SampleStatus.SENT_INTERNAL,
    });
    const r = await retrieve();
    expect(r.skipped).toEqual([]);
    expect(writtenStatus()).toBe(TransferStatus.RECEIVED);
  });

  it('only a Repeat is affected: an Accepted transfer is retrieved as before whatever the sender sample says', async () => {
    const { retrieve, tx } = build({
      transferStatus: TransferStatus.ACCEPTED,
      senderSample: SampleStatus.SENT_INTERNAL,
    });
    await retrieve();
    expect(tx.sampleTransfer.updateMany).toHaveBeenCalled();
  });

  it('an External / Outsource Repeat is retrieved by its sender, whose sample is never Sent: not blocked', async () => {
    const { retrieve, writtenStatus } = build({
      kind: TransferKind.EXTERNAL,
      senderSample: SampleStatus.FORWARD_EXTERNAL,
    });
    await retrieve();
    expect(writtenStatus()).toBe(TransferStatus.RECEIVED);
  });

  it('claims the transfer row BEFORE it reads the sender sample (so it cannot race the sender confirming the Repeat)', async () => {
    const { retrieve, tx } = build({
      senderSample: SampleStatus.SENT_INTERNAL,
    });
    await retrieve();
    const claim = tx.sampleTransfer.updateMany.mock.invocationCallOrder[0]!;
    const read = tx.orderSample.findFirst.mock.invocationCallOrder.at(-1)!;
    expect(claim).toBeLessThan(read);
  });

  describe('a Reject the sender has already acted on (it flagged the sample Error)', () => {
    it.each([SampleStatus.ERROR, SampleStatus.REPEAT])(
      'is refused while the sender sample is %s, with its own wording, and nothing is written',
      async (senderSample) => {
        const { retrieve, writtenStatus } = build({
          transferStatus: TransferStatus.REJECTED,
          senderSample,
        });
        const refusal = await retrieve().catch((e: unknown) => e);
        expect(refusal).toBeInstanceOf(
          TransferRetrieveAfterSenderConfirmedException,
        );
        expect(refusalMessage(refusal as KaltrosException)).toMatch(
          /flagged the rejected sample as Error/,
        );
        expect(writtenStatus()).toBeUndefined();
      },
    );

    it('a group action with skip-invalid names the transfer', async () => {
      const { retrieve } = build({
        transferStatus: TransferStatus.REJECTED,
        senderSample: SampleStatus.ERROR,
      });
      const r = await retrieve(true);
      expect(r.skipped).toEqual([
        expect.objectContaining({
          id: 'tr1',
          code: 'TRANSFER_RETRIEVE_AFTER_SENDER_CONFIRMED',
        }),
      ]);
    });

    it('before the sender acts (its sample is still Sent) Retrieve steps the transfer back to Received', async () => {
      const { retrieve, writtenStatus } = build({
        transferStatus: TransferStatus.REJECTED,
        senderSample: SampleStatus.SENT_INTERNAL,
      });
      await retrieve();
      expect(writtenStatus()).toBe(TransferStatus.RECEIVED);
    });
  });
});
