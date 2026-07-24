import { Injectable } from '@nestjs/common';
import {
  AgreementStatus,
  FollowUpStatus,
  FollowUpType,
  Lead,
  LeadPriority,
  LeadStatus,
  MeetingOutcome,
  MeetingType,
  PipelineStage,
  Prisma,
  SalesDocumentStatus,
  TripStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { SalesStaffService } from '../sales-trip/sales-staff.service';
import { SalesTripService } from '../sales-trip/sales-trip.service';
import { SalesLeadStatusService } from '../sales-trip/sales-lead-status.service';
import { SalesTerritoryService } from '../sales-territory/sales-territory.service';
import { SalesFollowUpService } from '../sales-follow-up/sales-follow-up.service';
import { CreateFollowUpDto } from '../sales-follow-up/dto/create-follow-up.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { MeetingOutcomeDto } from './dto/meeting-outcome.dto';
import { UploadLeadDocumentDto } from './dto/upload-lead-document.dto';
import {
  LeadNotFoundException,
  DuplicateLeadException,
} from './exceptions/sales-lead.exceptions';
import { LeadDetail, LeadListRow } from './entities/sales-lead.entity';
import {
  BILLING_TYPES,
  INTEGRATION_OPTIONS,
  LEAD_CATEGORIES,
  LEAD_SOURCES,
  NEXT_ACTION,
  ORGANIZATION_TYPES,
  OUTCOME_TO_STATUS,
  PREFERRED_CONTACTS,
  REQUIRED_DOC_OPTIONS,
  STATUS_BUCKETS,
} from './entities/sales-lead.constants';

/** Shape of the tenant Sales-settings duplicate-detection config we read. */
interface DuplicateConfig {
  duplicateLeadCheck?: boolean;
  duplicateCheckOn?: string[];
}

/**
 * Business-lead service — the core of the Sales module. Tenant-scoped +
 * branch-level (CLAUDE.md §4.7): every query carries `{ tenantId, branchId,
 * deletedAt: null }`. Owns the lead lifecycle state machine, audit/history,
 * meeting outcomes, documents, and the "Start Trip" flow (creates a linked Trip
 * via the injected trip service). `leadCode` (`LD-YYYY-#####`) is a per-tenant
 * sequential code generated atomically.
 */
@Injectable()
export class SalesLeadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staff: SalesStaffService,
    private readonly tripService: SalesTripService,
    private readonly territoryService: SalesTerritoryService,
    private readonly followUpService: SalesFollowUpService,
    private readonly leadStatus: SalesLeadStatusService,
  ) {}

  /**
   * Create a lead. Validates salesperson/owner (staff) and territory, runs the
   * tenant's duplicate-detection check, generates the `leadCode` atomically, and
   * records an initial "Lead created" history entry.
   * @throws DuplicateLeadException / InvalidSalespersonException / InvalidSalesTerritoriesException
   */
  async create(
    tenantId: string,
    branchId: string,
    dto: CreateLeadDto,
    actorId?: string,
  ): Promise<LeadDetail> {
    await this.validateRefs(tenantId, branchId, dto);
    await this.assertNotDuplicate(tenantId, dto);

    const status = dto.status ?? LeadStatus.NEW_LEAD;
    const lead = await this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: { leadCounter: { increment: 1 } },
        select: { leadCounter: true },
      });
      const year = new Date().getFullYear();
      const leadCode = `LD-${year}-${String(tenant.leadCounter).padStart(5, '0')}`;
      const created = await tx.lead.create({
        data: {
          ...this.mapWriteData(dto),
          tenantId,
          branchId,
          leadCode,
          // Explicit create-required fields (definite types so the literal
          // satisfies LeadUncheckedCreateInput; the spread types them optional).
          category: dto.category,
          organizationName: dto.organizationName,
          organizationType: dto.organizationType,
          primaryContactName: dto.primaryContactName,
          mobile: dto.mobile,
          source: dto.source,
          leadAt: dto.leadAt ? new Date(dto.leadAt) : new Date(),
          status,
          createdBy: actorId ?? null,
          updatedBy: actorId ?? null,
        },
      });
      await tx.leadStatusHistory.create({
        data: {
          tenantId,
          leadId: created.id,
          action: 'Lead created',
          toStatus: status,
          byPersonId: actorId ?? null,
        },
      });
      return created;
    });
    return this.findById(lead.id, tenantId, branchId);
  }

  /**
   * List leads (paginated) with the full FE filter set: status-bucket tab, 13
   * dropdown filters, date range and global search. Rows are enriched with the
   * salesperson/territory names and the next "Immediate Action".
   */
  async findAll(
    tenantId: string,
    branchId: string,
    query: ListLeadsDto,
  ): Promise<PaginatedResult<LeadListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.LeadWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };

    if (query.status) {
      where.status = query.status;
    } else if (query.statusBucket && query.statusBucket !== 'all') {
      const bucket = STATUS_BUCKETS[query.statusBucket];
      if (bucket && bucket.length > 0) where.status = { in: bucket };
    }
    if (query.salespersonId) where.assignedSalespersonId = query.salespersonId;
    if (query.territoryId) where.territoryId = query.territoryId;
    if (query.source) where.source = query.source;
    if (query.category) where.category = query.category;
    if (query.organizationType) where.organizationType = query.organizationType;
    if (query.priority) where.priority = query.priority;
    if (query.pipelineStage) where.pipelineStage = query.pipelineStage;
    if (query.agreementStatus) where.agreementStatus = query.agreementStatus;
    if (query.proposalStatus) where.proposalStatus = query.proposalStatus;
    if (query.quotationStatus) where.quotationStatus = query.quotationStatus;
    if (query.billingType) where.billingType = query.billingType;
    if (query.dateFrom || query.dateTo) {
      where.leadAt = {};
      if (query.dateFrom) where.leadAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.leadAt.lte = new Date(`${query.dateTo}T23:59:59`);
    }
    const term = query.search?.trim();
    if (term) {
      where.OR = [
        { leadCode: { contains: term, mode: 'insensitive' } },
        { organizationName: { contains: term, mode: 'insensitive' } },
        { primaryContactName: { contains: term, mode: 'insensitive' } },
        { mobile: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { city: { contains: term, mode: 'insensitive' } },
        { gstNumber: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [leads, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { territory: { select: { name: true } } },
      }),
      this.prisma.lead.count({ where }),
    ]);
    const nameMap = await this.staff.resolveNames(
      leads.map((l) => l.assignedSalespersonId ?? ''),
    );
    const data: LeadListRow[] = leads.map((l) => {
      const { territory, ...lead } = l;
      return {
        ...lead,
        salespersonName: l.assignedSalespersonId
          ? (nameMap.get(l.assignedSalespersonId) ?? null)
          : null,
        territoryName: territory?.name ?? null,
        nextAction: NEXT_ACTION[l.status] ?? null,
      };
    });
    return { data, total, page, limit };
  }

  /**
   * Fetch one lead with its history, meetings, resolved names, next action and
   * related-record counts.
   * @throws LeadNotFoundException if missing/soft-deleted/other tenant
   */
  async findById(
    id: string,
    tenantId: string,
    branchId?: string,
  ): Promise<LeadDetail> {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        territory: { select: { name: true } },
        statusHistory: { orderBy: { createdAt: 'desc' } },
        meetings: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            meetings: { where: { deletedAt: null } },
            followUps: { where: { deletedAt: null } },
            trips: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!lead) {
      throw new LeadNotFoundException(id);
    }
    const { territory, statusHistory, meetings, _count, ...rest } = lead;
    const names = await this.staff.resolveNames([
      rest.assignedSalespersonId ?? '',
      rest.leadOwnerId ?? '',
    ]);
    return {
      ...rest,
      salespersonName: rest.assignedSalespersonId
        ? (names.get(rest.assignedSalespersonId) ?? null)
        : null,
      leadOwnerName: rest.leadOwnerId
        ? (names.get(rest.leadOwnerId) ?? null)
        : null,
      territoryName: territory?.name ?? null,
      nextAction: NEXT_ACTION[rest.status] ?? null,
      statusHistory,
      meetings,
      meetingCount: _count.meetings,
      followUpCount: _count.followUps,
      tripCount: _count.trips,
    };
  }

  /**
   * Update a lead's fields (append a "Lead updated" history entry). Validates any
   * changed salesperson/owner/territory reference.
   * @throws LeadNotFoundException / InvalidSalespersonException / InvalidSalesTerritoriesException
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    dto: UpdateLeadDto,
    actorId?: string,
  ): Promise<LeadDetail> {
    await this.findById(id, tenantId, branchId);
    await this.validateRefs(tenantId, branchId, dto);
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.lead.update({
        where: { id },
        data: { ...this.mapWriteData(dto), updatedBy: actorId ?? null },
      });
      await tx.leadStatusHistory.create({
        data: {
          tenantId,
          leadId: id,
          action: 'Lead updated',
          byPersonId: actorId ?? null,
        },
      });
    });
    return this.findById(id, tenantId, branchId);
  }

  /**
   * Transition a lead to a new status (the per-row Immediate Action / manual
   * change). Records history. When `CONFIRMED → STARTED` and the lead has an
   * assigned salesperson, a linked Trip is created (the "Start Trip" flow); its
   * code is noted on the history entry.
   * @throws LeadNotFoundException
   */
  async updateStatus(
    id: string,
    tenantId: string,
    branchId: string,
    dto: UpdateLeadStatusDto,
    actorId?: string,
  ): Promise<LeadDetail> {
    const lead = await this.findById(id, tenantId, branchId);

    // "Start Trip" side effect: create a real linked trip first, so an invalid
    // salesperson aborts before we mutate the lead.
    let tripNote: string | undefined;
    if (
      lead.status === LeadStatus.CONFIRMED &&
      dto.status === LeadStatus.STARTED &&
      lead.assignedSalespersonId
    ) {
      const trip = await this.tripService.create(
        tenantId,
        branchId,
        {
          salespersonId: lead.assignedSalespersonId,
          leadId: lead.id,
          status: 'IN_PROGRESS',
          startingLocation: lead.city ?? undefined,
          tripDate: new Date().toISOString(),
        },
        actorId,
      );
      tripNote = `Trip ${trip.tripCode} started`;
    }

    await this.applyStatus(tenantId, id, lead.status, dto.status, actorId, {
      remarks: tripNote ?? dto.remarks,
      gps: dto.gps,
    });
    return this.findById(id, tenantId, branchId);
  }

  /**
   * Record a meeting outcome: maps the outcome → the lead's next status, updates
   * the denormalised meeting/commercial fields, creates a `LeadMeeting` history
   * row and a status-history entry.
   * @throws LeadNotFoundException
   */
  async recordMeetingOutcome(
    id: string,
    tenantId: string,
    branchId: string,
    dto: MeetingOutcomeDto,
    actorId?: string,
  ): Promise<LeadDetail> {
    const lead = await this.findById(id, tenantId, branchId);
    const toStatus = OUTCOME_TO_STATUS[dto.outcome];
    const nextFollowUpDate = dto.nextFollowUp
      ? new Date(dto.nextFollowUp)
      : lead.nextFollowUpDate;
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.leadMeeting.create({
        data: {
          tenantId,
          branchId,
          leadId: id,
          type: lead.meetingType,
          scheduledAt: lead.meetingDate ?? new Date(),
          outcome: dto.outcome,
          summary: dto.summary ?? null,
          requirement: dto.requirement ?? null,
          objections: dto.objections ?? null,
          competitor: dto.competitor ?? null,
          expectedMonthlyBusiness: dto.expectedMonthlyBusiness ?? null,
          gps: dto.gps ?? null,
          attachmentUrl: dto.attachmentUrl ?? null,
          byPersonId: actorId ?? null,
        },
      });
      await tx.lead.update({
        where: { id },
        data: {
          status: toStatus,
          nextFollowUpDate,
          expectedClosureDate: dto.expectedClosure
            ? new Date(dto.expectedClosure)
            : lead.expectedClosureDate,
          objectionsRaised: dto.objections ?? lead.objectionsRaised,
          competitorName: dto.competitor ?? lead.competitorName,
          expectedMonthlyVolume:
            dto.expectedMonthlyBusiness ?? lead.expectedMonthlyVolume,
          updatedBy: actorId ?? null,
        },
      });
      await tx.leadStatusHistory.create({
        data: {
          tenantId,
          leadId: id,
          action: `Meeting outcome: ${dto.outcome}`,
          fromStatus: lead.status,
          toStatus,
          byPersonId: actorId ?? null,
          gps: dto.gps ?? null,
          remarks: dto.summary ?? null,
          attachmentUrl: dto.attachmentUrl ?? null,
        },
      });

      // Keep the Follow-Ups queue in sync with the lead lifecycle: a
      // "Follow-up Required" outcome auto-creates a SCHEDULED follow-up task on
      // THIS transaction (reusing SalesFollowUpService), so it rolls back with
      // the lead update if anything fails. The lead's salesperson is already
      // validated, so we call createInTx directly (no re-validation).
      if (toStatus === LeadStatus.FOLLOW_UP_REQUIRED) {
        const followUpDto: CreateFollowUpDto = {
          leadId: id,
          type: FollowUpType.PHONE_CALL,
          priority: LeadPriority.MEDIUM,
          status: FollowUpStatus.SCHEDULED,
          dueAt: nextFollowUpDate?.toISOString(),
          assignedSalespersonId: lead.assignedSalespersonId ?? undefined,
          lastDiscussion: dto.summary ?? undefined,
          nextAction: dto.nextAction ?? undefined,
        };
        await this.followUpService.createInTx(
          tx,
          tenantId,
          branchId,
          followUpDto,
          actorId,
        );
      }
    });
    return this.findById(id, tenantId, branchId);
  }

  /**
   * Convert a lead (shortcut → status CONVERTED, pipeline CLOSED_WON). Sets
   * `convertedValue` from the estimate when not already set. Status-only per the
   * current phase — no downstream client/referral record is created.
   */
  async convert(
    id: string,
    tenantId: string,
    branchId: string,
    actorId?: string,
  ): Promise<LeadDetail> {
    const lead = await this.findById(id, tenantId, branchId);
    await this.applyStatus(
      tenantId,
      id,
      lead.status,
      LeadStatus.CONVERTED,
      actorId,
      {
        action: 'Mark Converted',
        pipelineStage: PipelineStage.CLOSED_WON,
        convertedValue:
          Number(lead.convertedValue) || Number(lead.estimatedDealValue),
      },
    );
    return this.findById(id, tenantId, branchId);
  }

  /** Mark a lead Lost (status LOST, pipeline CLOSED_LOST). */
  async markLost(
    id: string,
    tenantId: string,
    branchId: string,
    actorId?: string,
  ): Promise<LeadDetail> {
    const lead = await this.findById(id, tenantId, branchId);
    await this.applyStatus(
      tenantId,
      id,
      lead.status,
      LeadStatus.LOST,
      actorId,
      { action: 'Mark Lost', pipelineStage: PipelineStage.CLOSED_LOST },
    );
    return this.findById(id, tenantId, branchId);
  }

  /**
   * Attach a proposal/quotation/agreement document URL to a lead and update the
   * corresponding status. Records a history entry.
   */
  async uploadDocument(
    id: string,
    tenantId: string,
    branchId: string,
    dto: UploadLeadDocumentDto,
    actorId?: string,
  ): Promise<LeadDetail> {
    await this.findById(id, tenantId, branchId);
    const data: Prisma.LeadUpdateInput = {};
    if (dto.docType === 'proposal') {
      data.proposalFileUrl = dto.url;
      data.proposalStatus = dto.status ?? SalesDocumentStatus.SHARED;
    } else if (dto.docType === 'quotation') {
      data.quotationFileUrl = dto.url;
      data.quotationStatus = dto.status ?? SalesDocumentStatus.SHARED;
    } else {
      data.agreementFileUrl = dto.url;
    }
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.lead.update({ where: { id }, data });
      await tx.leadStatusHistory.create({
        data: {
          tenantId,
          leadId: id,
          action: `Uploaded ${dto.docType}`,
          byPersonId: actorId ?? null,
          attachmentUrl: dto.url,
        },
      });
    });
    return this.findById(id, tenantId, branchId);
  }

  /**
   * Soft-delete a lead.
   * @throws LeadNotFoundException if missing
   */
  async remove(id: string, tenantId: string, branchId: string): Promise<Lead> {
    await this.findById(id, tenantId, branchId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.lead.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  /** Return the lead's status/timeline history (newest first). */
  async getAudit(id: string, tenantId: string, branchId: string) {
    await this.findById(id, tenantId, branchId);
    return this.prisma.leadStatusHistory.findMany({
      where: { tenantId, leadId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Option lists for the Sales FE dropdowns (enum-backed + open-ended lists).
   * Enum values are returned as-is (the FE maps codes → labels).
   */
  options() {
    return {
      categories: LEAD_CATEGORIES,
      organizationTypes: ORGANIZATION_TYPES,
      sources: LEAD_SOURCES,
      billingTypes: BILLING_TYPES,
      integrations: INTEGRATION_OPTIONS,
      documents: REQUIRED_DOC_OPTIONS,
      preferredContacts: PREFERRED_CONTACTS,
      priorities: Object.values(LeadPriority),
      statuses: Object.values(LeadStatus),
      pipelineStages: Object.values(PipelineStage),
      meetingTypes: Object.values(MeetingType),
      meetingOutcomes: Object.values(MeetingOutcome),
      proposalStatuses: Object.values(SalesDocumentStatus),
      quotationStatuses: Object.values(SalesDocumentStatus),
      agreementStatuses: Object.values(AgreementStatus),
      followUpTypes: Object.values(FollowUpType),
      followUpStatuses: Object.values(FollowUpStatus),
      tripStatuses: Object.values(TripStatus),
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /**
   * Apply a status change + history entry (and optional pipeline/convertedValue)
   * in one transaction. Shared by updateStatus/convert/markLost. Delegates the
   * write to the shared {@link SalesLeadStatusService} — the single source of
   * truth for lead status + history, also used by the follow-up/trip sync.
   */
  private async applyStatus(
    tenantId: string,
    id: string,
    fromStatus: LeadStatus,
    toStatus: LeadStatus,
    actorId?: string,
    opts: {
      action?: string;
      pipelineStage?: PipelineStage;
      convertedValue?: number;
      remarks?: string;
      gps?: string;
    } = {},
  ): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) =>
      this.leadStatus.applyStatusInTx(
        tx,
        tenantId,
        id,
        fromStatus,
        toStatus,
        actorId,
        opts,
      ),
    );
  }

  /** Validate any salesperson/owner/territory references present on the payload. */
  private async validateRefs(
    tenantId: string,
    branchId: string,
    dto: CreateLeadDto | UpdateLeadDto,
  ): Promise<void> {
    if (dto.assignedSalespersonId) {
      await this.staff.assertSalesperson(tenantId, dto.assignedSalespersonId);
    }
    if (dto.leadOwnerId) {
      await this.staff.assertSalesperson(tenantId, dto.leadOwnerId);
    }
    if (dto.territoryId) {
      await this.territoryService.assertValidTerritories(tenantId, branchId, [
        dto.territoryId,
      ]);
    }
  }

  /**
   * Duplicate-detection per the tenant's Sales settings (defaults to checking
   * mobile + email when no settings row exists).
   * @throws DuplicateLeadException on a matching active lead
   */
  private async assertNotDuplicate(
    tenantId: string,
    dto: CreateLeadDto,
  ): Promise<void> {
    const setting = await this.prisma.salesSetting.findUnique({
      where: { tenantId },
      select: { config: true },
    });
    const config = (setting?.config as DuplicateConfig | null) ?? null;
    if (config?.duplicateLeadCheck === false) return;
    const checkOn = config?.duplicateCheckOn ?? ['mobile', 'email'];

    const checks: Array<{ field: string; where: Prisma.LeadWhereInput }> = [];
    if (checkOn.includes('mobile') && dto.mobile)
      checks.push({ field: 'mobile', where: { mobile: dto.mobile } });
    if (checkOn.includes('email') && dto.email)
      checks.push({ field: 'email', where: { email: dto.email } });
    if (checkOn.includes('gst') && dto.gstNumber)
      checks.push({ field: 'GST number', where: { gstNumber: dto.gstNumber } });
    if (checkOn.includes('organization name') && dto.organizationName)
      checks.push({
        field: 'organization name',
        where: { organizationName: dto.organizationName },
      });

    for (const check of checks) {
      const existing = await this.prisma.lead.findFirst({
        where: { tenantId, deletedAt: null, ...check.where },
        select: { id: true },
      });
      if (existing) {
        const value = (check.where as Record<string, string>)[
          Object.keys(check.where)[0] as string
        ];
        throw new DuplicateLeadException(check.field, value ?? '');
      }
    }
  }

  /**
   * Map a create/update DTO to Prisma scalar write data. Only defined fields are
   * set (so update patches partially); date strings are parsed to `Date`.
   */
  private mapWriteData(
    dto: CreateLeadDto | UpdateLeadDto,
  ): Partial<Prisma.LeadUncheckedCreateInput> {
    const d: Partial<Prisma.LeadUncheckedCreateInput> = {};
    const set = <K extends keyof Prisma.LeadUncheckedCreateInput>(
      key: K,
      value: Prisma.LeadUncheckedCreateInput[K] | undefined,
    ) => {
      if (value !== undefined) d[key] = value;
    };
    const date = (v?: string) => (v ? new Date(v) : undefined);

    set('leadOwnerId', dto.leadOwnerId);
    set('assignedSalespersonId', dto.assignedSalespersonId);
    set('department', dto.department);
    set('territoryId', dto.territoryId);
    set('priority', dto.priority);
    set('category', dto.category);
    set('estimatedDealValue', dto.estimatedDealValue);
    set('expectedClosureDate', date(dto.expectedClosureDate));
    set('probabilityPercent', dto.probabilityPercent);
    set('pipelineStage', dto.pipelineStage);
    set('organizationName', dto.organizationName);
    set('organizationType', dto.organizationType);
    set('registrationNumber', dto.registrationNumber);
    set('gstNumber', dto.gstNumber);
    set('pan', dto.pan);
    set('website', dto.website);
    set('organizationSize', dto.organizationSize);
    set('numberOfBranches', dto.numberOfBranches);
    set('annualPatientVolume', dto.annualPatientVolume);
    set('monthlyReferralPotential', dto.monthlyReferralPotential);
    set('existingDiagnosticPartner', dto.existingDiagnosticPartner);
    set('competitorName', dto.competitorName);
    set('primaryContactName', dto.primaryContactName);
    set('designation', dto.designation);
    set('contactDepartment', dto.contactDepartment);
    set('mobile', dto.mobile);
    set('alternateMobile', dto.alternateMobile);
    set('whatsapp', dto.whatsapp);
    set('landline', dto.landline);
    set('email', dto.email);
    set('preferredContact', dto.preferredContact);
    set('isDecisionMaker', dto.isDecisionMaker);
    set('isInfluencer', dto.isInfluencer);
    set('country', dto.country);
    set('state', dto.state);
    set('district', dto.district);
    set('city', dto.city);
    set('area', dto.area);
    set('addressLine', dto.addressLine);
    set('pincode', dto.pincode);
    set('landmark', dto.landmark);
    set('geoLocation', dto.geoLocation);
    set('distanceFromBranch', dto.distanceFromBranch);
    set('source', dto.source);
    set('sourcePersonName', dto.sourcePersonName);
    set('sourceContactNumber', dto.sourceContactNumber);
    set('sourceRemarks', dto.sourceRemarks);
    set('serviceInterestedIn', dto.serviceInterestedIn);
    set('testMenuRequired', dto.testMenuRequired);
    set('packageRequired', dto.packageRequired);
    set('expectedMonthlyVolume', dto.expectedMonthlyVolume);
    set('expectedMonthlyRevenue', dto.expectedMonthlyRevenue);
    set('expectedDiscountPercent', dto.expectedDiscountPercent);
    set('isCreditRequired', dto.isCreditRequired);
    set('creditDaysRequired', dto.creditDaysRequired);
    set('billingType', dto.billingType);
    set('requiredIntegrations', dto.requiredIntegrations);
    set('requiredDocuments', dto.requiredDocuments);
    set('meetingType', dto.meetingType);
    set('meetingDate', date(dto.meetingDate));
    set('meetingTime', dto.meetingTime);
    set('meetingLocation', dto.meetingLocation);
    set('meetingAgenda', dto.meetingAgenda);
    set('expectedAttendees', dto.expectedAttendees);
    set('isReminderRequired', dto.isReminderRequired);
    set('reminderAt', date(dto.reminderAt));
    set('mrpValue', dto.mrpValue);
    set('offeredDiscountPercent', dto.offeredDiscountPercent);
    set('isSpecialRateCardRequired', dto.isSpecialRateCardRequired);
    set('isCommissionRequired', dto.isCommissionRequired);
    set('referralCommissionPercent', dto.referralCommissionPercent);
    set('revenueSharePercent', dto.revenueSharePercent);
    set('expectedMargin', dto.expectedMargin);
    set('paymentTerms', dto.paymentTerms);
    set('isSecurityDepositRequired', dto.isSecurityDepositRequired);
    set('isAgreementRequired', dto.isAgreementRequired);
    set('isTdsApplicable', dto.isTdsApplicable);
    set('isGstApplicable', dto.isGstApplicable);
    set('isNdaRequired', dto.isNdaRequired);
    set('agreementStatus', dto.agreementStatus);
    set('agreementStartDate', date(dto.agreementStartDate));
    set('agreementEndDate', date(dto.agreementEndDate));
    set('documentVerificationStatus', dto.documentVerificationStatus);
    set('licenseVerificationStatus', dto.licenseVerificationStatus);
    set('isNablRequired', dto.isNablRequired);
    set('dataPrivacyRequirement', dto.dataPrivacyRequirement);
    set('hasReportSharingConsent', dto.hasReportSharingConsent);
    set('authorizedSignatoryName', dto.authorizedSignatoryName);
    set('authorizedSignatoryContact', dto.authorizedSignatoryContact);
    set('internalNotes', dto.internalNotes);
    set('clientNotes', dto.clientNotes);
    set('visitNotes', dto.visitNotes);
    set('objectionsRaised', dto.objectionsRaised);
    set('proposalFileUrl', dto.proposalFileUrl);
    set('quotationFileUrl', dto.quotationFileUrl);
    set('agreementFileUrl', dto.agreementFileUrl);
    set('attachments', dto.attachments);
    set('otherDocuments', dto.otherDocuments);
    set('nextFollowUpDate', date(dto.nextFollowUpDate));
    set('proposalStatus', dto.proposalStatus);
    set('quotationStatus', dto.quotationStatus);
    return d;
  }
}
