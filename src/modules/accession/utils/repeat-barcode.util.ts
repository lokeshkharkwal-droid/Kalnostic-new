import { randomUUID } from 'crypto';
import { Prisma, SampleStatus } from '@prisma/client';

/**
 * The audit-trail actions for a sample's barcode being taken off by a Repeat, put back by a Retrieve, or not put back.
 * They change no status, so the sample history lists them explicitly (see `findHistory`): the trail keeps every barcode
 * a sample ever had, however many times it was repeated.
 */
export const BARCODE_REMOVED_ACTION = 'barcode-removed';
export const BARCODE_RESTORED_ACTION = 'barcode-restored';
export const BARCODE_RESTORE_SKIPPED_ACTION = 'barcode-restore-skipped';
/** The audit-trail actions that are shown even though the status does not change. */
export const BARCODE_AUDIT_ACTIONS: readonly string[] = [
  BARCODE_REMOVED_ACTION,
  BARCODE_RESTORED_ACTION,
  BARCODE_RESTORE_SKIPPED_ACTION,
];

/** The note a Repeat writes for the barcode it took off; {@link barcodeRemovedFrom} reads the value back. */
export function barcodeRemovedNote(barcode: string): string {
  return `Barcode removed: ${barcode} (Repeat). A new barcode is made when the sample is collected again.`;
}

/**
 * The note written when a Retrieve takes a tube back INTO Repeat and the barcode of the fresh tube comes off. The wording is
 * different on purpose: {@link barcodeRemovedFrom} reads only a Repeat's own note, so this line (it names the fresh tube, not
 * the tube the Repeat took the barcode off) is never put back by an undo.
 */
export function barcodeRemovedByRetrieveNote(barcode: string): string {
  return `Barcode removed: ${barcode} (Retrieve back into Repeat). A new barcode is made when the sample is collected again.`;
}

/**
 * The barcode named in a Repeat's "barcode removed" note, or null when the note does not carry one. The barcode is any run of
 * non-space characters: a branch may set a slash or an underscore as the barcode separator (`LAB/10001`, `LAB_10001`), so a
 * hyphens-only pattern would read those as "no barcode" and the undo would put nothing back. A barcode never contains a space.
 * A line written by a Retrieve ("(Retrieve back into Repeat)") is deliberately not matched.
 */
export function barcodeRemovedFrom(notes: string | null | undefined): string | null {
  return /^Barcode removed: (\S+) \(Repeat\)/.exec(notes ?? '')?.[1] ?? null;
}

export interface RepeatBarcodeResult {
  /** The tag given to every row of this repeat (also stored on the Re-run request). */
  batchId: string;
  /** The ids of the samples whose old barcode was cleared. */
  clearedIds: string[];
}

/**
 * Take the old barcode off the samples that were just sent back for a fresh collection (Repeat / Re-run with a fresh
 * sample) and tag them as one repeat batch.
 *
 * The old barcode belongs to the tube that was drawn; the repeat needs a new tube, so it needs a new barcode. The new
 * barcode is NOT made here: Collect makes it (`assignBarcodesOnCollectInTx`), exactly as for a first collection. What this
 * does:
 *  - clears `barcode` and its image on the repeated rows only (rows that were not repeated keep theirs);
 *  - stamps one `repeatBatchId` on the rows repeated in the same action. The tag does NOT change the group: the rows stay in
 *    the same group as their mates and share its actions. Collect uses the tag only to decide who shares the new barcode:
 *    rows of one batch share one, and they never borrow the old barcode that their group mates still carry;
 *  - writes a "barcode removed" line (the barcode that was taken off) to each sample's audit trail, one per Repeat.
 *
 * Runs inside the caller's (already tenant-scoped) transaction, after the samples were moved to REPEAT.
 * @param tx the caller's transaction
 * @param params tenant, acting person, the repeated sample ids, an optional batch tag to reuse
 */
export async function clearBarcodeForRepeatInTx(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    personId: string | null;
    sampleIds: string[];
    batchId?: string;
    /** `'retrieve'` when a Retrieve puts the tube back INTO Repeat (the note then says so); omitted for a Repeat. */
    via?: 'retrieve';
  },
): Promise<RepeatBarcodeResult> {
  const { tenantId, personId } = params;
  const batchId = params.batchId ?? randomUUID();
  const ids = [...new Set(params.sampleIds)];
  if (ids.length === 0) return { batchId, clearedIds: [] };

  const rows = await tx.orderSample.findMany({
    where: { id: { in: ids }, tenantId, deletedAt: null },
    select: { id: true, branchId: true, status: true, barcode: true },
    orderBy: { id: 'asc' },
  });
  if (rows.length === 0) return { batchId, clearedIds: [] };

  await tx.orderSample.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, tenantId },
    data: {
      barcode: null,
      orderIdBarcode: null,
      repeatBatchId: batchId,
      updatedBy: personId,
    },
  });
  for (const row of rows) {
    // A sample that had no barcode has nothing to record.
    if (!row.barcode) continue;
    await tx.orderSampleStatusHistory.create({
      data: {
        tenantId,
        branchId: row.branchId,
        sampleId: row.id,
        action: BARCODE_REMOVED_ACTION,
        fromStatus: row.status ?? SampleStatus.REPEAT,
        toStatus: row.status ?? SampleStatus.REPEAT,
        notes:
          params.via === 'retrieve'
            ? barcodeRemovedByRetrieveNote(row.barcode)
            : barcodeRemovedNote(row.barcode),
        changedBy: personId,
      },
    });
  }
  return { batchId, clearedIds: rows.map((r) => r.id) };
}
