import { PipelineStage } from '@prisma/client';

/** Headline KPI counters for the sales dashboard. */
export interface SalesDashboardKpis {
  totalLeads: number;
  openLeads: number;
  convertedLeads: number;
  lostLeads: number;
  conversionRate: number;
  tripsInProgress: number;
}

/** Today's workload counters. */
export interface SalesDashboardWorkload {
  followUpsToday: number;
  meetingsScheduled: number;
  tripsInProgress: number;
}

/** One pipeline-stage bucket (count + summed estimated deal value). */
export interface SalesFunnelBucket {
  stage: PipelineStage;
  count: number;
  value: number;
}

/** One top-performing salesperson entry. */
export interface SalesTopPerformer {
  salespersonId: string;
  salespersonName: string | null;
  leads: number;
  pipeline: number;
  converted: number;
}

/** The composed sales dashboard overview payload. */
export interface SalesDashboardOverview {
  kpis: SalesDashboardKpis;
  pipelineValue: number;
  convertedValue: number;
  workload: SalesDashboardWorkload;
  funnel: SalesFunnelBucket[];
  topPerformers: SalesTopPerformer[];
}
