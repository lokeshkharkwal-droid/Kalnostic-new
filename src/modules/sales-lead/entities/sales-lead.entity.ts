import { Lead, LeadMeeting, LeadStatusHistory } from '@prisma/client';

/** A lead list row: the lead + resolved display names + derived counts. */
export type LeadListRow = Lead & {
  salespersonName: string | null;
  territoryName: string | null;
  nextAction: { label: string; to: string } | null;
};

/** A lead detail view: the lead + history + meetings + resolved names. */
export type LeadDetail = Lead & {
  salespersonName: string | null;
  leadOwnerName: string | null;
  territoryName: string | null;
  nextAction: { label: string; to: string } | null;
  statusHistory: LeadStatusHistory[];
  meetings: LeadMeeting[];
  meetingCount: number;
  followUpCount: number;
  tripCount: number;
};
