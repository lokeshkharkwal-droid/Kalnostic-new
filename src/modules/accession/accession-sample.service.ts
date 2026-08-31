import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AccessionGroupingMode,
  OrderSample,
  OrderSampleStatusHistory,
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
  FORCE_TARGET,
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
  OrderSampleListItem,
  OrderSampleDetail,
  OrderSampleWithRelations,
  AccessionSummary,
  OrderSampleGroup,
  GroupedSampleItem,
  SampleActionScope,
  AccessionGroupType,
} from './entities/accession-sample.entity';
import {
  AccessionNumberConflictException,
  OrderSampleNotFoundException,
  InvalidSampleTransitionException,
  NoActiveLabelTemplateException,
  AmbiguousLabelTemplateException,
} from './exceptions/accession.exceptions';

/** Resolved display fields attached to a history row for the Audit Trail UI. */
export interface AccessionHistoryActor {
  actorName: string | null;
  actorRole: string | null;
}

/**
 * A single resolved (test × required sample) unit accumulated while generating an
 * order's samples — one `OrderSample` row is created per unit. A `sample` of null
 * is a test/item that resolved no `LabTestSample` (e.g. a `direct` free-text
 * item); such units are skipped since `labTestSampleId` is mandatory.
 */
interface SampleUnit {
  orderItemId: string;
  labTestId: string | null;
  testName: string | null;
  departmentId: string | null;
  sample: LabTestSample | null;
}

/** The scalar field writes + optional history reason an action applies. */
interface ActionPatch {
  data: Prisma.OrderSampleUpdateInput;
  reason?: string;
}

/** History note/attachment carried by every action modal (PDF §A.10). */
interface ActionNote {
  notes?: string;
  attachmentUrl?: string;
  /**
   * When true (group actions — "send all + skip invalid"), a bulk transition
   * silently skips samples not in a legal state for the action instead of
   * failing the whole request. Omitted/false = strict (single-item + normal
   * multi-select bulk), preserving all-or-nothing behavior.
   */
  skipInvalid?: boolean;
  /**
   * When true (group status actions — "direct status override"), the action is
   * applied to the sample **regardless of its current status**: the transition
   * legality check is skipped and the sample is set to the action's fixed
   * `FORCE_TARGET` status. `retrieve` is never forced (no forced target).
   */
  force?: boolean;
}

/**
 * Order samples — the core per-(test × sample) entity of the accession module.
 * Tenant-scoped (RLS) + branch-level (CLAUDE.md §4.5/§4.7).
 *
 * Owns: (a) generating a diagnostic order's samples when it is confirmed
 * (`generateForOrderInTx`, called by `OrderService`); (b) the accession list,
 * Sample Overview, Sample History and summary (status tabs + TAT bar) reads; and
 * (c) the PDF §A.9 sample state machine — every action (`collect`/`accept`/… and
 * the transfer entry points) validates the transition, moves `status`, records
 * `previousStatus` for the universal Retrieve/undo, and appends an immutable
 * `OrderSampleStatusHistory` row, all in one `withTenant` transaction. Each action
 * has a single-item and a bulk (`ids[]`) variant looping inside one transaction
 * (PDF §A.11). Reads always filter `{ tenantId, deletedAt: null }`.
 */
