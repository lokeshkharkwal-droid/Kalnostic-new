import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import type { GeneratePdfDto } from '../pdf-report-template/dto/generate-pdf.dto';
import type { PdfReportTemplateType } from '../pdf-report-template/constants/pdf-report-template-types.constant';
import { BranchLabTestConfigSnapshot } from '../branch-lab-test/entities/branch-lab-test.entity';
import {
  SampleAction,
  nextSampleStatus,
  COLLECTABLE_SAMPLE_STATUSES,
} from './constants/sample-transitions.constant';
import {
  TERMINAL_SAMPLE_STATUSES,
  TatStatus,
  TatThresholds,
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
  AccessionSampleDetail,
  AccessionSampleWithRelations,
  AccessionSummary,
} from './entities/accession-sample.entity';
import {
  AccessionNumberConflictException,
  AccessionSampleNotFoundException,
  InvalidSampleTransitionException,
  NoActiveLabelTemplateException,
  AmbiguousLabelTemplateException,
} from './exceptions/accession.exceptions';

/** Resolved display fields attached to a history row for the Audit Trail UI. */
export interface AccessionHistoryActor {
  actorName: string | null;
  actorRole: string | null;
}

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
    private readonly labReportService: LabReportService,
    private readonly pdfReportTemplateService: PdfReportTemplateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Sample generation (order → accession) ─────────────────────────────────

  /**
   * Generate the accession samples for an order inside an existing (already
   * tenant-scoped) transaction. Groups the order's items by their required
   * sample (container + sample type). A single-test item's requirement comes
   * from its own `BranchLabTest.configSnapshot.samples`; a panel item has no
   * `branchLabTest` of its own, so its requirement is the union of its
   * constituent tests' `configSnapshot.samples` (see `samplesOfPanel`). Creates
   * one `AccessionSample` (status `NEW`) per group, each linked to the
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
      include: { branchLabTest: true, branchLabPanel: true },
    });
    if (items.length === 0) return;

    const groups = new Map<string, SampleGroup>();
    for (const item of items) {
      const testName =
        item.branchLabTest?.testName ??
        item.branchLabPanel?.panelName ??
        item.direct ??
        null;
      const samples = item.branchLabTest
        ? this.samplesOf(item.branchLabTest.configSnapshot)
        : item.branchLabPanel
          ? await this.samplesOfPanel(tx, tenantId, item.branchLabPanel.id)
          : [];
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

  /**
   * Collect the accession sample(s) carrying a given order item, inside an
   * existing (already tenant-scoped) transaction — the bridge that lets the
   * Order Overview "Collect / Collect & Print" action drive the real sample
   * lifecycle (not just `OrderItem.collectedAt`). For each sample serving the
   * item that is still in a collectable status (`NEW`/`HOLD`/`REPEAT`), applies
   * the §A.9 `collect` transition → `COLLECTED` (stamping `collectedAt`/
   * `collectedBy`/`tubeType`, and a barcode when `print` is set, exactly like
   * `collect`/`collectAndPrint`) and appends a history row. Because a sample is
   * one physical tube shared by several tests, all sibling order items on a
   * transitioned sample are stamped collected too (a tube is drawn once).
   * Idempotent: samples already past `NEW`/`HOLD`/`REPEAT` are skipped, so a
   * repeat click is a no-op. Safe no-op when the order has no samples yet (e.g.
   * a DRAFT / non-diagnostic order): nothing to transition.
   * @param tx active Prisma transaction client (already tenant-scoped)
   * @param tenantId tenant scope
   * @param personId acting person id (recorded as `collectedBy`/`changedBy`)
   * @param orderItemId the order item whose sample(s) to collect
   * @param opts `print` also assigns a barcode when the sample lacks one
   */
  async collectForOrderItemInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    orderItemId: string,
    opts: { print: boolean },
  ): Promise<void> {
    const samples = await tx.accessionSample.findMany({
      where: {
        tenantId,
        deletedAt: null,
        tests: { some: { orderItemId, tenantId, deletedAt: null } },
      },
      select: { id: true, status: true },
    });
    const collectable = samples.filter((s) =>
      COLLECTABLE_SAMPLE_STATUSES.includes(s.status),
    );
    if (collectable.length === 0) return;

    const now = new Date();
    for (const s of collectable) {
      await this.transitionInTx(
        tx,
        tenantId,
        personId,
        s.id,
        'collect',
        (sample) => ({
          data: {
            collectedAt: now,
            collectedBy: personId,
            tubeType:
              sample.tubeType ??
              sample.containerType ??
              sample.sampleType ??
              undefined,
            ...(opts.print
              ? {
                  barcode:
                    sample.barcode ?? this.deriveBarcode(sample.accessionNo),
                }
              : {}),
          },
        }),
      );

      // A tube is drawn once → every test it carries is collected together.
      // Stamp all sibling order items on this sample (preserve already-set
      // timestamps via `collectedAt: null`).
      const siblings = await tx.accessionSampleTest.findMany({
        where: { sampleId: s.id, tenantId, deletedAt: null },
        select: { orderItemId: true },
      });
      const siblingIds = siblings.map((t) => t.orderItemId);
      if (siblingIds.length > 0) {
        await tx.orderItem.updateMany({
          where: {
            id: { in: siblingIds },
            tenantId,
            deletedAt: null,
            collectedAt: null,
          },
          data: { collectedAt: now, collectedBy: personId },
        });
      }
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

    // withTenant (not array-form $transaction) so the RLS tenant GUC is set for
    // both queries — array-form bypasses the per-op RLS extension and returns
    // zero rows under enforced RLS (see PrismaService).
    const [data, total] = await this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.accessionSample.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: SAMPLE_LIST_INCLUDE,
      });
      const count = await tx.accessionSample.count({ where });
      return [rows, count] as const;
    });
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
  async findById(id: string, tenantId: string): Promise<AccessionSampleDetail> {
    const sample = await this.prisma.accessionSample.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: SAMPLE_INCLUDE,
    });
    if (!sample) {
      throw new AccessionSampleNotFoundException(id);
    }
    return this.withDepartments(sample, tenantId);
  }

  /**
   * Enrich a composed sample with resolved department names. The classification
   * lives on `BranchLabTest`/`BranchLabPanel` as a logical `departmentId` (no
   * Prisma relation), so we collect the ids off each test's order item and
   * resolve their names in one tenant-scoped `Department` query. Each test gets a
   * `department` name; the sample gets a `departmentLabel` = distinct names
   * joined with ", " (null when none resolve).
   * @param sample the composed sample (SAMPLE_INCLUDE payload)
   * @param tenantId tenant scope for the Department lookup (RLS-guarded)
   * @returns the sample enriched with `departmentLabel` + per-test `department`
   */
  private async withDepartments(
    sample: AccessionSampleWithRelations,
    tenantId: string,
  ): Promise<AccessionSampleDetail> {
    const deptIdByTest = new Map<string, string | null>();
    for (const t of sample.tests) {
      const deptId =
        t.orderItem?.branchLabTest?.departmentId ??
        t.orderItem?.branchLabPanel?.departmentId ??
        null;
      deptIdByTest.set(t.id, deptId);
    }

    const deptIds = [
      ...new Set([...deptIdByTest.values()].filter((v): v is string => !!v)),
    ];
    const nameById = new Map<string, string>();
    if (deptIds.length > 0) {
      const depts = await this.prisma.withTenant(tenantId, (tx) =>
        tx.department.findMany({
          where: { id: { in: deptIds }, tenantId, deletedAt: null },
          select: { id: true, name: true },
        }),
      );
      depts.forEach((d) => nameById.set(d.id, d.name));
    }

    const tests = sample.tests.map((t) => {
      const deptId = deptIdByTest.get(t.id) ?? null;
      return {
        ...t,
        department: deptId ? (nameById.get(deptId) ?? null) : null,
        // Flattened from t.orderItem (same convention as `department` above)
        // so the frontend doesn't need to know about the raw order-item
        // relation shape — just the order's own assigned outsource center,
        // if any (null = in-house / none chosen at order time).
        outsourceCenterId: t.orderItem?.outsourceCenterId ?? null,
        outsourceCenter: t.orderItem?.outsourceCenter ?? null,
      };
    });
    const distinct = [
      ...new Set(
        tests.map((t) => t.department).filter((v): v is string => !!v),
      ),
    ];

    return {
      ...sample,
      tests,
      departmentLabel: distinct.length > 0 ? distinct.join(', ') : null,
    };
  }

  /**
   * Return a sample's status-history log (newest first), tenant-scoped
   * (Sample History / Audit Trail panel — PDF §A.10.5). Only rows where the
   * sample's status actually moved from one real status to another are
   * returned (`fromStatus` non-null and different from `toStatus`) — the
   * system-written `generate` row (sample created from the order, `fromStatus
   * = null`, no prior status to move FROM) and no-status-change actions
   * (`assign-barcode`, `update` notes, both written with `fromStatus ===
   * toStatus`) are real audit facts kept in the table, but aren't lifecycle
   * movement, so a sample still sitting at NEW with nothing done to it yet
   * correctly has an empty trail.
   * @param id sample id
   * @param tenantId tenant scope
   * @throws AccessionSampleNotFoundException if the sample is missing
   */
  async findHistory(
    id: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<Array<AccessionStatusHistory & AccessionHistoryActor>> {
    await this.findById(id, tenantId);
    const rows = await this.prisma.accessionStatusHistory.findMany({
      where: { sampleId: id, tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const movements = rows.filter(
      (r) => r.fromStatus !== null && r.fromStatus !== r.toStatus,
    );
    return this.enrichHistoryActors(movements, tenantId, branchId);
  }

  /**
   * Attach each `changedBy` actor's human name and current role label to
   * history rows. `changedBy` is a logical reference to `Person.id` (no
   * Prisma relation — same deliberate pattern as `LabReportHistory.actorId`:
   * an audit trail must survive independent of the referenced person). The
   * role shown is the person's CURRENT role at this branch (via
   * `UserBranchProfile` → `AuthRole`, the same join `LabReportDirectoryService`
   * uses to validate technician roles) — not a snapshot of the role held at
   * the time of the action, since that isn't captured anywhere in this
   * codebase today. Falls back to `null` for either field rather than
   * guessing, e.g. if the person has no active profile at this branch anymore.
   */
  private async enrichHistoryActors(
    rows: AccessionStatusHistory[],
    tenantId: string,
    branchId: string | null,
  ): Promise<Array<AccessionStatusHistory & AccessionHistoryActor>> {
    const actorIds = [
      ...new Set(
        rows.map((r) => r.changedBy).filter((id): id is string => Boolean(id)),
      ),
    ];
    if (actorIds.length === 0) {
      return rows.map((r) => ({ ...r, actorName: null, actorRole: null }));
    }

    const [persons, profiles] = await Promise.all([
      this.prisma.person.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, firstName: true, middleName: true, lastName: true },
      }),
      branchId
        ? this.prisma.userBranchProfile.findMany({
            where: {
              tenantId,
              branchId,
              personId: { in: actorIds },
              deletedAt: null,
            },
            select: { personId: true, authRole: { select: { name: true } } },
          })
        : Promise.resolve([]),
    ]);

    const nameById = new Map(
      persons.map((p) => [
        p.id,
        [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' '),
      ]),
    );
    const roleById = new Map(
      profiles.map((p) => [p.personId, p.authRole.name]),
    );

    return rows.map((r) => ({
      ...r,
      actorName: r.changedBy ? (nameById.get(r.changedBy) ?? null) : null,
      actorRole: r.changedBy ? (roleById.get(r.changedBy) ?? null) : null,
    }));
  }

  // ── Print Label (in-house/referral/external-referral orders) ───────────────

  /**
   * Print one sample's barcode label ("Label Print" checklist item).
   * Resolves the tenant's active `order_label_print` template (or the
   * caller's explicit `templateId`) and renders it with this sample's real
   * data via `PdfReportTemplateService.generatePdf`.
   * @throws AccessionSampleNotFoundException if missing/soft-deleted
   * @throws NoActiveLabelTemplateException if no active template exists
   * @throws AmbiguousLabelTemplateException if multiple exist and no
   * `templateId` was given
   */
  async printLabel(
    id: string,
    tenantId: string,
    templateId?: string,
  ): Promise<Buffer> {
    const sample = await this.findById(id, tenantId);
    const context = this.buildLabelContext(sample);
    const resolvedTemplateId =
      templateId ??
      (await this.resolveLabelTemplateId(tenantId, 'order_label_print'));
    return this.pdfReportTemplateService.generatePdf(
      resolvedTemplateId,
      tenantId,
      context,
    );
  }

  /**
   * Print many samples' labels into one PDF ("Multiple Label Print" checklist
   * item). Renders ONE `multiple_order_label_print`-type template ONCE, with
   * every sample folded into a single repeating `sections.labels` row-set —
   * same flattened-section approach as `LabReportService.printAllForOrder`
   * (the renderer only expands one level of `{{#each}}`).
   * @throws AccessionSampleNotFoundException if any sample id is missing
   * @throws NoActiveLabelTemplateException if no active template exists
   * @throws AmbiguousLabelTemplateException if multiple exist and no
   * `templateId` was given
   */
  async printLabels(
    ids: string[],
    tenantId: string,
    templateId?: string,
  ): Promise<Buffer> {
    const samples = await Promise.all(
      ids.map((id) => this.findById(id, tenantId)),
    );
    const labels = samples.map((s) => this.buildLabelVariables(s));
    const combined: GeneratePdfDto = { sections: { labels } };

    const resolvedTemplateId =
      templateId ??
      (await this.resolveLabelTemplateId(
        tenantId,
        'multiple_order_label_print',
      ));
    return this.pdfReportTemplateService.generatePdf(
      resolvedTemplateId,
      tenantId,
      combined,
    );
  }

  private async resolveLabelTemplateId(
    tenantId: string,
    type: PdfReportTemplateType,
  ): Promise<string> {
    const { data } = await this.pdfReportTemplateService.findAllForTenant(
      tenantId,
      1,
      10,
      { type, status: 'ACTIVE' },
    );
    if (data.length === 0) {
      throw new NoActiveLabelTemplateException(tenantId, type);
    }
    if (data.length > 1) {
      throw new AmbiguousLabelTemplateException(
        tenantId,
        type,
        data.map((t) => t.id),
      );
    }
    return data[0]!.id;
  }

  /** Flat `{variable}` values for one sample's label. */
  private buildLabelVariables(
    sample: AccessionSampleWithRelations,
  ): Record<string, unknown> {
    const patient = sample.order?.patient;
    return {
      accession_no: sample.accessionNo,
      barcode: sample.barcode ?? '',
      patient_name: patient
        ? [patient.firstName, patient.middleName, patient.lastName]
            .filter(Boolean)
            .join(' ')
        : '',
      patient_age: patient?.age ?? '',
      patient_gender: patient?.gender ?? '',
      patient_um_id: patient?.umId ?? '',
      order_code: sample.order?.orderCode ?? '',
      test_names: sample.tests
        .map((t) => t.testName)
        .filter(Boolean)
        .join(', '),
      sample_type: sample.sampleType ?? '',
      container_type: sample.containerType ?? '',
      priority: sample.priority,
      collected_at: sample.collectedAt
        ? sample.collectedAt.toISOString().slice(0, 10)
        : '',
    };
  }

  /** Render context for a single-sample label print. */
  private buildLabelContext(
    sample: AccessionSampleWithRelations,
  ): GeneratePdfDto {
    return { variables: this.buildLabelVariables(sample) };
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
    const samples = await this.transitionIds(
      ids,
      tenantId,
      personId,
      'error',
      () => ({ data: {} }),
      dto,
    );
    // Fire-and-forget: inform the order's referring panel (B2B). Handled by
    // ClinicalEventListener; walk-in orders (no panel) are skipped there.
    this.emitSampleFlagged('accession.sample.error', tenantId, samples);
    return samples;
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
    const samples = await this.transitionIds(
      ids,
      tenantId,
      personId,
      'repeat',
      () => ({ data: {}, reason: dto.repeatReason }),
      dto,
    );
    // Fire-and-forget: inform the order's referring panel (B2B). Handled by
    // ClinicalEventListener; walk-in orders (no panel) are skipped there.
    this.emitSampleFlagged('accession.sample.repeat', tenantId, samples);
    return samples;
  }

  /**
   * Emit a per-sample notification event (`accession.sample.error` /
   * `.repeat`) so the communication module can inform the order's referring
   * panel. Fire-and-forget; one event per affected sample.
   */
  private emitSampleFlagged(
    event: string,
    tenantId: string,
    samples: { id: string; branchId: string | null; orderId: string }[],
  ): void {
    for (const s of samples) {
      void this.eventEmitter.emitAsync(event, {
        tenantId,
        branchId: s.branchId ?? null,
        sampleId: s.id,
        orderId: s.orderId,
      });
    }
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
          if (updated.status === SampleStatus.ACCEPTED) {
            await this.ensureLabReportsForAcceptedSample(
              tx,
              tenantId,
              updated.id,
              personId,
            );
          }
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
   * Real Technician Reporting trigger (see `LabReportService.
   * ensureCreatedForAcceptedItem` doc comment): once a sample transitions to
   * `ACCEPTED`, create a `LabReport` for every `OrderItem` it serves — one
   * sample can carry several order items (e.g. one EDTA tube for both CBC and
   * HbA1c), via the `AccessionSampleTest` junction, so this creates one report
   * per linked item, not one per sample. Runs inside the caller's transaction
   * so report creation and the sample's own status change commit atomically.
   * Idempotent (delegates to `ensureCreatedForAcceptedItem`, a no-op if a
   * report already exists for that item).
   *
   * Public (not private) so `SampleTransferService.cloneIntoDestination` —
   * the other real path into `ACCEPTED` (RULE 1, internal transfer accept,
   * which creates a new `AccessionSample` directly rather than transitioning
   * an existing one through `transitionIds`) — can call it too, keeping one
   * single place that knows how to create LabReports for an accepted sample.
   */
  async ensureLabReportsForAcceptedSample(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sampleId: string,
    acceptedBy: string | null,
  ): Promise<void> {
    const sampleTests = await tx.accessionSampleTest.findMany({
      where: { sampleId, tenantId, deletedAt: null },
      select: { orderItemId: true },
    });
    for (const { orderItemId } of sampleTests) {
      await this.labReportService.ensureCreatedForAcceptedItem(
        tenantId,
        orderItemId,
        tx,
        acceptedBy,
      );
    }
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
    tat: TatThresholds,
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
   * The active branch's TAT thresholds, resolved from its Accession Module
   * Settings (falling back to the module defaults when the branch has none).
   * The settings store `Accession_WarningThresholdMinutes`/
   * `Accession_CriticalThresholdMinutes` as "minutes remaining before the
   * maximum accept time" (per the LIMS Settings doc); `deriveTatStatus`/
   * `tatCreatedAtRange` need ascending absolute elapsed-minute cutoffs, so
   * they're converted here: `warningMinutes = max - warningRemaining`,
   * `criticalMinutes = max - criticalRemaining`, `breachedMinutes = max`
   * (a sample breaches automatically once the maximum accept time elapses).
   */
  private async tatThresholds(
    tenantId: string,
    branchId: string | null,
  ): Promise<TatThresholds> {
    const settings = await this.settings.resolve(tenantId, branchId);
    const max = settings.Accession_MaximumTimeToAcceptSampleMinutes;
    return {
      warningMinutes: Math.max(
        0,
        max - settings.Accession_WarningThresholdMinutes,
      ),
      criticalMinutes: Math.max(
        0,
        max - settings.Accession_CriticalThresholdMinutes,
      ),
      breachedMinutes: max,
    };
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

  /**
   * Sample/container requirements for a panel — the union of its constituent
   * tests' `configSnapshot.samples` (deduped by sample+container type, since
   * a multi-test panel commonly has several tests sharing the same tube).
   * A panel order item has no `branchLabTest` of its own (it's the panel's
   * own row, not one test), so `generateForOrderInTx` couldn't previously see
   * any sample requirement here at all — accession samples for panels always
   * got `sampleType`/`containerType: null` even though the underlying tests'
   * snapshots have this data (same `BranchLabTest` rows a standalone order of
   * the same test would use).
   */
  private async samplesOfPanel(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchLabPanelId: string,
  ): Promise<LabTestSample[]> {
    // `BranchLabPanelTest.branchLabTestId` is a logical ref (no Prisma relation
    // — see the model's doc comment), so the linked tests are fetched separately.
    const panelTests = await tx.branchLabPanelTest.findMany({
      where: { tenantId, branchLabPanelId, deletedAt: null },
      select: { branchLabTestId: true },
    });
    if (panelTests.length === 0) return [];
    const tests = await tx.branchLabTest.findMany({
      where: {
        id: { in: panelTests.map((pt) => pt.branchLabTestId) },
        tenantId,
        deletedAt: null,
      },
      select: { configSnapshot: true },
    });
    const seen = new Set<string>();
    const samples: LabTestSample[] = [];
    for (const test of tests) {
      for (const s of this.samplesOf(test.configSnapshot)) {
        const key = `${s.containerType ?? ''}|${s.sampleType ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        samples.push(s);
      }
    }
    return samples;
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
