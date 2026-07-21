import { Injectable } from '@nestjs/common';
import {
  AccessionSample,
  AccessionStatusHistory,
  ContainerType,
  LabTestSample,
  Prisma,
  SamplePriority,
  SampleStatus,
  TransferStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult, paginated } from '../../common/dto/response.dto';
import { BranchLabTestConfigSnapshot } from '../branch-lab-test/entities/branch-lab-test.entity';
import {
  SampleAction,
  nextSampleStatus,
} from './constants/sample-transitions.constant';
import { AccessionSettingsMap } from './constants/accession-settings.default';
import {
  TERMINAL_SAMPLE_STATUSES,
  TatStatus,
  deriveTatStatus,
  tatCreatedAtRange,
} from './constants/tat.constant';
import { AccessionSettingsService } from './accession-settings.service';
import { ListSamplesDto, OrderMode } from './dto/list-samples.dto';
import { SampleNoteDto } from './dto/sample-note.dto';
import { ShareSampleDto } from './dto/share-sample.dto';
import { CollectSampleDto } from './dto/collect-sample.dto';
import { AcceptSampleDto } from './dto/accept-sample.dto';
import { StoreSampleDto } from './dto/store-sample.dto';
import { DiscardSampleDto } from './dto/discard-sample.dto';
import { CancelSampleDto } from './dto/cancel-sample.dto';
import { RepeatSampleDto } from './dto/repeat-sample.dto';
import { ReturnSampleDto } from './dto/return-sample.dto';
import { AssignBarcodeDto } from './dto/assign-barcode.dto';
import {
  SAMPLE_INCLUDE,
  SAMPLE_LIST_INCLUDE,
  AccessionSampleListItem,
  AccessionSampleWithRelations,
  AccessionSummary,
} from './entities/accession-sample.entity';
import {
  AccessionNumberConflictException,
  AccessionSampleNotFoundException,
  InvalidSampleTransitionException,
} from './exceptions/accession.exceptions';

/** A grouping bucket accumulated while generating samples for an order. */
interface SampleGroup {
  sampleType: string | null;
  containerType: ContainerType | null;
  label: string;
  /** order-item id → snapshot test name (deduped per group). */
  items: Map<string, string | null>;
}

/** The scalar field writes + optional history reason an action applies. */
interface ActionPatch {
  data: Prisma.AccessionSampleUpdateInput;
  reason?: string;
}

/** History note/attachment carried by every action modal (PDF §A.10). */
interface ActionNote {
  notes?: string;
  attachmentUrl?: string;
}

/**
 * Accession samples — the core per-tube entity of the accession module.
 * Tenant-scoped (RLS) + branch-level (CLAUDE.md §4.5/§4.7).
 *
 * Owns: (a) generating a diagnostic order's samples when it is confirmed
 * (`generateForOrderInTx`, called by `OrderService`); (b) the accession list,
 * Sample Overview, Sample History and summary (status tabs + TAT bar) reads; and
 * (c) the PDF §A.9 sample state machine — every action (`collect`/`accept`/… and
 * the transfer entry points) validates the transition, moves `status`, records
 * `previousStatus` for the universal Retrieve/undo, and appends an immutable
 * `AccessionStatusHistory` row, all in one `withTenant` transaction. Each action
 * has a single-item and a bulk (`ids[]`) variant looping inside one transaction
 * (PDF §A.11). Reads always filter `{ tenantId, deletedAt: null }`.
 */
