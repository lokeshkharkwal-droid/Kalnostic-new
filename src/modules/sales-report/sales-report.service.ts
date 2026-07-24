import { Injectable } from '@nestjs/common';
import { LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesStaffService } from '../sales-trip/sales-staff.service';
import { SalesReportQueryDto } from './dto/sales-report-query.dto';
import {
  LeadWiseRow,
  SalespersonWiseRow,
} from './entities/sales-report.entity';

/** Lead statuses treated as a successful conversion. */
const CONVERTED_STATUSES: LeadStatus[] = [
  LeadStatus.CONVERTED,
  LeadStatus.ACTIVE_CLIENT,
  LeadStatus.CLIENT_ONBOARDING,
];

/** Lead statuses treated as "the meeting has already happened". */
const PAST_MEETING_STATUSES: LeadStatus[] = [
  LeadStatus.MEETING_COMPLETED,
  LeadStatus.PROPOSAL_SHARED,
  LeadStatus.QUOTATION_SHARED,
  LeadStatus.NEGOTIATION,
  LeadStatus.CONVERTED,
  LeadStatus.ACTIVE_CLIENT,
];

/** Lead statuses that exclude a lead from the open pipeline value. */
const CLOSED_PIPELINE_STATUSES: LeadStatus[] = [
  LeadStatus.CONVERTED,
  LeadStatus.LOST,
  LeadStatus.CANCELLED,
  LeadStatus.ACTIVE_CLIENT,
];

/**
 * Read-only sales reporting. Both reports are tenant-scoped + branch-level
 * (CLAUDE.md §4.7): every query filters `{ tenantId, branchId, deletedAt: null }`.
 * Money `Decimal`s are converted to `number` before any arithmetic. Salesperson
 * names are resolved via the shared `SalesStaffService` (no duplicate person
 * lookups). No pagination — the frontend renders the full result set.
 */
