import { Injectable } from '@nestjs/common';
import { Prisma, RadiologyStudy, RadiologyStudyStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ACTION_STAMP,
  nextRadiologyStatus,
  RadiologyAction,
} from './constants/radiology-transitions.constant';
import { ListRadiologyStudiesDto } from './dto/list-radiology-studies.dto';
import { ReportRadiologyStudyDto } from './dto/report-radiology-study.dto';
import {
  BulkRadiologyResult,
  RadiologyStudySummary,
  RadiologyStudyWithHistory,
} from './entities/radiology-study.entity';
import {
  InvalidRadiologyStudyTransitionException,
  RadiologyStudyNotFoundException,
} from './exceptions/radiology.exceptions';

/**
 * Worklist row shape: the study plus a lightweight slice of its parent order —
 * the order code, booking/creation timestamps, and patient name — so the FE can
 * render the order identity (code + date·time + patient) on each row, matching
 * the `/accession/in-house` order cell, without a second fetch.
 */
export const RADIOLOGY_STUDY_LIST_INCLUDE = {
  order: {
    select: {
      orderCode: true,
      orderDate: true,
      createdAt: true,
      patient: {
        select: { firstName: true, middleName: true, lastName: true },
      },
    },
  },
} satisfies Prisma.RadiologyStudyInclude;

/** A radiology worklist row (study + order identity slice). */
export type RadiologyStudyListRow = Prisma.RadiologyStudyGetPayload<{
  include: typeof RADIOLOGY_STUDY_LIST_INCLUDE;
}>;

/**
 * Radiology processing service. Owns the radiology worklist (`RadiologyStudy`)
 * generated from radiology orders, and the study lifecycle state machine
 * (schedule → acquire → report → validate → approve → publish, with hold/cancel/
 * retrieve). Mirrors the accession `OrderSampleService` pattern (generate +
 * transition), but SKIPS specimen collection. Tenant-scoped + branch-level
 * (CLAUDE.md §4.7); all writes run in `withTenant` transactions.
 */
