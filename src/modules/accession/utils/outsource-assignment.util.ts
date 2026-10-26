/**
 * "Not assigned yet" rule for OUTSOURCE transfers.
 *
 * An outsource can be created without a center and without a logistics type (both are optional
 * when the sample is outsourced and filled in later through Assign Center). Until they are set the
 * transfer must not move: nothing has been told where the tube goes or how it travels, so it can not
 * be Picked Up, Received or Accepted. This mirrors what an INTERNAL transfer already needs (a
 * destination branch for every step, a logistics type before pick-up).
 *
 *  - the center is needed for Pick Up, Receive and Accept (the transfer is addressed to it);
 *  - the logistics type is needed to Pick Up (the first step; Receive and Accept can only follow a
 *    pick-up, so a transfer already picked up before this rule keeps moving once it has a center).
 *
 * EXTERNAL (forward) transfers are not covered.
 */
import { TransferKind } from '@prisma/client';

/** The slice of a transfer the rule reads. */
export interface OutsourceAssignmentSlice {
  kind: TransferKind;
  outsourceCenterId: string | null;
  logisticsType: string | null;
}

/** The forward steps the rule guards. */
export type OutsourceForwardAction = 'pick-up' | 'receive' | 'accept';

/**
 * What an OUTSOURCE transfer still lacks before `action` may run, in words for a message
 * ("center", "logistics type"). Empty = the action may run (also for any non-outsource transfer
 * and for Repeat / Reject, which are not guarded).
 */
export function missingOutsourceAssignment(
  t: OutsourceAssignmentSlice,
  action: string,
): string[] {
  if (t.kind !== TransferKind.OUTSOURCE) return [];
  if (action !== 'pick-up' && action !== 'receive' && action !== 'accept') {
    return [];
  }
  const missing: string[] = [];
  if (!t.outsourceCenterId) missing.push('center');
  if (action === 'pick-up' && (t.logisticsType ?? '').trim() === '') {
    missing.push('logistics type');
  }
  return missing;
}
