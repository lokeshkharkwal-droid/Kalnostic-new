import { RadiologyStudyStatus } from '@prisma/client';

/**
 * The radiology study state machine (New Radiology Flow, Phase 3). Each action
 * maps the CURRENT status to the status it moves the study into. Mirrors the
 * accession sample state-machine shape (`SAMPLE_TRANSITIONS`), but models the
 * imaging/report lifecycle instead of specimen handling:
 *
 *   NEW → SCHEDULED → ACQUIRED → REPORTED → VALIDATED → APPROVED → PUBLISHED
 *
 * `report` fills findings/impression and may re-fire while REPORTED (edit before
 * approval). `hold` pauses an in-progress study; `retrieve` is the universal undo
 * (revert to `previousStatus`, handled in the service). `cancel` is terminal.
 */
export type RadiologyAction =
  | 'schedule'
  | 'acquire'
  | 'report'
  | 'validate'
  | 'approve'
  | 'publish'
  | 'hold'
  | 'cancel'
  | 'retrieve';

/** `{ action: { fromStatus: toStatus } }` — the legal transitions. */
export const RADIOLOGY_TRANSITIONS: Readonly<
  Record<
    RadiologyAction,
    Partial<Record<RadiologyStudyStatus, RadiologyStudyStatus>>
  >
> = {
  schedule: {
    [RadiologyStudyStatus.NEW]: RadiologyStudyStatus.SCHEDULED,
    [RadiologyStudyStatus.HOLD]: RadiologyStudyStatus.SCHEDULED,
  },
  acquire: {
    [RadiologyStudyStatus.NEW]: RadiologyStudyStatus.ACQUIRED,
    [RadiologyStudyStatus.SCHEDULED]: RadiologyStudyStatus.ACQUIRED,
    [RadiologyStudyStatus.HOLD]: RadiologyStudyStatus.ACQUIRED,
  },
  // Fill/edit the narrative report. Allowed from ACQUIRED and while REPORTED
  // (so findings can be revised before validation/approval).
  report: {
    [RadiologyStudyStatus.ACQUIRED]: RadiologyStudyStatus.REPORTED,
    [RadiologyStudyStatus.REPORTED]: RadiologyStudyStatus.REPORTED,
  },
  validate: {
    [RadiologyStudyStatus.REPORTED]: RadiologyStudyStatus.VALIDATED,
  },
  // Approve — from VALIDATED, or directly from REPORTED when validation is skipped.
  approve: {
    [RadiologyStudyStatus.REPORTED]: RadiologyStudyStatus.APPROVED,
    [RadiologyStudyStatus.VALIDATED]: RadiologyStudyStatus.APPROVED,
  },
  publish: {
    [RadiologyStudyStatus.APPROVED]: RadiologyStudyStatus.PUBLISHED,
  },
  hold: {
    [RadiologyStudyStatus.NEW]: RadiologyStudyStatus.HOLD,
    [RadiologyStudyStatus.SCHEDULED]: RadiologyStudyStatus.HOLD,
    [RadiologyStudyStatus.ACQUIRED]: RadiologyStudyStatus.HOLD,
  },
  cancel: {
    [RadiologyStudyStatus.NEW]: RadiologyStudyStatus.CANCELLED,
    [RadiologyStudyStatus.SCHEDULED]: RadiologyStudyStatus.CANCELLED,
    [RadiologyStudyStatus.ACQUIRED]: RadiologyStudyStatus.CANCELLED,
    [RadiologyStudyStatus.HOLD]: RadiologyStudyStatus.CANCELLED,
  },
  // Retrieve — universal undo; the "revert to previousStatus" is applied in the
  // service (this map is unused for retrieve, kept for shape symmetry).
  retrieve: {},
};

/**
 * Resolve the target status for an action from a given current status, or `null`
 * when the action is not legal from that status.
 */
export function nextRadiologyStatus(
  action: RadiologyAction,
  from: RadiologyStudyStatus,
): RadiologyStudyStatus | null {
  return RADIOLOGY_TRANSITIONS[action][from] ?? null;
}

/** The actions that fill lifecycle timestamps, mapped to the `RadiologyStudy` column. */
export const ACTION_STAMP: Partial<
  Record<RadiologyAction, keyof RadiologyStampFields>
> = {
  schedule: 'scheduledAt',
  acquire: 'acquiredAt',
  report: 'reportedAt',
  validate: 'validatedAt',
  approve: 'approvedAt',
  publish: 'publishedAt',
};

/** The lifecycle-stamp columns an action may set. */
export interface RadiologyStampFields {
  scheduledAt: Date;
  acquiredAt: Date;
  reportedAt: Date;
  validatedAt: Date;
  approvedAt: Date;
  publishedAt: Date;
}
