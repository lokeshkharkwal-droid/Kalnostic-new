import { AccessionGroupingMode } from '@prisma/client';
import { barcodeGroupKey } from './barcode-group-key';

/**
 * A row that was sent back for a fresh collection carries a batch tag (`repeatBatchId`), but the tag does NOT change the
 * group: the repeated rows stay in the same group as their mates and share its actions. The tag only matters to Collect (who
 * shares the new barcode), which is covered in the accession-sample service spec.
 */
const row = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  departmentId: 'd1',
  sampleGroupLabel: 'Serum',
  ...over,
});

describe('barcodeGroupKey ignores the repeat tag', () => {
  it.each(Object.values(AccessionGroupingMode))(
    '%s: a repeated row keeps the key of its group mates',
    (mode) => {
      const plain = barcodeGroupKey(row(), mode);
      expect(barcodeGroupKey(row({ repeatBatchId: 'b1' }), mode)).toBe(plain);
      expect(barcodeGroupKey(row({ repeatBatchId: 'b2' }), mode)).toBe(plain);
      expect(plain).not.toContain('::R');
    },
  );

  it('the key still follows the mode: two rows of different sample names are different groups', () => {
    const mode = AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME;
    expect(barcodeGroupKey(row({ sampleGroupLabel: 'Serum' }), mode)).not.toBe(
      barcodeGroupKey(row({ sampleGroupLabel: 'Plasma' }), mode),
    );
  });
});