@Injectable()
export class OrderSampleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AccessionSettingsService,
    private readonly labReportService: LabReportService,
    private readonly pdfReportTemplateService: PdfReportTemplateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Sample generation (order → accession) ─────────────────────────────────

  /**
   * Generate the order samples for an order inside an existing (already
   * tenant-scoped) transaction. Produces **one `OrderSample` row per (test ×
   * required sample)**: every ordered individual test contributes one row per
   * `LabTestSample` it requires, and every lab panel is expanded into its
   * constituent tests (via `BranchLabPanelTest`) which each contribute the same
   * way. Each row carries `labTestSampleId` (→ `lab_test_samples`) and the test's
   * `departmentId`, is linked to its originating order item via `OrderSampleTest`,
   * and is seeded with an initial `OrderSampleStatusHistory` row (status `NEW`).
   * A test/item that resolves no sample (e.g. a `direct` free-text line) is
   * skipped, since `labTestSampleId` is mandatory — the lab-test module enforces
   * that every real test has at least one `LabTestSample`. Idempotent per order:
   * skips generation if the order already has samples.
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
    const existing = await tx.orderSample.count({
      where: { orderId, tenantId, deletedAt: null },
    });
    if (existing > 0) return;

    const items = await tx.orderItem.findMany({
      where: { orderId, tenantId, deletedAt: null },
      include: { branchLabTest: true, branchLabPanel: true },
    });
    if (items.length === 0) return;

    // Flatten the order into (test × sample) units — panels expanded to tests.
    const units: SampleUnit[] = [];
    for (const item of items) {
      if (item.branchLabTest) {
        await this.collectTestUnits(
          tx,
          tenantId,
          item.id,
          item.branchLabTest,
          units,
        );
      } else if (item.branchLabPanel) {
        const tests = await this.panelConstituentTests(
          tx,
          tenantId,
          item.branchLabPanel.id,
        );
        for (const test of tests) {
          await this.collectTestUnits(tx, tenantId, item.id, test, units);
        }
      }
      // `direct` free-text items resolve no LabTestSample and are skipped.
    }

    for (const unit of units) {
      if (!unit.sample) continue; // labTestSampleId is mandatory
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: { accessionCounter: { increment: 1 } },
        select: { accessionCounter: true },
      });
      const accessionNo = `ACC-${String(tenant.accessionCounter).padStart(5, '0')}`;
      await tx.orderSample.create({
        data: {
          tenantId,
          branchId,
          orderId,
          labTestId: unit.labTestId,
          labTestSampleId: unit.sample.id,
          departmentId: unit.departmentId,
          accessionNo,
          sampleType: unit.sample.sampleType,
          containerType: unit.sample.containerType,
          sampleGroupLabel:
            unit.sample.sampleName ??
            unit.sample.sampleType ??
            unit.sample.containerType ??
            'General',
          status: SampleStatus.NEW,
          originBranchId: branchId,
          processingBranchId: branchId,
          createdBy: personId,
          updatedBy: personId,
          tests: {
            create: {
              tenantId,
              branchId,
              orderItemId: unit.orderItemId,
              labTestId: unit.labTestId,
              testName: unit.testName,
            },
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
    const samples = await tx.orderSample.findMany({
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
      const siblings = await tx.orderSampleTest.findMany({
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
  ): Promise<PaginatedResult<OrderSampleListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const nowMs = Date.now();
    const tat = await this.tatThresholds(tenantId, branchId);

    const where = this.buildSampleWhere(tenantId, branchId, query, tat, nowMs);

    // withTenant (not array-form $transaction) so the RLS tenant GUC is set for
    // both queries — array-form bypasses the per-op RLS extension and returns
    // zero rows under enforced RLS (see PrismaService).
    const [data, total] = await this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.orderSample.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: SAMPLE_LIST_INCLUDE,
      });
      const count = await tx.orderSample.count({ where });
      return [rows, count] as const;
    });
    const items: OrderSampleListItem[] = data.map((row) => ({
      ...row,
      tatStatus: deriveTatStatus(row.createdAt, row.status, tat, nowMs),
    }));
    return paginated(items, total, page, limit);
  }

  /**
   * Grouped in-house list — the same filters as `findAll`, but records are
   * grouped and **paginated by group** (10 groups/page) per the tenant's
   * `AccessionGroupingMode` (Grouping Settings). The grouping/pagination unit is
   * the order (`SAMPLE_NAME`/`ORDER`) or the department (`DEPARTMENT`/
   * `DEPARTMENT_SAMPLE_NAME`), so each top-level group renders whole. Each group
   * carries the `actionScope` its action button applies to and the flat
   * `sampleIds` that button targets; `DEPARTMENT_SAMPLE_NAME` additionally nests
   * `subGroups` by sample name. Reuses `buildSampleWhere` + `deriveTatStatus`.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param query pagination + the §A.3 filters (status tab, search, dates, …)
   */
  async findAllGrouped(
    tenantId: string,
    branchId: string | null,
    query: ListSamplesDto,
  ): Promise<PaginatedResult<OrderSampleGroup>> {
    const page = query.page ?? 1;
    const limit = 10; // group-aware pagination: 10 groups per page
    const nowMs = Date.now();
    const tat = await this.tatThresholds(tenantId, branchId);
    const where = this.buildSampleWhere(tenantId, branchId, query, tat, nowMs);

    const { keys, total, rows, mode } = await this.prisma.withTenant(
      tenantId,
      async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { groupingMode: true },
        });
        const mode =
          tenant?.groupingMode ?? AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME;
        const byDepartment =
          mode === AccessionGroupingMode.DEPARTMENT ||
          mode === AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME;

        // Page of group keys (ordered by most-recent sample) + total group count.
        const [pageGroups, allGroups] = byDepartment
          ? await Promise.all([
              tx.orderSample.groupBy({
                by: ['departmentId'],
                where,
                orderBy: { _max: { createdAt: 'desc' } },
                skip: (page - 1) * limit,
                take: limit,
              }),
              tx.orderSample.groupBy({ by: ['departmentId'], where }),
            ])
          : await Promise.all([
              tx.orderSample.groupBy({
                by: ['orderId'],
                where,
                orderBy: { _max: { createdAt: 'desc' } },
                skip: (page - 1) * limit,
                take: limit,
              }),
              tx.orderSample.groupBy({ by: ['orderId'], where }),
            ]);
        const keys: (string | null)[] = byDepartment
          ? (pageGroups as { departmentId: string | null }[]).map(
              (g) => g.departmentId,
            )
          : (pageGroups as { orderId: string }[]).map((g) => g.orderId);

        // Fetch all samples belonging to this page's groups.
        const nonNull = keys.filter((k): k is string => k !== null);
        const keyFilter: Prisma.OrderSampleWhereInput = byDepartment
          ? keys.includes(null)
            ? {
                OR: [{ departmentId: { in: nonNull } }, { departmentId: null }],
              }
            : { departmentId: { in: nonNull } }
          : { orderId: { in: nonNull } };
        const rows = await tx.orderSample.findMany({
          where: { ...where, ...keyFilter },
          include: SAMPLE_LIST_INCLUDE,
          orderBy: { createdAt: 'desc' },
        });
        return { keys, total: allGroups.length, rows, mode };
      },
    );

    const byDepartment =
      mode === AccessionGroupingMode.DEPARTMENT ||
      mode === AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME;
    const groupType: AccessionGroupType = byDepartment ? 'DEPARTMENT' : 'ORDER';
    const actionScope: SampleActionScope =
      mode === AccessionGroupingMode.ORDER
        ? 'ORDER'
        : mode === AccessionGroupingMode.DEPARTMENT
          ? 'DEPARTMENT'
          : mode === AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME
            ? 'DEPARTMENT_SAMPLE'
            : 'SAMPLE';

    // Batch-resolve department names for the rows in view.
    const deptIds = [
      ...new Set(
        rows.map((r) => r.departmentId).filter((v): v is string => !!v),
      ),
    ];
    const deptNameById = new Map<string, string>();
    if (deptIds.length > 0) {
      const depts = await this.prisma.withTenant(tenantId, (tx) =>
        tx.department.findMany({
          where: { id: { in: deptIds }, tenantId, deletedAt: null },
          select: { id: true, name: true },
        }),
      );
      depts.forEach((d) => deptNameById.set(d.id, d.name));
    }

    const toItem = (row: (typeof rows)[number]): GroupedSampleItem => ({
      ...row,
      tatStatus: deriveTatStatus(row.createdAt, row.status, tat, nowMs),
      departmentName: row.departmentId
        ? (deptNameById.get(row.departmentId) ?? null)
        : null,
    });

    // Assemble groups in the paged-key order.
    const groups: OrderSampleGroup[] = [];
    for (const key of keys) {
      const groupRows = rows.filter((r) =>
        byDepartment ? r.departmentId === key : r.orderId === key,
      );
      if (groupRows.length === 0) continue;
      const items = groupRows.map(toItem);
      const group: OrderSampleGroup = {
        groupKey: key,
        groupType,
        actionScope,
        order: byDepartment ? null : (groupRows[0]?.order ?? null),
        department: byDepartment
          ? {
              id: key,
              name: key ? (deptNameById.get(key) ?? key) : 'Unassigned',
            }
          : null,
        sampleIds: items.map((i) => i.id),
        samples: items,
        subGroups: null,
      };
      if (mode === AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME) {
        const bySample = new Map<string, GroupedSampleItem[]>();
        for (const it of items) {
          const k = it.sampleGroupLabel ?? 'General';
          const arr = bySample.get(k);
          if (arr) arr.push(it);
          else bySample.set(k, [it]);
        }
        group.subGroups = [...bySample.entries()].map(
          ([sampleKey, samples]) => ({
            sampleKey,
            sampleLabel: sampleKey,
            sampleIds: samples.map((s) => s.id),
            samples,
          }),
        );
      }
      groups.push(group);
    }

    return paginated(groups, total, page, limit);
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
    const where: Prisma.OrderSampleWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };
    const grouped = await this.prisma.orderSample.groupBy({
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
    const rows = await this.prisma.orderSample.findMany({
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
   * @throws OrderSampleNotFoundException if missing/soft-deleted/other tenant
   */
  async findById(id: string, tenantId: string): Promise<OrderSampleDetail> {
    const sample = await this.prisma.orderSample.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: SAMPLE_INCLUDE,
    });
    if (!sample) {
      throw new OrderSampleNotFoundException(id);
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
    sample: OrderSampleWithRelations,
    tenantId: string,
  ): Promise<OrderSampleDetail> {
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
   * @throws OrderSampleNotFoundException if the sample is missing
   */
  async findHistory(
    id: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<Array<OrderSampleStatusHistory & AccessionHistoryActor>> {
    await this.findById(id, tenantId);
    const rows = await this.prisma.orderSampleStatusHistory.findMany({
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
    rows: OrderSampleStatusHistory[],
    tenantId: string,
    branchId: string | null,
  ): Promise<Array<OrderSampleStatusHistory & AccessionHistoryActor>> {
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
   * @throws OrderSampleNotFoundException if missing/soft-deleted
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
   * @throws OrderSampleNotFoundException if any sample id is missing
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
    sample: OrderSampleWithRelations,
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
  private buildLabelContext(sample: OrderSampleWithRelations): GeneratePdfDto {
    return { variables: this.buildLabelVariables(sample) };
  }

  // ── State-machine actions (PDF §A.9/§A.10) ─────────────────────────────────

  /** Collect Sample (§A.10.1) — New/Hold/Repeat → Collected. */
  async collect(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: CollectSampleDto,
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations[]> {
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
  ): Promise<OrderSampleWithRelations> {
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
   * @throws OrderSampleNotFoundException / InvalidSampleTransitionException
   */
  async transitionInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    sampleId: string,
    action: SampleAction,
    build: (sample: OrderSample) => ActionPatch,
    note: ActionNote = {},
  ): Promise<OrderSample> {
    const sample = await tx.orderSample.findFirst({
      where: { id: sampleId, tenantId, deletedAt: null },
    });
    if (!sample) throw new OrderSampleNotFoundException(sampleId);

    // Group status actions force a direct override: the sample is moved to the
    // action's fixed target status regardless of its current status (no legality
    // check). `retrieve` has no forced target, so it keeps its normal behaviour.
    const forced = note.force ? FORCE_TARGET[action] : undefined;
    const toStatus =
      forced ??
      (action === 'retrieve'
        ? (nextSampleStatus('retrieve', sample.status) ?? sample.previousStatus)
        : nextSampleStatus(action, sample.status));
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
    const updated = await tx.orderSample.update({
      where: { id: sample.id },
      data: {
        ...built.data,
        status: toStatus,
        previousStatus: sample.status,
        updatedBy: personId,
      },
    });
    await tx.orderSampleStatusHistory.create({
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
   * @throws OrderSampleNotFoundException / InvalidSampleTransitionException
   * @throws AccessionNumberConflictException on a barcode clash (collect & print)
   */
  private async transitionIds(
    ids: string[],
    tenantId: string,
    personId: string | null,
    action: SampleAction,
    build: (sample: OrderSample) => ActionPatch,
    note: ActionNote = {},
  ): Promise<OrderSampleWithRelations[]> {
    let changed: string[];
    try {
      changed = await this.prisma.withTenant(tenantId, async (tx) => {
        const done: string[] = [];
        for (const id of ids) {
          let updated: OrderSample;
          try {
            updated = await this.transitionInTx(
              tx,
              tenantId,
              personId,
              id,
              action,
              build,
              note,
            );
          } catch (e) {
            // Group actions ("send all + skip invalid"): skip a sample that is
            // not in a legal state for this action; surface everything else.
            if (
              note.skipInvalid &&
              e instanceof InvalidSampleTransitionException
            ) {
              continue;
            }
            throw e;
          }
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
   * HbA1c), via the `OrderSampleTest` junction, so this creates one report
   * per linked item, not one per sample. Runs inside the caller's transaction
   * so report creation and the sample's own status change commit atomically.
   * Idempotent (delegates to `ensureCreatedForAcceptedItem`, a no-op if a
   * report already exists for that item).
   *
   * Public (not private) so `SampleTransferService.cloneIntoDestination` —
   * the other real path into `ACCEPTED` (RULE 1, internal transfer accept,
   * which creates a new `OrderSample` directly rather than transitioning
   * an existing one through `transitionIds`) — can call it too, keeping one
   * single place that knows how to create LabReports for an accepted sample.
   */
  async ensureLabReportsForAcceptedSample(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sampleId: string,
    acceptedBy: string | null,
  ): Promise<void> {
    const sampleTests = await tx.orderSampleTest.findMany({
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
   * @throws OrderSampleNotFoundException / AccessionNumberConflictException
   */
  private async mutateIds(
    ids: string[],
    tenantId: string,
    personId: string | null,
    action: string,
    build: (sample: OrderSample) => ActionPatch,
    note: ActionNote,
  ): Promise<OrderSampleWithRelations[]> {
    let changed: string[];
    try {
      changed = await this.prisma.withTenant(tenantId, async (tx) => {
        const done: string[] = [];
        for (const id of ids) {
          const sample = await tx.orderSample.findFirst({
            where: { id, tenantId, deletedAt: null },
          });
          if (!sample) throw new OrderSampleNotFoundException(id);
          const built = build(sample);
          await tx.orderSample.update({
            where: { id: sample.id },
            data: { ...built.data, updatedBy: personId },
          });
          await tx.orderSampleStatusHistory.create({
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
  ): Prisma.OrderSampleWhereInput {
    const where: Prisma.OrderSampleWhereInput = {
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

    const and: Prisma.OrderSampleWhereInput[] = [];
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
    and: Prisma.OrderSampleWhereInput[],
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
   * Sample/container requirements for a branch lab test. Reads the LIVE
   * `LabTestSample` rows of the source Master Data test (via `sourceLabTestId`)
   * so a sample/container configured — or edited — AFTER the branch pricing-list
   * copies were created still reaches accession. The per-list `configSnapshot`
   * is a frozen point-in-time copy that is NOT refreshed when Master Data
   * samples change, so it's only used as a fallback (e.g. a SITE_ADMIN template
   * whose sample config lives solely in the snapshot, or a deleted source).
   */
  private async samplesForTest(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sourceLabTestId: string | null,
    snapshot: Prisma.JsonValue | undefined,
  ): Promise<LabTestSample[]> {
    if (sourceLabTestId) {
      const live = await tx.labTestSample.findMany({
        where: { labTestId: sourceLabTestId, tenantId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      if (live.length > 0) return live;
    }
    return this.samplesOf(snapshot);
  }

  /**
   * Resolve every (test × required sample) unit a single branch lab test
   * contributes and append them to `units`. Reads the test's live/snapshot
   * `LabTestSample` rows (see `samplesForTest`) — one unit per sample — and
   * resolves the test's department once. A test with no resolvable sample yields
   * a single sample-less unit (skipped at creation, since `labTestSampleId` is
   * mandatory). `labTestId` is the source Master Data test id (the same test that
   * owns the `LabTestSample` rows).
   */
  private async collectTestUnits(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderItemId: string,
    test: {
      testName: string | null;
      departmentId: string | null;
      sourceLabTestId: string | null;
      configSnapshot: Prisma.JsonValue;
    },
    units: SampleUnit[],
  ): Promise<void> {
    const departmentId = await this.resolveDepartmentId(
      tx,
      tenantId,
      test.departmentId,
      test.sourceLabTestId,
    );
    const labTestId = test.sourceLabTestId ?? null;
    const samples = await this.samplesForTest(
      tx,
      tenantId,
      test.sourceLabTestId,
      test.configSnapshot,
    );
    if (samples.length === 0) {
      units.push({
        orderItemId,
        labTestId,
        testName: test.testName,
        departmentId,
        sample: null,
      });
      return;
    }
    for (const sample of samples) {
      units.push({
        orderItemId,
        labTestId,
        testName: test.testName,
        departmentId,
        sample,
      });
    }
  }

  /**
   * The constituent branch lab tests of a panel (via the `BranchLabPanelTest`
   * junction — a logical ref, so the tests are fetched separately), carrying the
   * fields needed to resolve each one's samples + department. A panel order item
   * has no `branchLabTest` of its own, so this is how it's expanded into tests.
   */
  private async panelConstituentTests(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchLabPanelId: string,
  ): Promise<
    {
      testName: string | null;
      departmentId: string | null;
      sourceLabTestId: string | null;
      configSnapshot: Prisma.JsonValue;
    }[]
  > {
    const panelTests = await tx.branchLabPanelTest.findMany({
      where: { tenantId, branchLabPanelId, deletedAt: null },
      select: { branchLabTestId: true },
    });
    if (panelTests.length === 0) return [];
    return tx.branchLabTest.findMany({
      where: {
        id: { in: panelTests.map((pt) => pt.branchLabTestId) },
        tenantId,
        deletedAt: null,
      },
      select: {
        testName: true,
        departmentId: true,
        sourceLabTestId: true,
        configSnapshot: true,
      },
    });
  }

  /**
   * Resolve a test's department id: prefer the branch test's own logical
   * `departmentId`, falling back to its source Master Data test's `departmentId`.
   */
  private async resolveDepartmentId(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchDepartmentId: string | null,
    sourceLabTestId: string | null,
  ): Promise<string | null> {
    if (branchDepartmentId) return branchDepartmentId;
    if (sourceLabTestId) {
      const src = await tx.labTest.findFirst({
        where: { id: sourceLabTestId, tenantId, deletedAt: null },
        select: { departmentId: true },
      });
      return src?.departmentId ?? null;
    }
    return null;
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
