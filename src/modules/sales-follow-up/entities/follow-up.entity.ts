import { FollowUp, FollowUpStatusHistory } from '@prisma/client';

/** A follow-up enriched with resolved display fields (list row). */
export type FollowUpListRow = FollowUp & {
  salespersonName: string | null;
  leadCode: string | null;
};

/**
 * A follow-up detail view: the follow-up + its ordered status history +
 * resolved display fields.
 */
export type FollowUpDetail = FollowUpListRow & {
  statusHistory: FollowUpStatusHistory[];
};
