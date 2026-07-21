import { SampleStatus } from '@prisma/client';

/**
 * The accession sample state machine, built verbatim from PDF §A.9 ("Sample
 * Lifecycle — Status Transitions"). Each action maps the CURRENT status to the
 * status it moves the sample into. `SampleService.transition` (Phase 1) validates
 * that an action is legal from the sample's current status using this matrix
 * before mutating anything.
 *
 * `retrieve` is the universal undo (PDF §A.7/§A.10.19): available at ALL statuses,
 * it reverts the sample to its `previousStatus`. The explicit transfer-return
 * targets below (Sent/Forward/Outsourced/Returned → Accepted) are the documented
 * §A.9 rows; the general "revert to previous" behaviour is handled in the service,
 * not encoded here.
 */
export type SampleAction =
  | 'collect'
  | 'accept'
  | 'acquire'
  | 'halt'
  | 'error'
  | 'hold'
  | 'repeat'
  | 'store'
  | 'discard'
  | 'return'
  | 'cancel'
  | 'send'
  | 'forward'
  | 'outsource'
  | 'retrieve';

/** `{ action: { fromStatus: toStatus } }` — the legal transitions (PDF §A.9). */
export const SAMPLE_TRANSITIONS: Readonly<
  Record<SampleAction, Partial<Record<SampleStatus, SampleStatus>>>
> = {
  // Collect / Collect & Print — proceed with (re-)collection.
  collect: {
    [SampleStatus.NEW]: SampleStatus.COLLECTED,
    [SampleStatus.HOLD]: SampleStatus.COLLECTED,
    [SampleStatus.REPEAT]: SampleStatus.COLLECTED,
  },
  // Accept — receive & accept at the processing lab (also resumes a HALT).
  accept: {
    [SampleStatus.COLLECTED]: SampleStatus.ACCEPTED,
    [SampleStatus.HALT]: SampleStatus.ACCEPTED,
  },
  // Acquire — physically acquired by the lab technician.
  acquire: {
    [SampleStatus.ACCEPTED]: SampleStatus.ACQUIRED,
  },
  // Hault — pause processing (quality/volume issue).
  halt: {
    [SampleStatus.COLLECTED]: SampleStatus.HALT,
    [SampleStatus.ACQUIRED]: SampleStatus.HALT,
  },
  // Error — flag the sample erroneous.
  error: {
    [SampleStatus.HALT]: SampleStatus.ERROR,
  },
  // Hold — defer collection / processing.
  hold: {
    [SampleStatus.NEW]: SampleStatus.HOLD,
    [SampleStatus.REPEAT]: SampleStatus.HOLD,
  },
  // Repeat — flag for re-collection (QC/quality failure).
  repeat: {
    [SampleStatus.ACQUIRED]: SampleStatus.REPEAT,
    [SampleStatus.HALT]: SampleStatus.REPEAT,
    [SampleStatus.ERROR]: SampleStatus.REPEAT,
  },
  // Store — store in freezer/rack.
  store: {
    [SampleStatus.ACCEPTED]: SampleStatus.STORED,
  },
  // Discard — discard using a defined method.
  discard: {
    [SampleStatus.STORED]: SampleStatus.DISCARDED,
  },
  // Return — return to field/patient/collector.
  return: {
    [SampleStatus.ACCEPTED]: SampleStatus.RETURNED,
    [SampleStatus.ERROR]: SampleStatus.RETURNED,
    [SampleStatus.STORED]: SampleStatus.RETURNED,
  },
  // Cancel — cancel the order/sample.
  cancel: {
    [SampleStatus.NEW]: SampleStatus.CANCELLED,
    [SampleStatus.COLLECTED]: SampleStatus.CANCELLED,
    [SampleStatus.HOLD]: SampleStatus.CANCELLED,
  },
  // Send — Internal Transfer (branch↔branch).
  send: {
    [SampleStatus.ACCEPTED]: SampleStatus.SENT_INTERNAL,
  },
  // Forward — External Transfer (partner lab).
  forward: {
    [SampleStatus.ACCEPTED]: SampleStatus.FORWARD_EXTERNAL,
  },
  // Outsource — third-party external lab.
  outsource: {
    [SampleStatus.ACCEPTED]: SampleStatus.OUTSOURCED,
  },
  // Retrieve — pull a transferred sample back into active processing (§A.9). The
  // universal "revert to previous status" is applied in the service.
  retrieve: {
    [SampleStatus.SENT_INTERNAL]: SampleStatus.ACCEPTED,
    [SampleStatus.FORWARD_EXTERNAL]: SampleStatus.ACCEPTED,
    [SampleStatus.OUTSOURCED]: SampleStatus.ACCEPTED,
    [SampleStatus.RETURNED]: SampleStatus.ACCEPTED,
  },
};

/**
 * Resolve the target status for an action from a given current status, or `null`
 * when the action is not legal from that status (per §A.9).
 * @param action the action being applied
 * @param from the sample's current status
 * @returns the resulting status, or `null` if the transition is illegal
 */
export function nextSampleStatus(
  action: SampleAction,
  from: SampleStatus,
): SampleStatus | null {
  return SAMPLE_TRANSITIONS[action][from] ?? null;
}