@Injectable()
export class AccessionSampleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AccessionSettingsService,
  ) {}

  // ── Sample generation (order → accession) ─────────────────────────────────

  /**
   * Generate the accession samples for an order inside an existing (already
   * tenant-scoped) transaction. Groups the order's items by their required
   * sample (container + sample type, from `BranchLabTest.configSnapshot.samples`)
   * and creates one `AccessionSample` (status `NEW`) per group, each linked to the
   * contributing order items via `AccessionSampleTest` and seeded with an initial
   * `AccessionStatusHistory` row. Idempotent per order: skips generation if the
   * order already has samples.
   * @param tx active Prisma transaction client (already tenant-scoped)
   * @param tenantId tenant scope
   * @param branchId active branch (origin + processing branch; may be null)
   * @param personId acting person id (created/updated/changed by)
   * @param orderId the order whose items to turn into samples
   */
  async generateForOrderInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    orderId: string,
  ): Promise<void> {
    const existing = await tx.accessionSample.count({
      where: { orderId, tenantId, deletedAt: null },
    });
    if (existing > 0) return;

    const items = await tx.orderItem.findMany({
      where: { orderId, tenantId, deletedAt: null },
      include: { branchLabTest: true },
    });
    if (items.length === 0) return;

    const groups = new Map<string, SampleGroup>();
    for (const item of items) {
      const testName = item.branchLabTest?.testName ?? item.direct ?? null;
      const samples = this.samplesOf(item.branchLabTest?.configSnapshot);
      if (samples.length === 0) {
        this.addToGroup(groups, null, null, item.id, testName);
        continue;
      }
      for (const s of samples) {
        this.addToGroup(
          groups,
          s.sampleType ?? null,
          s.containerType ?? null,
          item.id,
          testName,
        );
      }
    }

    for (const group of groups.values()) {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: { accessionCounter: { increment: 1 } },
        select: { accessionCounter: true },
      });
      const accessionNo = `ACC-${String(tenant.accessionCounter).padStart(5, '0')}`;
      await tx.accessionSample.create({
        data: {
          tenantId,
          branchId,
          orderId,
          accessionNo,
          sampleType: group.sampleType,
          containerType: group.containerType,
          sampleGroupLabel: group.label,
          status: SampleStatus.NEW,
          originBranchId: branchId,
          processingBranchId: branchId,
          createdBy: personId,
          updatedBy: personId,
          tests: {
            create: [...group.items.entries()].map(([orderItemId, name]) => ({
              tenantId,
              branchId,
              orderItemId,
              testName: name,
            })),
          },
          statusHistory: {
            create: {
              tenantId,
              branchId,
              action: 'generate',
              toStatus: SampleStatus.NEW,
              changedBy: personId,
            },
          },
        },
      });
    }
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /**
   * List accession samples for the active branch, paginated + filterable (the
   * §A.3 filter panel, §A.5 status tabs and §A.4 TAT bar). `search` matches the
   * accession number or barcode. Each row is enriched with its derived TAT band.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param query pagination + filters
   * @returns a page of samples (newest first) with order/patient + test context
   */
  async findAll(
    tenantId: string,
    branchId: string | null,
    query: ListSamplesDto,
  ): Promise<PaginatedResult<AccessionSampleListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const nowMs = Date.now();
    const tat = await this.tatThresholds(tenantId, branchId);

    const where = this.buildSampleWhere(tenantId, branchId, query, tat, nowMs);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.accessionSample.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: SAMPLE_LIST_INCLUDE,
      }),
      this.prisma.accessionSample.count({ where }),
    ]);
    const items: AccessionSampleListItem[] = data.map((row) => ({
      ...row,
      tatStatus: deriveTatStatus(row.createdAt, row.status, tat, nowMs),
    }));
    return paginated(items, total, page, limit);
  }

  /**
   * Accession list summary for the active branch: a count per status (§A.5 tabs,
   * all statuses present with 0 default), a count per TAT band (§A.4 bar), and the
   * overall total.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   */
  async summary(
    tenantId: string,
    branchId: string | null,
  ): Promise<AccessionSummary> {
    const where: Prisma.AccessionSampleWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };
    const grouped = await this.prisma.accessionSample.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const byStatus = Object.values(SampleStatus).reduce(
      (acc, s) => ({ ...acc, [s]: 0 }),
      {} as Record<SampleStatus, number>,
    );
    let total = 0;
    for (const g of grouped) {
      byStatus[g.status] = g._count._all;
      total += g._count._all;
    }

    const nowMs = Date.now();
    const tat = await this.tatThresholds(tenantId, branchId);
    const rows = await this.prisma.accessionSample.findMany({
      where,
      select: { createdAt: true, status: true },
    });
    const byTat: Record<TatStatus, number> = {
      WITHIN: 0,
      WARNING: 0,
      CRITICAL: 0,
      BREACHED: 0,
    };
    for (const r of rows) {
      const band = deriveTatStatus(r.createdAt, r.status, tat, nowMs);
      if (band) byTat[band] += 1;
    }
    return { total, byStatus, byTat };
  }

  /**
   * Fetch one accession sample fully composed (tests + history + transfers +
   * order/patient), scoped to the tenant (Sample Overview — PDF §A.10.4).
   * @param id sample id
   * @param tenantId tenant scope
   * @throws AccessionSampleNotFoundException if missing/soft-deleted/other tenant
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<AccessionSampleWithRelations> {
    const sample = await this.prisma.accessionSample.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: SAMPLE_INCLUDE,
    });
    if (!sample) {
      throw new AccessionSampleNotFoundException(id);
    }
    return sample;
  }

  /**
   * Return a sample's status-history log (newest first), tenant-scoped
   * (Sample History panel — PDF §A.10.5).
   * @param id sample id
   * @param tenantId tenant scope
   * @throws AccessionSampleNotFoundException if the sample is missing
   */
  async findHistory(
    id: string,
    tenantId: string,
  ): Promise<AccessionStatusHistory[]> {
    await this.findById(id, tenantId);
    return this.prisma.accessionStatusHistory.findMany({
      where: { sampleId: id, tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── State-machine actions (PDF §A.9/§A.10) ─────────────────────────────────

  /** Collect Sample (§A.10.1) — New/Hold/Repeat → Collected. */
  async collect(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: CollectSampleDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'collect',
      () => ({
        data: {
          collectedAt: dto.collectedAt ? new Date(dto.collectedAt) : new Date(),
          collectedBy: personId,
          tubeType: dto.tubeType,
        },
      }),
      dto,
    );
  }

  /** Collect & Print (§A.10.1) — as Collect, and assigns a barcode if missing. */
  async collectAndPrint(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: CollectSampleDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'collect',
      (sample) => ({
        data: {
          collectedAt: dto.collectedAt ? new Date(dto.collectedAt) : new Date(),
          collectedBy: personId,
          tubeType: dto.tubeType,
          barcode: sample.barcode ?? this.deriveBarcode(sample.accessionNo),
        },
      }),
      dto,
    );
  }

  /** Accept Sample — Collected/Halt → Accepted (stamps received/accepted time). */
  async accept(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: AcceptSampleDto,
  ): Promise<AccessionSampleWithRelations[]> {
    const now = new Date();
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'accept',
      () => ({
        data: {
          receivedAt: now,
          acceptedAt: now,
          sampleCondition: dto.sampleCondition,
        },
      }),
      dto,
    );
  }

  /** Acquire — Accepted → Acquired. */
  async acquire(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: SampleNoteDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'acquire',
      () => ({ data: {} }),
      dto,
    );
  }

  /** Hault — Collected/Acquired → Halt. */
  async halt(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: SampleNoteDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'halt',
      () => ({ data: {} }),
      dto,
    );
  }

  /** Error — Halt → Error. */
  async error(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: SampleNoteDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'error',
      () => ({ data: {} }),
      dto,
    );
  }

  /** Hold — New/Repeat → Hold. */
  async hold(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: SampleNoteDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'hold',
      () => ({ data: {} }),
      dto,
    );
  }

  /** Repeat — Acquired/Halt/Error → Repeat (records the repeat reason). */
  async repeat(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: RepeatSampleDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'repeat',
      () => ({ data: {}, reason: dto.repeatReason }),
      dto,
    );
  }

  /** Store — Accepted → Stored (records the storage location). */
  async store(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: StoreSampleDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'store',
      () => ({ data: { storeLocation: dto.storeLocation } }),
      dto,
    );
  }

  /** Discard — Stored → Discarded (records the discard method). */
  async discard(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: DiscardSampleDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'discard',
      () => ({ data: {}, reason: dto.discardMethod }),
      dto,
    );
  }

  /** Return — Accepted/Error/Stored → Returned (records the handover person). */
  async returnSample(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: ReturnSampleDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'return',
      () => ({
        data: dto.handoverPerson ? { logisticsPerson: dto.handoverPerson } : {},
      }),
      dto,
    );
  }

  /** Cancel — New/Collected/Hold → Cancelled (records the cancellation reason). */
  async cancel(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: CancelSampleDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'cancel',
      () => ({ data: {}, reason: dto.reason }),
      dto,
    );
  }

  /**
   * Retrieve / Retry (§A.7/§A.10.19) — the universal undo. Reverts a transferred
   * sample (Sent/Forward/Outsourced/Returned) back to Accepted per §A.9, and for
   * any other status reverts to the recorded `previousStatus`.
   */
  async retrieve(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: SampleNoteDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'retrieve',
      () => ({ data: {} }),
      dto,
    );
  }

  // ── No-status-change mutations (§A.10.2 / §A.10.3) ─────────────────────────

  /**
   * Assign Barcode & Print (§A.10.2) — available at any status, no status change.
   * Assigns the given barcode, or the system-generated `BAR-#####-A` when omitted.
   * @throws AccessionNumberConflictException on a barcode uniqueness clash
   */
  async assignBarcode(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: AssignBarcodeDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.mutateIds(
      ids,
      tenantId,
      personId,
      'assign-barcode',
      (sample) => ({
        data: {
          barcode: dto.barcode ?? this.deriveBarcode(sample.accessionNo),
        },
      }),
      {},
    );
  }

  /** Update Sample (§A.10.3) — records a note/attachment with no status change. */
  async updateNotes(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: SampleNoteDto,
  ): Promise<AccessionSampleWithRelations[]> {
    return this.mutateIds(
      ids,
      tenantId,
      personId,
      'update',
      () => ({ data: {} }),
      dto,
    );
  }

  /**
   * Share & Inform (§A.10.20) — record a notification/document share against the
   * sample (no status change). The share intent is logged to history; actual
   * SMS/WhatsApp/Email dispatch is handled by the messaging/Finance module.
   */
  async share(
    id: string,
    tenantId: string,
    personId: string | null,
    dto: ShareSampleDto,
  ): Promise<AccessionSampleWithRelations> {
    const [sample] = await this.mutateIds(
      [id],
      tenantId,
      personId,
      'share',
      () => ({ data: {}, reason: `${dto.channel} → ${dto.informTo}` }),
      { notes: dto.message, attachmentUrl: dto.documentUrl },
    );
    return sample ?? this.findById(id, tenantId);
  }

  // ── Core engine ────────────────────────────────────────────────────────────

  /**
   * Apply a validated §A.9 transition to a single sample inside an existing
   * (already tenant-scoped) transaction: check the action is legal from the
   * sample's current status, move `status` (recording `previousStatus`), write the
   * action's field patch, and append an immutable history row. Retrieve also
   * cancels any still-open transfer for the sample (recall — PDF §A.10.19). Public
   * so the transfer service can drive a sample transition + create/close its
   * `SampleTransfer` atomically in one transaction.
   * @returns the updated sample row
   * @throws AccessionSampleNotFoundException / InvalidSampleTransitionException
   */
  async transitionInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    sampleId: string,
    action: SampleAction,
    build: (sample: AccessionSample) => ActionPatch,
    note: ActionNote = {},
  ): Promise<AccessionSample> {
    const sample = await tx.accessionSample.findFirst({
      where: { id: sampleId, tenantId, deletedAt: null },
    });
    if (!sample) throw new AccessionSampleNotFoundException(sampleId);

    const toStatus =
      action === 'retrieve'
        ? (nextSampleStatus('retrieve', sample.status) ?? sample.previousStatus)
        : nextSampleStatus(action, sample.status);
    if (!toStatus) {
      throw new InvalidSampleTransitionException(action, sample.status);
    }

    if (action === 'retrieve') {
      await tx.sampleTransfer.updateMany({
        where: {
          sampleId: sample.id,
          tenantId,
          deletedAt: null,
          transferStatus: {
            in: [
              TransferStatus.IN_TRANSIT,
              TransferStatus.PICKED_UP,
              TransferStatus.RECEIVED,
            ],
          },
        },
        data: {
          transferStatus: TransferStatus.REJECTED,
          rejectionReason: 'Recalled via Retrieve',
          updatedBy: personId,
        },
      });
    }

    const built = build(sample);
    const updated = await tx.accessionSample.update({
      where: { id: sample.id },
      data: {
        ...built.data,
        status: toStatus,
        previousStatus: sample.status,
        updatedBy: personId,
      },
    });
    await tx.accessionStatusHistory.create({
      data: {
        tenantId,
        branchId: sample.branchId,
        sampleId: sample.id,
        action,
        toStatus,
        fromStatus: sample.status,
        reason: built.reason ?? null,
        notes: note.notes ?? null,
        attachmentUrl: note.attachmentUrl ?? null,
        changedBy: personId,
      },
    });
    return updated;
  }

  /**
   * Apply a validated §A.9 transition to each id inside one tenant-scoped
   * transaction (loops `transitionInTx`). All-or-nothing across the id set.
   * @throws AccessionSampleNotFoundException / InvalidSampleTransitionException
   * @throws AccessionNumberConflictException on a barcode clash (collect & print)
   */
  private async transitionIds(
    ids: string[],
    tenantId: string,
    personId: string | null,
    action: SampleAction,
    build: (sample: AccessionSample) => ActionPatch,
    note: ActionNote = {},
  ): Promise<AccessionSampleWithRelations[]> {
    let changed: string[];
    try {
      changed = await this.prisma.withTenant(tenantId, async (tx) => {
        const done: string[] = [];
        for (const id of ids) {
          const updated = await this.transitionInTx(
            tx,
            tenantId,
            personId,
            id,
            action,
            build,
            note,
          );
          done.push(updated.id);
        }
        return done;
      });
    } catch (e) {
      this.rethrowConflict(e);
      throw e;
    }
    return Promise.all(changed.map((id) => this.findById(id, tenantId)));
  }

  /**
   * Apply a no-status-change mutation (assign-barcode / update notes) to each id
   * in one transaction, appending a history row that keeps the current status.
   * @throws AccessionSampleNotFoundException / AccessionNumberConflictException
   */
  private async mutateIds(
    ids: string[],
    tenantId: string,
    personId: string | null,
    action: string,
    build: (sample: AccessionSample) => ActionPatch,
    note: ActionNote,
  ): Promise<AccessionSampleWithRelations[]> {
    let changed: string[];
    try {
      changed = await this.prisma.withTenant(tenantId, async (tx) => {
        const done: string[] = [];
        for (const id of ids) {
          const sample = await tx.accessionSample.findFirst({
            where: { id, tenantId, deletedAt: null },
          });
          if (!sample) throw new AccessionSampleNotFoundException(id);
          const built = build(sample);
          await tx.accessionSample.update({
            where: { id: sample.id },
            data: { ...built.data, updatedBy: personId },
          });
          await tx.accessionStatusHistory.create({
            data: {
              tenantId,
              branchId: sample.branchId,
              sampleId: sample.id,
              action,
              toStatus: sample.status,
              fromStatus: sample.status,
              reason: built.reason ?? null,
              notes: note.notes ?? null,
              attachmentUrl: note.attachmentUrl ?? null,
              changedBy: personId,
            },
          });
          done.push(sample.id);
        }
        return done;
      });
    } catch (e) {
      this.rethrowConflict(e);
      throw e;
    }
    return Promise.all(changed.map((id) => this.findById(id, tenantId)));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Build the tenant/branch-scoped `where` for the sample list from the §A.3
   * filter panel. Order-level filters (date range, department, lab test/panel,
   * order mode, home-collection) are applied through the `order` relation; the
   * TAT band is translated to a `createdAt` range. `AND` holds the composite
   * conditions (search + urgent + outsource) so they don't clobber each other.
   */
  private buildSampleWhere(
    tenantId: string,
    branchId: string | null,
    query: ListSamplesDto,
    tat: AccessionSettingsMap['tat'],
    nowMs: number,
  ): Prisma.AccessionSampleWhereInput {
    const where: Prisma.AccessionSampleWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.orderId) where.orderId = query.orderId;
    if (query.originBranchId) where.originBranchId = query.originBranchId;
    if (query.processingBranchId) {
      where.processingBranchId = query.processingBranchId;
    }
    if (query.logisticsType) where.logisticsType = query.logisticsType;
    if (query.reportStatus) where.reportStatus = query.reportStatus;
    if (query.tatStatus) {
      where.createdAt = tatCreatedAtRange(query.tatStatus, tat, nowMs);
      if (!query.status) {
        where.status = { notIn: [...TERMINAL_SAMPLE_STATUSES] };
      }
    }

    const order: Prisma.OrderWhereInput = {};
    if (query.patientId) order.patientId = query.patientId;
    if (query.referredByDoctorId) {
      order.referredByDoctorId = query.referredByDoctorId;
    }
    if (query.referralPanelId) order.referralPanelId = query.referralPanelId;
    if (query.dateFrom || query.dateTo) {
      order.orderDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    if (query.departmentId || query.branchLabTestId || query.branchLabPanelId) {
      order.items = {
        some: {
          deletedAt: null,
          ...(query.branchLabTestId
            ? { branchLabTestId: query.branchLabTestId }
            : {}),
          ...(query.branchLabPanelId
            ? { branchLabPanelId: query.branchLabPanelId }
            : {}),
          ...(query.departmentId
            ? { branchLabTest: { is: { departmentId: query.departmentId } } }
            : {}),
        },
      };
    }
    if (query.isHomeCollection) {
      order.diagnostics = { is: { isHomeVisit: true } };
    }

    const and: Prisma.AccessionSampleWhereInput[] = [];
    if (query.search) {
      and.push({
        OR: [
          { accessionNo: { contains: query.search, mode: 'insensitive' } },
          { barcode: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    if (query.isOutsource) and.push({ status: SampleStatus.OUTSOURCED });
    if (query.isUrgent) {
      and.push({
        OR: [
          { priority: { in: [SamplePriority.URGENT, SamplePriority.STAT] } },
          { order: { is: { isUrgentBill: true } } },
        ],
      });
    }
    this.applyOrderMode(query.orderMode, order, and);

    if (Object.keys(order).length > 0) where.order = order;
    if (and.length > 0) where.AND = and;
    return where;
  }

  /** Translate the §A.3 "Order Mode" filter into order/sample conditions. */
  private applyOrderMode(
    mode: OrderMode | undefined,
    order: Prisma.OrderWhereInput,
    and: Prisma.AccessionSampleWhereInput[],
  ): void {
    switch (mode) {
      case 'Home Visit':
        order.diagnostics = { is: { isHomeVisit: true } };
        break;
      case 'Emergency':
        order.isUrgentBill = true;
        break;
      case 'Referral':
        order.OR = [
          { internalReferralId: { not: null } },
          { externalReferralId: { not: null } },
        ];
        break;
      case 'Outsource':
        and.push({ status: SampleStatus.OUTSOURCED });
        break;
      case 'Walk-in':
        order.diagnostics = { is: { isHomeVisit: false } };
        break;
      default:
        break;
    }
  }

  /**
   * The active branch's TAT thresholds, resolved from its `AccessionSetting`
   * (falling back to the module defaults when the branch has none).
   */
  private async tatThresholds(
    tenantId: string,
    branchId: string | null,
  ): Promise<AccessionSettingsMap['tat']> {
    return (await this.settings.resolve(tenantId, branchId)).tat;
  }

  /** System barcode for a sample: `ACC-00001` → `BAR-00001-A` (PDF §A.10.2). */
  private deriveBarcode(accessionNo: string): string {
    return `BAR-${accessionNo.replace(/^ACC-/, '')}-A`;
  }

  /** Read the `samples` array from a branch lab test's config snapshot (safe). */
  private samplesOf(snapshot: Prisma.JsonValue | undefined): LabTestSample[] {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return [];
    }
    const samples = (snapshot as Partial<BranchLabTestConfigSnapshot>).samples;
    return Array.isArray(samples) ? samples : [];
  }

  /** Add an order item to its sample group (keyed by container + sample type). */
  private addToGroup(
    groups: Map<string, SampleGroup>,
    sampleType: string | null,
    containerType: ContainerType | null,
    orderItemId: string,
    testName: string | null,
  ): void {
    const key = `${containerType ?? ''}|${sampleType ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        sampleType,
        containerType,
        label: sampleType ?? containerType ?? 'General',
        items: new Map(),
      };
      groups.set(key, group);
    }
    if (!group.items.has(orderItemId)) {
      group.items.set(orderItemId, testName);
    }
  }

  /**
   * Translate a Prisma unique-constraint violation (per-tenant accession number /
   * barcode) into a typed, retryable 409.
   */
  private rethrowConflict(e: unknown): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new AccessionNumberConflictException('');
    }
  }
}