@Injectable()
export class SalesReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staff: SalesStaffService,
  ) {}

  /**
   * Lead-wise report: one flat row per lead in the active branch, enriched with
   * meeting/follow-up counts, a coarse conversion status and the salesperson
   * name. Optional filters narrow on lead date range, salesperson, territory,
   * source, category and a free-text search.
   * @param tenantId tenant scope
   * @param branchId active branch scope
   * @param filters optional report filters
   * @returns an array of lead rows (no pagination)
   */
  async leadWise(
    tenantId: string,
    branchId: string,
    filters: SalesReportQueryDto,
  ): Promise<LeadWiseRow[]> {
    const where = this.buildLeadWhere(tenantId, branchId, filters);
    const leads = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            meetings: { where: { deletedAt: null } },
            followUps: { where: { deletedAt: null } },
          },
        },
      },
    });

    const nameMap = await this.staff.resolveNames(
      leads.map((l) => l.assignedSalespersonId ?? ''),
    );

    return leads.map((lead) => ({
      leadId: lead.id,
      leadCode: lead.leadCode,
      leadAt: lead.leadAt,
      organizationName: lead.organizationName,
      organizationType: lead.organizationType,
      primaryContactName: lead.primaryContactName,
      mobile: lead.mobile,
      category: lead.category,
      source: lead.source,
      priority: lead.priority,
      status: lead.status,
      pipelineStage: lead.pipelineStage,
      estimatedDealValue: Number(lead.estimatedDealValue),
      convertedValue: Number(lead.convertedValue),
      expectedMonthlyVolume: lead.expectedMonthlyVolume,
      expectedMonthlyRevenue: Number(lead.expectedMonthlyRevenue),
      assignedSalespersonId: lead.assignedSalespersonId,
      salespersonName: lead.assignedSalespersonId
        ? (nameMap.get(lead.assignedSalespersonId) ?? null)
        : null,
      territoryId: lead.territoryId,
      meetingDate: lead.meetingDate,
      nextFollowUpDate: lead.nextFollowUpDate,
      meetingCount: lead._count.meetings,
      followUpCount: lead._count.followUps,
      conversionStatus: this.conversionStatus(lead.status),
      lastUpdated: lead.updatedAt,
    }));
  }

  /**
   * Salesperson-wise report: one aggregated row per salesperson who owns at least
   * one lead or trip in the active branch. Aggregates leads, meetings, completed
   * follow-ups, conversions, pipeline value, converted revenue and total km.
   * @param tenantId tenant scope
   * @param branchId active branch scope
   * @param filters optional report filters (applied to the underlying leads)
   * @returns an array of per-salesperson aggregate rows
   */
  async salespersonWise(
    tenantId: string,
    branchId: string,
    filters: SalesReportQueryDto,
  ): Promise<SalespersonWiseRow[]> {
    const leadWhere = this.buildLeadWhere(tenantId, branchId, filters);
    const scope = { tenantId, branchId, deletedAt: null } as const;

    const [leads, trips, followUps] = await Promise.all([
      this.prisma.lead.findMany({
        where: leadWhere,
        select: {
          assignedSalespersonId: true,
          status: true,
          meetingDate: true,
          estimatedDealValue: true,
          convertedValue: true,
        },
      }),
      this.prisma.trip.findMany({
        where: scope,
        select: { salespersonId: true, kmTravelled: true },
      }),
      this.prisma.followUp.findMany({
        where: scope,
        select: { assignedSalespersonId: true, status: true },
      }),
    ]);

    /** Accumulator keyed by salesperson id. */
    interface Acc {
      assignedLeads: number;
      meetingsScheduled: number;
      meetingsCompleted: number;
      followUpsCompleted: number;
      convertedLeads: number;
      lostLeads: number;
      noResponse: number;
      pipelineValue: number;
      convertedRevenue: number;
      totalKm: number;
    }
    const map = new Map<string, Acc>();
    const ensure = (id: string): Acc => {
      let acc = map.get(id);
      if (!acc) {
        acc = {
          assignedLeads: 0,
          meetingsScheduled: 0,
          meetingsCompleted: 0,
          followUpsCompleted: 0,
          convertedLeads: 0,
          lostLeads: 0,
          noResponse: 0,
          pipelineValue: 0,
          convertedRevenue: 0,
          totalKm: 0,
        };
        map.set(id, acc);
      }
      return acc;
    };

    for (const lead of leads) {
      if (!lead.assignedSalespersonId) continue;
      const acc = ensure(lead.assignedSalespersonId);
      acc.assignedLeads += 1;
      if (lead.meetingDate) acc.meetingsScheduled += 1;
      if (PAST_MEETING_STATUSES.includes(lead.status))
        acc.meetingsCompleted += 1;
      const isConverted =
        lead.status === LeadStatus.CONVERTED ||
        lead.status === LeadStatus.ACTIVE_CLIENT;
      if (isConverted) {
        acc.convertedLeads += 1;
        const converted = Number(lead.convertedValue);
        acc.convertedRevenue +=
          converted > 0 ? converted : Number(lead.estimatedDealValue);
      }
      if (lead.status === LeadStatus.LOST) acc.lostLeads += 1;
      if (lead.status === LeadStatus.NO_RESPONSE) acc.noResponse += 1;
      if (!CLOSED_PIPELINE_STATUSES.includes(lead.status)) {
        acc.pipelineValue += Number(lead.estimatedDealValue);
      }
    }

    for (const followUp of followUps) {
      if (!followUp.assignedSalespersonId) continue;
      if (followUp.status === 'COMPLETED' || followUp.status === 'CONVERTED') {
        ensure(followUp.assignedSalespersonId).followUpsCompleted += 1;
      }
    }

    for (const trip of trips) {
      if (!trip.salespersonId) continue;
      ensure(trip.salespersonId).totalKm += trip.kmTravelled;
    }

    const nameMap = await this.staff.resolveNames([...map.keys()]);
    return [...map.entries()].map(([salespersonId, acc]) => ({
      salespersonId,
      salespersonName: nameMap.get(salespersonId) ?? null,
      assignedLeads: acc.assignedLeads,
      meetingsScheduled: acc.meetingsScheduled,
      meetingsCompleted: acc.meetingsCompleted,
      followUpsCompleted: acc.followUpsCompleted,
      convertedLeads: acc.convertedLeads,
      lostLeads: acc.lostLeads,
      noResponse: acc.noResponse,
      conversionPercent:
        acc.assignedLeads > 0
          ? Math.round((acc.convertedLeads / acc.assignedLeads) * 100)
          : 0,
      pipelineValue: acc.pipelineValue,
      convertedRevenue: acc.convertedRevenue,
      totalKm: acc.totalKm,
    }));
  }

  /** Build the shared, scoped lead `where` clause from the report filters. */
  private buildLeadWhere(
    tenantId: string,
    branchId: string,
    filters: SalesReportQueryDto,
  ): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };
    if (filters.salespersonId)
      where.assignedSalespersonId = filters.salespersonId;
    if (filters.territoryId) where.territoryId = filters.territoryId;
    if (filters.source) where.source = filters.source;
    if (filters.category) where.category = filters.category;
    if (filters.dateFrom || filters.dateTo) {
      where.leadAt = {};
      if (filters.dateFrom) where.leadAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo)
        where.leadAt.lte = new Date(`${filters.dateTo}T23:59:59`);
    }
    const term = filters.search?.trim();
    if (term) {
      where.OR = [
        { leadCode: { contains: term, mode: 'insensitive' } },
        { organizationName: { contains: term, mode: 'insensitive' } },
        { primaryContactName: { contains: term, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  /** Map a lead status to its coarse conversion label for the report. */
  private conversionStatus(
    status: LeadStatus,
  ): 'Converted' | 'Lost' | 'In Progress' {
    if (CONVERTED_STATUSES.includes(status)) return 'Converted';
    if (status === LeadStatus.LOST) return 'Lost';
    return 'In Progress';
  }
}
