import { AccessionGroupingMode } from '@prisma/client';

/**
 * The minimal shape needed to bucket a sample for grouping-aware barcode
 * assignment / display: its id plus the department + sample-name it belongs to.
 */
export interface BarcodeGroupable {
  id: string;
  departmentId: string | null;
  sampleGroupLabel: string | null;
}

/**
 * The barcode-grouping key for a sample under the tenant's grouping mode —
 * samples sharing a key share one barcode and one **final group** in the UI.
 * Mirrors the accession list's `actionScope`: Sample-wise = unique per row;
 * Order-wise = whole order; Department-wise = per department; Dept+Sample =
 * per department + sample name.
 *
 * This is the SINGLE source of truth for the rule, shared by the in-house
 * grouped list, collect-time barcode assignment, and the referral/transfer
 * queues — so all three bucket a sample identically (no drift). Callers prefix
 * the returned bucket key with the order id (`${orderId}::${key}`) to scope a
 * group to one order.
 */
export function barcodeGroupKey(
  sample: BarcodeGroupable,
  mode: AccessionGroupingMode,
): string {
  switch (mode) {
    case AccessionGroupingMode.ORDER:
      return 'ORDER';
    case AccessionGroupingMode.DEPARTMENT:
      return `DEPT::${sample.departmentId ?? 'none'}`;
    case AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME:
      return `DEPT_SAMPLE::${sample.departmentId ?? 'none'}::${
        sample.sampleGroupLabel ?? 'General'
      }`;
    case AccessionGroupingMode.SAMPLE_NAME:
    default:
      // Sample-wise = a unique barcode per individual sample row.
      return `SAMPLE::${sample.id}`;
  }
}
