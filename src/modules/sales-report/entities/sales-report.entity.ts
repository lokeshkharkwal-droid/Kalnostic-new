import { LeadPriority, LeadStatus, PipelineStage } from '@prisma/client';

/**
 * One flat row of the Lead-wise report. Combines the lead's key display fields
 * with derived counts (meetings/follow-ups) and a coarse conversion status.
 */
export interface LeadWiseRow {
  leadId: string;
  leadCode: string;
  leadAt: Date | null;
  organizationName: string;
  organizationType: string;
  primaryContactName: string;
  mobile: string;
  category: string;
  source: string;
  priority: LeadPriority;
  status: LeadStatus;
  pipelineStage: PipelineStage;
  estimatedDealValue: number;
  convertedValue: number;
  expectedMonthlyVolume: number;
  expectedMonthlyRevenue: number;
  assignedSalespersonId: string | null;
  salespersonName: string | null;
  territoryId: string | null;
  meetingDate: Date | null;
  nextFollowUpDate: Date | null;
  meetingCount: number;
  followUpCount: number;
  conversionStatus: 'Converted' | 'Lost' | 'In Progress';
  lastUpdated: Date;
}

/**
 * One aggregated row of the Salesperson-wise report: per-salesperson lead,
 * meeting, follow-up, conversion and trip totals.
 */
export interface SalespersonWiseRow {
  salespersonId: string;
  salespersonName: string | null;
  assignedLeads: number;
  meetingsScheduled: number;
  meetingsCompleted: number;
  followUpsCompleted: number;
  convertedLeads: number;
  lostLeads: number;
  noResponse: number;
  conversionPercent: number;
  pipelineValue: number;
  convertedRevenue: number;
  totalKm: number;
}
