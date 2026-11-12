import { SampleStatus } from '@prisma/client';
import {
  BARCODE_REMOVED_ACTION,
  barcodeRemovedByRetrieveNote,
  barcodeRemovedFrom,
  barcodeRemovedNote,
  clearBarcodeForRepeatInTx,
} from './repeat-barcode.util';

/**
 * A repeated sample loses its old barcode (it belongs to the tube that was drawn); Collect makes the new one:
 *  - the old barcode and its image are cleared on the repeated rows ONLY;
 *  - every repeated row gets the same batch tag (Collect uses it to share one new barcode and to never lend the old one);
 *  - the change is written to each sample's history, with no status change;
 *  - no number is allocated here.
 */
interface Row {
  id: string;
  branchId: string | null;
  status: SampleStatus;
  barcode: string | null;
}

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  branchId: 'b1',
  status: SampleStatus.REPEAT,
  barcode: '10001',
  ...over,
});

function build(rows: Row[]) {
  const tx = {
    orderSample: {
      findMany: jest.fn().mockResolvedValue(rows),
      updateMany: jest.fn().mockResolvedValue({ count: rows.length }),
    },
    orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  const run = (ids: string[], batchId?: string) =>
    clearBarcodeForRepeatInTx(tx as never, {
      tenantId: 't1',
      personId: 'p1',
      sampleIds: ids,
      batchId,
    });
  return { tx, run };
}

describe('clearBarcodeForRepeatInTx', () => {
  it('clears the old barcode and its image on the repeated rows and stamps one batch tag, in one write', async () => {
    const m = build([row('s1'), row('s2')]);
    const r = await m.run(['s1', 's2'], 'batch-1');
    expect(r).toEqual({ batchId: 'batch-1', clearedIds: ['s1', 's2'] });
    expect(m.tx.orderSample.updateMany).toHaveBeenCalledTimes(1);
    expect(m.tx.orderSample.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1', 's2'] }, tenantId: 't1' },
      data: {
        barcode: null,
        orderIdBarcode: null,
        repeatBatchId: 'batch-1',
        updatedBy: 'p1',
      },
    });
  });

  it('touches only the ids it was given (rows that were not repeated keep their barcode)', async () => {
    const m = build([row('s1')]);
    await m.run(['s1', 's1']);
    expect(m.tx.orderSample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['s1'] }, tenantId: 't1', deletedAt: null },
      }),
    );
  });

  it('writes a "barcode removed" line with the removed barcode to the audit trail, with no status change', async () => {
    const m = build([row('s1')]);
    await m.run(['s1']);
    expect(m.tx.orderSampleStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sampleId: 's1',
        action: BARCODE_REMOVED_ACTION,
        fromStatus: SampleStatus.REPEAT,
        toStatus: SampleStatus.REPEAT,
        notes:
          'Barcode removed: 10001 (Repeat). A new barcode is made when the sample is collected again.',
        changedBy: 'p1',
      }) as Record<string, unknown>,
    });
  });

  it('every Repeat adds its own line: repeating twice leaves both removed barcodes in the trail', async () => {
    const first = build([row('s1', { barcode: '10001' })]);
    await first.run(['s1']);
    const second = build([row('s1', { barcode: '10002' })]);
    await second.run(['s1']);
    const notes = [first, second].map(
      (m) =>
        (
          m.tx.orderSampleStatusHistory.create.mock.calls[0] as [
            { data: { notes: string } },
          ]
        )[0].data.notes,
    );
    expect(notes.map(barcodeRemovedFrom)).toEqual(['10001', '10002']);
  });

  it('a sample that had no barcode has nothing to record', async () => {
    const m = build([row('s1', { barcode: null })]);
    await m.run(['s1']);
    expect(m.tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
  });

  it('no ids: nothing is read or written', async () => {
    const m = build([]);
    const r = await m.run([]);
    expect(m.tx.orderSample.findMany).not.toHaveBeenCalled();
    expect(m.tx.orderSample.updateMany).not.toHaveBeenCalled();
    expect(r.clearedIds).toEqual([]);
  });

  it('a new tag is made when none is given', async () => {
    const m = build([row('s1')]);
    const r = await m.run(['s1']);
    expect(r.batchId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('barcodeRemovedFrom reads back every barcode the branch settings can make', () => {
  it.each(['10001', 'LAB-10001', 'LAB/10001', 'LAB_10001', 'LAB/10001/A', '10001-A_2'])('%s', (barcode) => {
    expect(barcodeRemovedFrom(barcodeRemovedNote(barcode))).toBe(barcode);
  });

  it('a line that is not a Repeat\'s (written when a Retrieve takes the fresh barcode off) is not read as one', () => {
    expect(barcodeRemovedFrom(barcodeRemovedByRetrieveNote('LAB/10001'))).toBeNull();
  });

  it('no note, an empty note or an unrelated note: null', () => {
    expect(barcodeRemovedFrom(null)).toBeNull();
    expect(barcodeRemovedFrom(undefined)).toBeNull();
    expect(barcodeRemovedFrom('')).toBeNull();
    expect(barcodeRemovedFrom('Re-run with fresh sample')).toBeNull();
  });
});