@Injectable()
export class RadiologyStudyService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Order → radiology worklist handoff ────────────────────────────────────

  /**
   * Generate the radiology worklist rows for a confirmed order, inside the
   * caller's transaction (invoked by `OrderService.create`). One `RadiologyStudy`
   * per radiology order item (test or panel), born `NEW`, with `studyNo`
   * (`RAD-00001`…) from the per-tenant counter and the radiologist/technician
   * snapshotted from the order's radiology section. Idempotent per order;
   * Bill-Only items are skipped.
   * @param tx the order-creation transaction client
   * @param tenantId tenant scope
   * @param branchId active branch (nullable)
   * @param personId acting person (created-by) or null
   * @param orderId the order to generate studies for
   */
  async generateStudiesForOrderInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    orderId: string,
  ): Promise<void> {
    // Per-ITEM idempotency: a study is generated once per radiology order item.
    // This lets the same routine serve both first-time creation and the update
    // path (adding a radiology item to an existing order) without duplicating
    // studies for items that already have one.
    const existingStudies = await tx.radiologyStudy.findMany({
      where: { orderId, tenantId, deletedAt: null },
      select: { orderItemId: true },
    });
    const coveredItemIds = new Set(
      existingStudies.map((s) => s.orderItemId).filter((v): v is string => !!v),
    );
    const items = await tx.orderItem.findMany({
      where: {
        orderId,
        tenantId,
        deletedAt: null,
        OR: [
          { branchRadiologyTestId: { not: null } },
          { branchRadiologyPanelId: { not: null } },
        ],
      },
      include: { branchRadiologyTest: true, branchRadiologyPanel: true },
    });
    if (items.length === 0) {
      return;
    }
    const section = await tx.orderRadiology.findFirst({
      where: { orderId, tenantId, deletedAt: null },
    });
    for (const item of items) {
      // Skip items that already have a study (idempotent across create + update).
      if (coveredItemIds.has(item.id)) {
        continue;
      }
      const test = item.branchRadiologyTest;
      const panel = item.branchRadiologyPanel;
      // Bill-Only items are billed but never enter the radiology workflow.
      if (test?.isBillOnlyTest || panel?.isBillOnlyTest) {
        continue;
      }
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: { radiologyStudyCounter: { increment: 1 } },
        select: { radiologyStudyCounter: true },
      });
      const studyNo = `RAD-${String(tenant.radiologyStudyCounter).padStart(5, '0')}`;
      const study = await tx.radiologyStudy.create({
        data: {
          tenantId,
          branchId,
          orderId,
          orderItemId: item.id,
          branchRadiologyTestId: test?.id ?? null,
          branchRadiologyPanelId: panel?.id ?? null,
          radiologyTestName:
            test?.testDisplayName ?? test?.testName ?? panel?.panelName ?? null,
          modality: test?.modality ?? null,
          bodyPart: test?.bodyPart ?? null,
          view: test?.view ?? null,
          departmentId: test?.departmentId ?? panel?.departmentId ?? null,
          studyNo,
          radiologistId: section?.radiologistId ?? null,
          technicianId: section?.radiologyTechnicianId ?? null,
          status: RadiologyStudyStatus.NEW,
          createdBy: personId,
          updatedBy: personId,
        },
      });
      await tx.radiologyStudyStatusHistory.create({
        data: {
          tenantId,
          branchId,
          studyId: study.id,
          action: 'create',
          toStatus: RadiologyStudyStatus.NEW,
          fromStatus: null,
          changedBy: personId,
        },
      });
    }
  }

  /**
   * Tombstone (soft-delete) the studies whose order item was removed on an edit,
   * so a radiology item dropped during an order update also leaves the worklist.
   * Mirrors the accession sample-reconcile "tombstone removed items" behaviour.
   * @param tx the order-update transaction client
   * @param tenantId tenant scope
   * @param orderItemIds the removed order-item ids
   */
  async tombstoneStudiesForRemovedItemsInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderItemIds: string[],
  ): Promise<void> {
    if (orderItemIds.length === 0) {
      return;
    }
    await tx.radiologyStudy.updateMany({
      where: { tenantId, orderItemId: { in: orderItemIds }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /**
   * Paginated radiology worklist for the tenant (optionally scoped to a branch),
   * newest first. Supports search + status/modality/radiologist/order filters.
   */
  async findAll(
    tenantId: string,
    branchId: string | null,
    query: ListRadiologyStudiesDto,
  ): Promise<{
    data: (RadiologyStudyListRow & { departmentName: string | null })[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.RadiologyStudyWhereInput = {
      tenantId,
      deletedAt: null,
      ...(branchId ? { branchId } : {}),
      // `statuses` (multi) powers the collapsed New/In Progress/Published tabs and
      // takes precedence over the single `status` when both are sent.
      ...(query.statuses?.length
        ? { status: { in: query.statuses } }
        : query.status
          ? { status: query.status }
          : {}),
      ...(query.modality ? { modality: query.modality } : {}),
      ...(query.radiologistId ? { radiologistId: query.radiologistId } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
    };
    const term = query.search?.trim();
    if (term) {
      where.OR = [
        { studyNo: { contains: term, mode: 'insensitive' } },
        { radiologyTestName: { contains: term, mode: 'insensitive' } },
        { bodyPart: { contains: term, mode: 'insensitive' } },
        // Let the free-text search also match the parent order's code, so a user
        // can find a study by the Order ID now shown on the row.
        { order: { orderCode: { contains: term, mode: 'insensitive' } } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.radiologyStudy.findMany({
        where,
        include: RADIOLOGY_STUDY_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.radiologyStudy.count({ where }),
    ]);
    // `departmentId` is a logical reference (no relation); resolve the display
    // names in one batched lookup so the worklist / order-console show them.
    const deptNames = await this.resolveDepartmentNames(
      tenantId,
      data.map((s) => s.departmentId),
    );
    const enriched = data.map((s) => ({
      ...s,
      departmentName: s.departmentId
        ? (deptNames.get(s.departmentId) ?? null)
        : null,
    }));
    return { data: enriched, total, page, limit };
  }

  /** Batched department id → name lookup for a tenant (logical refs, no relation). */
  private async resolveDepartmentNames(
    tenantId: string,
    idsRaw: (string | null)[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(idsRaw.filter((x): x is string => Boolean(x)))];
    const map = new Map<string, string>();
    if (ids.length === 0) {
      return map;
    }
    const rows = await this.prisma.department.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, name: true },
    });
    for (const r of rows) {
      map.set(r.id, r.name);
    }
    return map;
  }

  /** Fetch one study (with its status history). */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<RadiologyStudyWithHistory> {
    const study = await this.prisma.radiologyStudy.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        statusHistory: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!study) {
      throw new RadiologyStudyNotFoundException(id);
    }
    return study;
  }

  /** The study's append-only status history (audit trail). */
  async getHistory(id: string, tenantId: string) {
    await this.assertExists(id, tenantId);
    return this.prisma.radiologyStudyStatusHistory.findMany({
      where: { studyId: id, tenantId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Per-status counts for the worklist summary cards (+ a grand total). */
  async summary(
    tenantId: string,
    branchId: string | null,
  ): Promise<RadiologyStudySummary> {
    const where: Prisma.RadiologyStudyWhereInput = {
      tenantId,
      deletedAt: null,
      ...(branchId ? { branchId } : {}),
    };
    const grouped = await this.prisma.radiologyStudy.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const out: RadiologyStudySummary = { total: 0 };
    for (const status of Object.values(RadiologyStudyStatus)) {
      out[status] = 0;
    }
    for (const g of grouped) {
      out[g.status] = g._count._all;
      out.total += g._count._all;
    }
    return out;
  }

  // ── Lifecycle transitions ─────────────────────────────────────────────────

  /**
   * Apply a status action to one study atomically, validating it against the
   * state machine and appending a history row.
   * @throws RadiologyStudyNotFoundException / InvalidRadiologyStudyTransitionException
   */
  async transition(
    id: string,
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    action: RadiologyAction,
    dto: ReportRadiologyStudyDto,
  ): Promise<RadiologyStudy> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      // Branch scope (CLAUDE.md §4.7): a branch-scoped caller (non-null active
      // branch) may only act on studies in that branch; a tenant-level caller
      // (`branchId === null`, e.g. business_admin) may act on any branch's study.
      const study = await tx.radiologyStudy.findFirst({
        where: {
          id,
          tenantId,
          deletedAt: null,
          ...(branchId ? { branchId } : {}),
        },
      });
      if (!study) {
        throw new RadiologyStudyNotFoundException(id);
      }
      const { toStatus, extra } = this.resolveTransition(study, action, dto);
      const updated = await tx.radiologyStudy.update({
        where: { id },
        data: {
          status: toStatus,
          previousStatus: study.status,
          updatedBy: personId,
          ...extra,
        },
      });
      await tx.radiologyStudyStatusHistory.create({
        data: {
          tenantId,
          branchId: study.branchId,
          studyId: id,
          action,
          toStatus,
          fromStatus: study.status,
          reason: dto.reason ?? null,
          notes: dto.notes ?? null,
          attachmentUrl: dto.attachmentUrl ?? null,
          changedBy: personId,
        },
      });
      return updated;
    });
  }

  /**
   * Apply one action to several studies; one failure never aborts the batch.
   * @returns `{ succeeded, failed }`
   */
  async bulkTransition(
    ids: string[],
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    action: RadiologyAction,
    dto: ReportRadiologyStudyDto,
  ): Promise<BulkRadiologyResult> {
    const result: BulkRadiologyResult = { succeeded: [], failed: [] };
    for (const id of ids) {
      try {
        await this.transition(id, tenantId, branchId, personId, action, dto);
        result.succeeded.push(id);
      } catch (e) {
        result.failed.push({
          id,
          reason: e instanceof Error ? e.message : 'Transition failed',
        });
      }
    }
    return result;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Resolve the target status + the column updates for an action. `retrieve`
   * reverts to `previousStatus`; the lifecycle actions stamp their timestamp and
   * `report` writes the narrative fields; `hold` records a reason.
   */
  private resolveTransition(
    study: RadiologyStudy,
    action: RadiologyAction,
    dto: ReportRadiologyStudyDto,
  ): {
    toStatus: RadiologyStudyStatus;
    extra: Prisma.RadiologyStudyUncheckedUpdateInput;
  } {
    const extra: Prisma.RadiologyStudyUncheckedUpdateInput = {};

    if (action === 'retrieve') {
      // `retrieve` is the undo for a HELD study only — reverting it to the status
      // it was in before being put on hold. It must never resurrect a terminal
      // CANCELLED study or un-publish an APPROVED/PUBLISHED one.
      if (study.status !== RadiologyStudyStatus.HOLD) {
        throw new InvalidRadiologyStudyTransitionException(
          study.id,
          action,
          study.status,
        );
      }
      const toStatus = study.previousStatus ?? RadiologyStudyStatus.NEW;
      return { toStatus, extra };
    }

    const toStatus = nextRadiologyStatus(action, study.status);
    if (!toStatus) {
      throw new InvalidRadiologyStudyTransitionException(
        study.id,
        action,
        study.status,
      );
    }

    const stamp = ACTION_STAMP[action];
    if (stamp) {
      extra[stamp] = new Date();
    }

    if (action === 'report') {
      if (dto.findings !== undefined) extra.findings = dto.findings;
      if (dto.impression !== undefined) extra.impression = dto.impression;
      if (dto.recommendation !== undefined)
        extra.recommendation = dto.recommendation;
      if (dto.reportTemplateId !== undefined)
        extra.reportTemplateId = dto.reportTemplateId;
      if (dto.radiologistId !== undefined)
        extra.radiologistId = dto.radiologistId;
      if (dto.reportingDoctorId !== undefined)
        extra.reportingDoctorId = dto.reportingDoctorId;
    }

    if (action === 'hold') {
      extra.holdReason = dto.reason ?? dto.notes ?? null;
    }

    return { toStatus, extra };
  }

  /** Throw if the study does not exist for this tenant. */
  private async assertExists(id: string, tenantId: string): Promise<void> {
    const found = await this.prisma.radiologyStudy.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new RadiologyStudyNotFoundException(id);
    }
  }
}
