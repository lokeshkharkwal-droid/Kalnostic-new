/**
 * Recall of a transferred sample (`recallTransfersForSampleInTx`) must unwind ONLY the
 * hand-off the sample is out on. An older transfer of another kind that is already
 * closed (e.g. an internal A→B rejection before the sample was Forwarded) is history
 * and must survive. A sample whose status maps to no kind (a passed-on clone being
 * unwound) keeps the old behaviour: every transfer of that clone is recalled.
 */
import { SampleStatus, TransferKind } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';

type FindManyArgs = { where: Record<string, unknown> };

function build(
  transfers: Array<{
    id: string;
    kind: TransferKind;
    clonedSampleId: string | null;
    rejectionReason: string | null;
  }>,
) {
  const findMany = jest
    .fn<Promise<unknown[]>, [FindManyArgs]>()
    .mockResolvedValue(transfers);
  const update = jest
    .fn<
      Promise<unknown>,
      [{ where: { id: string }; data: Record<string, unknown> }]
    >()
    .mockResolvedValue({});
  const tx = { sampleTransfer: { findMany, update } };
  const service = new OrderSampleService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const recall = (status: SampleStatus) =>
    (
      service as unknown as {
        recallTransfersForSampleInTx: (...a: unknown[]) => Promise<void>;
      }
    ).recallTransfersForSampleInTx(tx, 't1', 'p1', {
      id: 's1',
      branchId: 'A',
      originBranchId: 'A',
      status,
    });
  return { recall, findMany, update };
}

describe('recallTransfersForSampleInTx — only the hand-off the sample is out on', () => {
  it.each([
    [SampleStatus.FORWARD_EXTERNAL, TransferKind.EXTERNAL],
    [SampleStatus.OUTSOURCED, TransferKind.OUTSOURCE],
    [SampleStatus.SENT_INTERNAL, TransferKind.INTERNAL],
  ])('a %s sample recalls %s transfers only', async (status, kind) => {
    const m = build([
      { id: 'tr1', kind, clonedSampleId: null, rejectionReason: null },
    ]);
    await m.recall(status);
    expect(m.findMany).toHaveBeenCalledTimes(1);
    expect(m.findMany.mock.calls[0]![0].where).toEqual({
      sampleId: 's1',
      tenantId: 't1',
      deletedAt: null,
      kind,
    });
    // the matching hand-off is soft-deleted, with the recall reason
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.update.mock.calls[0]![0].where).toEqual({ id: 'tr1' });
    expect(m.update.mock.calls[0]![0].data).toMatchObject({
      rejectionReason: 'Recalled via Retrieve',
    });
    expect(m.update.mock.calls[0]![0].data.deletedAt).toBeInstanceOf(Date);
  });

  it('never asks for another kind: an older INTERNAL rejection is not in the query for a Forwarded sample', async () => {
    const m = build([]);
    await m.recall(SampleStatus.FORWARD_EXTERNAL);
    const where = m.findMany.mock.calls[0]![0].where;
    expect(where.kind).toBe(TransferKind.EXTERNAL);
    expect(where.kind).not.toBe(TransferKind.INTERNAL);
    expect(m.update).not.toHaveBeenCalled();
  });

  it.each([SampleStatus.ACCEPTED, SampleStatus.REPEAT, SampleStatus.COLLECTED])(
    'a %s sample (e.g. a passed-on clone being unwound) keeps the old behaviour: no kind filter',
    async (status) => {
      const m = build([]);
      await m.recall(status);
      expect(m.findMany.mock.calls[0]![0].where).toEqual({
        sampleId: 's1',
        tenantId: 't1',
        deletedAt: null,
      });
    },
  );
});
