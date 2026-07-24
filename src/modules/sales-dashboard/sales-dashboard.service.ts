import { Injectable } from '@nestjs/common';
import { LeadStatus, PipelineStage, TripStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesStaffService } from '../sales-trip/sales-staff.service';
import {
  SalesDashboardOverview,
  SalesFunnelBucket,
  SalesTopPerformer,
} from './entities/sales-dashboard.entity';

/** Lead statuses that close a lead out of the "open" set. */
const CLOSED_STATUSES: LeadStatus[] = [
  LeadStatus.CONVERTED,
  LeadStatus.LOST,
  LeadStatus.CANCELLED,
  LeadStatus.ACTIVE_CLIENT,
];

/**
 * Sales dashboard overview. Tenant-scoped + branch-level (CLAUDE.md §4.7): every
 * query filters `{ tenantId, branchId, deletedAt: null }`. Money `Decimal`s are
 * converted to `number` before arithmetic; salesperson names resolve via the
 * shared `SalesStaffService`.
 */
@Injectable()
export class SalesDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staff: SalesStaffService,
  ) {}

  /**
   * Build the full sales dashboard overview for the active branch: KPI counters,
   * open pipeline / converted value, today's workload, the pipeline-stage funnel,
   * and the top performers (by converted count).
   * @param tenantId tenant scope
   * @param branchId active branch scope
   * @returns a single composed overview object
   */
  async overview(
    tenantId: string,
    branchId: string,
  ): Promise<SalesDashboardOverview> {
    const scope = { tenantId, branchId, deletedAt: null } as const;

    const [leads, tripsInProgress, followUpsToday] = await Promise.all([
      this.prisma.lead.findMany({
        where: scope,
        select: {
          assignedSalespersonId: true,
          status: true,
          meetingDate: true,
          pipelineStage: true,
          estimatedDealValue: true,
          convertedValue: true,
        },
      }),
      this.prisma.trip.count({
        where: { ...scope, status: TripStatus.IN_PROGRESS },
      }),
      this.prisma.followUp.count({
        where: {
          ...scope,
          status: { in: ['SCHEDULED', 'PENDING'] },
        },
      }),
    ]);

    const totalLeads = leads.length;
    let openLeads = 0;
    let convertedLeads = 0;
    let lostLeads = 0;
    let meetingsScheduled = 0;
    let pipelineValue = 0;
    let convertedValue = 0;

    /** Funnel buckets, one per pipeline stage (stable order). */
    const funnelMap = new Map<PipelineStage, SalesFunnelBucket>();
    for (const stage of Object.values(PipelineStage)) {
      funnelMap.set(stage, { stage, count: 0, value: 0 });
    }

    /** Per-salesperson performer accumulator. */
    const perfMap = new Map<
      string,
      { leads: number; pipeline: number; converted: number }
    >();
    const ensurePerf = (id: string) => {
      let p = perfMap.get(id);
      if (!p) {
        p = { leads: 0, pipeline: 0, converted: 0 };
        perfMap.set(id, p);
      }
      return p;
    };

    for (const lead of leads) {
      const estimated = Number(lead.estimatedDealValue);
      const isOpen = !CLOSED_STATUSES.includes(lead.status);
      const isConverted =
        lead.status === LeadStatus.CONVERTED ||
        lead.status === LeadStatus.ACTIVE_CLIENT;

      if (isOpen) {
        openLeads += 1;
        pipelineValue += estimated;
      }
      if (isConverted) {
        convertedLeads += 1;
        const converted = Number(lead.convertedValue);
        convertedValue += converted > 0 ? converted : estimated;
      }
      if (lead.status === LeadStatus.LOST) lostLeads += 1;
      if (lead.status === LeadStatus.SCHEDULED && lead.meetingDate !== null) {
        meetingsScheduled += 1;
      }

      const bucket = funnelMap.get(lead.pipelineStage);
      if (bucket) {
        bucket.count += 1;
        bucket.value += estimated;
      }

      if (lead.assignedSalespersonId) {
        const p = ensurePerf(lead.assignedSalespersonId);
        p.leads += 1;
        if (isOpen) p.pipeline += estimated;
        if (isConverted) p.converted += 1;
      }
    }

    const nameMap = await this.staff.resolveNames([...perfMap.keys()]);
    const topPerformers: SalesTopPerformer[] = [...perfMap.entries()]
      .map(([salespersonId, p]) => ({
        salespersonId,
        salespersonName: nameMap.get(salespersonId) ?? null,
        leads: p.leads,
        pipeline: p.pipeline,
        converted: p.converted,
      }))
      .sort((a, b) => b.converted - a.converted);

    return {
      kpis: {
        totalLeads,
        openLeads,
        convertedLeads,
        lostLeads,
        conversionRate:
          totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0,
        tripsInProgress,
      },
      pipelineValue,
      convertedValue,
      workload: {
        followUpsToday,
        meetingsScheduled,
        tripsInProgress,
      },
      funnel: [...funnelMap.values()],
      topPerformers,
    };
  }
}
