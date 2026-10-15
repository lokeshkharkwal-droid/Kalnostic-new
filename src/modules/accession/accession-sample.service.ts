import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AccessionGroupingMode,
  OrderSample,
  OrderSampleStatusHistory,
  LabTestSample,
  OrderStatus,
  Prisma,
  SamplePriority,
  SampleStatus,
  TransferKind,
  TransferStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { PaginatedResult, paginated } from '../../common/dto/response.dto';
import { timestampRange } from '../../common/utils/date-range.util';
import {
  toBranchLocalInstant,
  formatTenantDate,
  formatTenantTime,
  patientSingleUnitAgeDisplay,
} from '../../common/utils';
import { TenantService } from '../tenant/tenant.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
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
  TAT_STATUSES,
  TERMINAL_SAMPLE_STATUSES,
  TatStatus,
  TatThresholds,
  deriveTatStatus,
  tatCreatedAtRange,
} from './constants/tat.constant';
import { CONTAINER_TYPE_LABELS } from './constants/container-type.constants';
import { AccessionSettingsService } from './accession-settings.service';
import { BarcodeService } from './barcode.service';
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
import { RetrieveSampleDto } from './dto/retrieve-sample.dto';
import { AssignBarcodeDto } from './dto/assign-barcode.dto';
import {
  SAMPLE_INCLUDE,
  SAMPLE_LIST_INCLUDE,
  OrderSampleListItem,
  OrderSampleListRow,
  OrderSampleDetail,
  OrderSampleWithRelations,
  AccessionSummary,
  InHouseOrderGroup,
  InHouseSampleGroup,
  GroupedSampleItem,
} from './entities/accession-sample.entity';
import {
  BulkActionResult,
  BulkSkippedItem,
} from './entities/bulk-action-result.entity';
import {
  AccessionNumberConflictException,
  OrderSampleNotFoundException,
  InvalidSampleTransitionException,
  RetrieveBlockedException,
  TransferWrongBranchException,
  SampleOrderCancelledException,
  SampleRepeatBlockedException,
  SampleReturnBlockedException,
  SampleRetrieveBlockedByResultException,
  refusalMessage,
  SampleSentToBranchException,
  SendBlockedException,
  NoActiveLabelTemplateException,
} from './exceptions/accession.exceptions';
import {
  PREVIOUS_HOLDER_MESSAGE,
  isPreviousHolder,
} from './utils/previous-holders.util';
import { PRE_ACCEPT_SAMPLE_STATUSES } from '../lab-report/utils/sent-out-report.util';
import {
  branchMayRead,
  branchesWithStake,
} from './utils/branch-read-scope.util';
import { inLockOrder, inRequestOrder } from './utils/request-order.util';

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
  /**
   * Whether this unit's governing test/panel follows the normal sample workflow.
   * `false` (Sample Flow = No) means the sample is auto-accepted at generation —
   * collection is skipped and the test proceeds straight to the technician.
   */
  sampleFlow: boolean;
}

/**
 * The minimal shape needed to bucket a sample for grouping-aware barcode
 * assignment: its id plus the department + sample-name it belongs to.
 */
interface BarcodeGroupable {
  id: string;
  departmentId: string | null;
  sampleGroupLabel: string | null;
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
  /**
   * Internal, server-only marker: the transition is driven by the system (the
   * receiving branch's Reject/Repeat returning a sent sample to its sender), not
   * by a user action on the sample. It is the only way to move a `SENT_INTERNAL`
   * sample other than Retrieve. Never set from a request DTO.
   */
  system?: boolean;
}

/**
 * The statuses a sample is in while it lives at another branch / partner / center
 * via an open transfer (Send/Forward/Outsource). A local action that moves a sample
 * OUT of one of these (Retrieve / Repeat) is a "recall": its outstanding
 * transfer(s) — and, for an accepted internal transfer, the clone materialised in
 * the receiving branch — must be unwound so no stale record is left cross-branch.
 */
const TRANSFERRED_STATUSES: ReadonlySet<SampleStatus> = new Set([
  SampleStatus.SENT_INTERNAL,
  SampleStatus.FORWARD_EXTERNAL,
  SampleStatus.OUTSOURCED,
]);

/** True while the sample lives at another branch/partner/center (see above). */
function isTransferredStatus(status: SampleStatus): boolean {
  return TRANSFERRED_STATUSES.has(status);
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
    private readonly pdfTemplateConfigService: PdfTemplateConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly tenantService: TenantService,
    private readonly barcodeService: BarcodeService,
    private readonly userDepartmentScope: UserDepartmentScopeService,
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
    await this.buildSamplesForItems(
      tx,
      tenantId,
      branchId,
      personId,
      orderId,
      items,
    );
  }

  /**
   * Build + persist the OrderSample rows (with tests link, NEW history, and
   * grouping-aware barcodes) for a specific set of the order's items, inside an
   * existing tenant-scoped transaction. Shared by first-time generation
   * ({@link generateForOrderInTx}) and update reconcile
   * ({@link reconcileForOrderInTx}).
   * @param tx active Prisma transaction client (already tenant-scoped)
   * @param tenantId tenant scope
   * @param branchId active branch (origin + processing branch; may be null)
   * @param personId acting person id (created/updated/changed by)
   * @param orderId the order these items belong to
   * @param items the order items (with branchLabTest/branchLabPanel included) to expand
   */
  private async buildSamplesForItems(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    orderId: string,
    items: Array<
      Prisma.OrderItemGetPayload<{
        include: { branchLabTest: true; branchLabPanel: true };
      }>
    >,
  ): Promise<void> {
    // Flatten the order into (test × sample) units — panels expanded to tests.
    const units: SampleUnit[] = [];
    for (const item of items) {
      // Bill Only Test/Panel: billed but never enters the lab workflow — generate
      // no samples at all (so it never appears in accession/collection/technician/
      // reporting). The item still counts toward the order's bill. Auto-mark it
      // collected — there is physically nothing to collect — so the Order Overview
      // shows it as Collected rather than stuck Pending. Idempotent (only stamps
      // a not-yet-collected item).
      if (
        item.branchLabTest?.isBillOnlyTest ||
        item.branchLabPanel?.isBillOnlyTest
      ) {
        if (!item.collectedAt) {
          await tx.orderItem.update({
            where: { id: item.id },
            data: { collectedAt: new Date(), collectedBy: personId },
          });
        }
        continue;
      }
      if (item.branchLabTest) {
        await this.collectTestUnits(
          tx,
          tenantId,
          item.id,
          item.branchLabTest,
          units,
          item.branchLabTest.isSampleFlow,
        );
      } else if (item.branchLabPanel) {
        // The panel's own Sample Flow governs all its member-test samples.
        const panelSampleFlow = item.branchLabPanel.isSampleFlow;
        const tests = await this.panelConstituentTests(
          tx,
          tenantId,
          item.branchLabPanel.id,
        );
        for (const test of tests) {
          await this.collectTestUnits(
            tx,
            tenantId,
            item.id,
            test,
            units,
            panelSampleFlow,
          );
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
      // Sample Flow = No: skip collection entirely — the sample is born ACCEPTED
      // so the test proceeds straight to the technician (LabReports created below).
      // Sample Flow = Yes (default): born NEW and follows the normal collect →
      // accept workflow. A barcode is still assigned only on collect, so an
      // auto-accepted sample keeps `barcode = null`.
      const autoAccept = !unit.sampleFlow;
      // Single timestamp for the auto-accept received+accepted pair (mirrors the
      // normal `accept` transition, which stamps both receivedAt and acceptedAt).
      const acceptedNow = autoAccept ? new Date() : null;
      const created = await tx.orderSample.create({
        data: {
          tenantId,
          branchId,
          orderId,
          labTestId: unit.labTestId,
          labTestSampleId: unit.sample.id,
          departmentId: unit.departmentId,
          accessionNo,
          sampleName: unit.sample.sampleName,
          sampleType: unit.sample.sampleType,
          containerType: unit.sample.containerType,
          sampleGroupLabel:
            unit.sample.sampleName ??
            unit.sample.sampleType ??
            unit.sample.containerType ??
            'General',
          status: autoAccept ? SampleStatus.ACCEPTED : SampleStatus.NEW,
          receivedAt: acceptedNow,
          acceptedAt: acceptedNow,
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
              toStatus: autoAccept ? SampleStatus.ACCEPTED : SampleStatus.NEW,
              reason: autoAccept
                ? 'Sample Flow = No: auto-accepted at generation; sample collection skipped'
                : undefined,
              changedBy: personId,
            },
          },
        },
        select: { id: true },
      });
      // Create the LabReport(s) for an auto-accepted sample so it surfaces in the
      // technician worklist — the same path a normal accept takes. The nested
      // `tests.create` above is already persisted, so the OrderSampleTest row
      // this reads exists.
      if (autoAccept) {
        await this.ensureLabReportsForAcceptedSample(
          tx,
          tenantId,
          created.id,
          personId,
        );
      }
    }

    // Barcodes are no longer assigned at order creation — a sample is barcoded
    // only when it is actually collected (see `assignBarcodesOnCollectInTx`,
    // wired into every collect path). Samples are created here with
    // `barcode = null` and get their sequential, grouping-aware barcode at the
    // moment of collection. Sample Flow = No samples skip collection, so they
    // stay `barcode = null`.
  }

  /**
   * The barcode-grouping key for a sample under the tenant's grouping mode —
   * samples sharing a key share one barcode. Mirrors the accession list's
   * `actionScope`: Sample-wise = unique per row; Order-wise = whole order;
   * Department-wise = per department; Dept+Sample = per department + sample name.
   */
  private barcodeGroupKey(
    sample: BarcodeGroupable,
    mode: AccessionGroupingMode,
  ): string {
    switch (mode) {
      case AccessionGroupingMode.ORDER:
        return 'ORDER';
      case AccessionGroupingMode.DEPARTMENT:
        return `DEPT::${sample.departmentId ?? 'none'}`;
      case AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME:
        return `DEPT_SAMPLE::${sample.departmentId ?? 'none'}::${
          sample.sampleGroupLabel ?? 'General'
        }`;
      case AccessionGroupingMode.SAMPLE_NAME:
      default:
        // Sample-wise = a unique barcode per individual sample row.
        return `SAMPLE::${sample.id}`;
    }
  }

  /**
   * Assign a proper sequential sample barcode to each just-collected sample that
   * lacks one, bucketed by the tenant's live grouping mode — the collect-time
   * counterpart of the former creation-time auto-assignment. Samples in the same
   * bucket (same {@link barcodeGroupKey}, scoped to one order) share one barcode:
   * an existing group barcode — from a sibling already collected in the same
   * order + group — is reused (so a partial-group collection stays consistent);
   * otherwise a fresh sequential value is allocated from the branch's Accession
   * Settings counter and its Code 128 image is rendered/uploaded. A per-sample
   * `assign-barcode` history row (no status change) is written. Idempotent —
   * samples that already carry a barcode are skipped. Runs inside the caller's
   * (already tenant-scoped) collect transaction so the barcode and the sample's
   * COLLECTED status commit atomically. A branchless order has no barcode counter,
   * so its samples are left unbarcoded for a later manual Assign Barcode.
   * @param tx active Prisma transaction client (already tenant-scoped)
   * @param tenantId tenant scope
   * @param personId acting person id (recorded as `updatedBy` / `changedBy`)
   * @param sampleIds the just-collected sample ids to barcode
   */
  private async assignBarcodesOnCollectInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    sampleIds: string[],
  ): Promise<void> {
    if (sampleIds.length === 0) return;
    const targets = await tx.orderSample.findMany({
      where: {
        id: { in: sampleIds },
        tenantId,
        deletedAt: null,
        barcode: null,
      },
      select: {
        id: true,
        orderId: true,
        branchId: true,
        departmentId: true,
        sampleGroupLabel: true,
      },
    });
    if (targets.length === 0) return;

    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { groupingMode: true },
    });
    const mode =
      tenant?.groupingMode ?? AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME;

    // Existing group barcodes across the affected orders, so a sibling already
    // collected in the same order + group lends its barcode (partial collection).
    const orderIds = [...new Set(targets.map((t) => t.orderId))];
    const barcoded = await tx.orderSample.findMany({
      where: {
        orderId: { in: orderIds },
        tenantId,
        deletedAt: null,
        barcode: { not: null },
      },
      select: {
        id: true,
        orderId: true,
        departmentId: true,
        sampleGroupLabel: true,
        barcode: true,
        orderIdBarcode: true,
      },
    });
    const existing = new Map<string, { barcode: string; url: string | null }>();
    for (const s of barcoded) {
      if (!s.barcode) continue;
      const key = `${s.orderId}::${this.barcodeGroupKey(s, mode)}`;
      if (!existing.has(key)) {
        existing.set(key, { barcode: s.barcode, url: s.orderIdBarcode });
      }
    }

    // Bucket the unbarcoded targets by order + grouping key.
    const buckets = new Map<
      string,
      { branchId: string | null; ids: string[] }
    >();
    for (const t of targets) {
      const key = `${t.orderId}::${this.barcodeGroupKey(t, mode)}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.ids.push(t.id);
      else buckets.set(key, { branchId: t.branchId, ids: [t.id] });
    }

    for (const [key, bucket] of buckets) {
      // Barcodes live on the branch's Accession Settings counter; a branchless
      // order can't allocate one — leave it for a later manual Assign Barcode.
      if (!bucket.branchId) continue;

      let value: string;
      let url: string | null;
      const reuse = existing.get(key);
      if (reuse) {
        value = reuse.barcode;
        url = reuse.url;
      } else {
        value = await this.barcodeService.allocateNumberInTx(
          tx,
          tenantId,
          bucket.branchId,
        );
        url = await this.barcodeService.generateAndUpload(value, tenantId);
      }

      await tx.orderSample.updateMany({
        where: { id: { in: bucket.ids }, tenantId },
        data: { barcode: value, orderIdBarcode: url, updatedBy: personId },
      });
      for (const id of bucket.ids) {
        await tx.orderSampleStatusHistory.create({
          data: {
            tenantId,
            branchId: bucket.branchId,
            sampleId: id,
            action: 'assign-barcode',
            toStatus: SampleStatus.COLLECTED,
            fromStatus: SampleStatus.COLLECTED,
            changedBy: personId,
          },
        });
      }
    }
  }

  /**
   * Reconcile an order's accession samples with an item-set change made during an
   * order update, inside an existing tenant-scoped transaction. Added items get
   * fresh samples; removed items have their exclusively-linked samples voided
   * (soft-deleted + CANCELLED) while samples shared with a surviving test keep the
   * sample and drop only the removed test's OrderSampleTest link (soft-delete);
   * the removed items' LabReports are soft-deleted. Kept items are untouched.
   * @param tx active Prisma transaction client (already tenant-scoped)
   * @param tenantId tenant scope
   * @param branchId active branch (from JWT profile; may be null)
   * @param personId acting person id (recorded as changedBy / updatedBy)
   * @param orderId the order being updated
   * @param opts.addedItemIds newly created OrderItem ids on this update
   * @param opts.removedItemIds OrderItem ids soft-deleted on this update
   * @param opts.now the update transaction timestamp (single source of truth)
   */
  async reconcileForOrderInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    orderId: string,
    opts: { addedItemIds: string[]; removedItemIds: string[]; now: Date },
  ): Promise<void> {
    const { addedItemIds, removedItemIds, now } = opts;

    if (removedItemIds.length > 0) {
      const removedSet = new Set(removedItemIds);

      // Find all active samples for this order that are linked to at least one
      // removed item — load their active test links so we can classify them.
      const samples = await tx.orderSample.findMany({
        where: {
          orderId,
          tenantId,
          deletedAt: null,
          tests: {
            some: { orderItemId: { in: removedItemIds }, deletedAt: null },
          },
        },
        select: {
          id: true,
          tests: {
            where: { deletedAt: null },
            select: { id: true, orderItemId: true },
          },
        },
      });

      for (const sample of samples) {
        const removedLinks = sample.tests.filter((l) =>
          removedSet.has(l.orderItemId),
        );
        const survivingLinks = sample.tests.filter(
          (l) => !removedSet.has(l.orderItemId),
        );

        if (survivingLinks.length === 0) {
          // Sample is exclusively tied to removed items — void it. Any transfer
          // of it still on its way (not yet accepted) is closed too: otherwise the
          // receiving branch keeps a transfer for a sample that no longer exists
          // and its Accept fails with "sample not found".
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
              rejectionReason: 'Order item removed',
              updatedBy: personId,
            },
          });
          await tx.orderSample.update({
            where: { id: sample.id },
            data: {
              deletedAt: now,
              status: SampleStatus.CANCELLED,
              updatedBy: personId,
              statusHistory: {
                create: {
                  tenantId,
                  branchId,
                  action: 'cancel',
                  toStatus: SampleStatus.CANCELLED,
                  changedBy: personId,
                },
              },
            },
          });
        } else {
          // Sample is shared — keep it, just soft-delete the removed tests' links.
          await tx.orderSampleTest.updateMany({
            where: { id: { in: removedLinks.map((l) => l.id) } },
            data: { deletedAt: now },
          });
        }
      }

      // Soft-delete all LabReports belonging to the removed order items.
      // A deletion guard upstream ensures none are past PENDING/PARTIAL_PENDING.
      await tx.labReport.updateMany({
        where: {
          orderItemId: { in: removedItemIds },
          tenantId,
          deletedAt: null,
        },
        data: { deletedAt: now },
      });
    }

    if (addedItemIds.length > 0) {
      const items = await tx.orderItem.findMany({
        where: { id: { in: addedItemIds }, orderId, tenantId, deletedAt: null },
        include: { branchLabTest: true, branchLabPanel: true },
      });
      if (items.length > 0) {
        await this.buildSamplesForItems(
          tx,
          tenantId,
          branchId,
          personId,
          orderId,
          items,
        );
      }
    }
  }

  /**
   * Collect the accession sample(s) carrying a given order item, inside an
   * existing (already tenant-scoped) transaction — the bridge that lets the
   * Order Overview "Collect / Collect & Print" action drive the real sample
   * lifecycle (not just `OrderItem.collectedAt`). For each sample serving the
   * item that is still in a collectable status (`NEW`/`HOLD`/`REPEAT`), applies
   * the §A.9 `collect` transition → `COLLECTED` (stamping `collectedAt`/
   * `collectedBy`/`tubeType`, and — at collection time — a sequential,
   * grouping-aware barcode via `assignBarcodesOnCollectInTx`, regardless of
   * `print`) and appends a history row. Because a sample is
   * one physical tube shared by several tests, all sibling order items on a
   * transitioned sample are stamped collected too (a tube is drawn once).
   * Idempotent: samples already past `NEW`/`HOLD`/`REPEAT` are skipped, so a
   * repeat click is a no-op. Safe no-op when the order has no samples yet (e.g.
   * a DRAFT / non-diagnostic order): nothing to transition.
   * @param tx active Prisma transaction client (already tenant-scoped)
   * @param tenantId tenant scope
   * @param personId acting person id (recorded as `collectedBy`/`changedBy`)
   * @param orderItemId the order item whose sample(s) to collect
   * @param opts collection metadata; `print` no longer gates the barcode, which
   *   is assigned (sequential + grouping-aware) on every collect
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
      select: { id: true },
    });
    await this.collectSamplesInTx(
      tx,
      tenantId,
      personId,
      samples.map((s) => s.id),
      opts,
    );
  }

  /**
   * Collect a set of accession samples by id inside an existing (already
   * tenant-scoped) transaction — the group-scoped counterpart of
   * {@link collectForOrderItemInTx}, driving the Product Overview modal's
   * **group-wise** Collect / Collect & Print (the group's flat `sampleIds`).
   * Only samples still in a collectable status (`NEW`/`HOLD`/`REPEAT`) are
   * transitioned; the rest are skipped, so a repeat click (or a partly-collected
   * group) is idempotent. Every sample shares one `collectedAt` stamp. Safe
   * no-op on an empty/all-collected id set.
   * @param tx active Prisma transaction client (already tenant-scoped)
   * @param tenantId tenant scope
   * @param personId acting person id (recorded as `collectedBy`/`changedBy`)
   * @param sampleIds the accession sample ids to collect
   * @param opts collection metadata; `print` no longer gates the barcode, which
   *   is assigned (sequential + grouping-aware) on every collect
   */
  async collectSamplesInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    sampleIds: string[],
    opts: {
      print: boolean;
      tubeType?: string;
      notes?: string;
      attachmentUrl?: string;
    },
  ): Promise<void> {
    if (sampleIds.length === 0) return;
    const samples = await tx.orderSample.findMany({
      where: { id: { in: sampleIds }, tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    const collectable = samples.filter((s) =>
      COLLECTABLE_SAMPLE_STATUSES.includes(s.status),
    );
    if (collectable.length === 0) return;

    const now = new Date();
    for (const s of collectable) {
      await this.collectSampleInTx(tx, tenantId, personId, s.id, now, opts);
    }

    // Barcode is generated at collection time (not at order creation): assign a
    // sequential, grouping-aware barcode to the just-collected samples that lack
    // one — regardless of `print` (plain Collect barcodes too; "& Print" only
    // additionally prints the label on the front end).
    await this.assignBarcodesOnCollectInTx(
      tx,
      tenantId,
      personId,
      collectable.map((s) => s.id),
    );
  }

  /**
   * Collect one accession sample inside an existing (already tenant-scoped)
   * transaction: apply the §A.9 `collect` transition → `COLLECTED` (stamping
   * `collectedAt`/`collectedBy`/`tubeType`; the barcode is assigned separately,
   * grouping-aware, by the batch caller `collectSamplesInTx`), then — because a
   * sample is one
   * physical tube shared by several tests — stamp every sibling order item on
   * the sample collected too (a tube is drawn once). The caller must have already
   * confirmed the sample is in a collectable status. Shared by
   * {@link collectSamplesInTx} (group / per-item collect bridges).
   * @param now the shared collection timestamp for the batch
   */
  private async collectSampleInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    sampleId: string,
    now: Date,
    opts: {
      print: boolean;
      tubeType?: string;
      notes?: string;
      attachmentUrl?: string;
    },
  ): Promise<void> {
    await this.transitionInTx(
      tx,
      tenantId,
      personId,
      sampleId,
      'collect',
      (sample) => ({
        data: {
          collectedAt: now,
          collectedBy: personId,
          // A tube type chosen in the Collect modal wins; otherwise derive it
          // from the sample's container/sample type (unchanged behaviour).
          tubeType:
            opts.tubeType ??
            sample.tubeType ??
            sample.containerType ??
            sample.sampleType ??
            undefined,
          // Barcode is assigned after the collect transition, grouping-aware,
          // by `assignBarcodesOnCollectInTx` in the batch caller — not here.
        },
      }),
      { notes: opts.notes, attachmentUrl: opts.attachmentUrl },
    );

    // A tube is drawn once → every test it carries is collected together.
    // Stamp all sibling order items on this sample (preserve already-set
    // timestamps via `collectedAt: null`).
    const siblings = await tx.orderSampleTest.findMany({
      where: { sampleId, tenantId, deletedAt: null },
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
    personId: string,
  ): Promise<PaginatedResult<OrderSampleListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const nowMs = Date.now();
    const tat = await this.tatThresholds(tenantId, branchId);
    const scopeIds = await this.userDepartmentScope.resolveDepartmentIds(
      tenantId,
      personId,
    );

    const where = this.buildSampleWhere(
      tenantId,
      branchId,
      query,
      tat,
      nowMs,
      scopeIds,
    );

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
   * Grouped in-house list — the same filters as `findAll`, but **order-first**:
   * the Order ID is always the top-level grouping and the pagination unit (10
   * orders/page), never crossing order boundaries (Critical Rule #1). Within each
   * order, samples are grouped into **final groups by the tenant's current
   * `groupingMode`** (via `barcodeGroupKey`) — Sample/Order/Department/
   * Department+Sample — so the displayed grouping, the shared barcode and the
   * action scope always follow the live Group Settings, even after the mode is
   * changed. Each final group carries the flat `sampleIds` its action button
   * targets — a status change cascades to every sample in the group (Rule #3).
   * The tenant's current `groupingMode` is echoed as a FE layout hint.
   * Reuses `buildSampleWhere` + `deriveTatStatus`.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param query pagination + the §A.3 filters (status tab, search, dates, …)
   */
  async findAllGrouped(
    tenantId: string,
    branchId: string | null,
    query: ListSamplesDto,
    personId: string,
  ): Promise<PaginatedResult<InHouseOrderGroup>> {
    const page = query.page ?? 1;
    const limit = 10; // group-aware pagination: 10 orders per page
    const nowMs = Date.now();
    const tat = await this.tatThresholds(tenantId, branchId);
    const scopeIds = await this.userDepartmentScope.resolveDepartmentIds(
      tenantId,
      personId,
    );
    const where = this.buildSampleWhere(
      tenantId,
      branchId,
      query,
      tat,
      nowMs,
      scopeIds,
    );

    const { orderIds, total, rows, mode } = await this.prisma.withTenant(
      tenantId,
      async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { groupingMode: true },
        });
        const mode =
          tenant?.groupingMode ?? AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME;

        // Page of order ids (ordered by most-recent sample) + total order count.
        const [pageGroups, allGroups] = await Promise.all([
          tx.orderSample.groupBy({
            by: ['orderId'],
            where,
            orderBy: { _max: { createdAt: 'desc' } },
            skip: (page - 1) * limit,
            take: limit,
          }),
          tx.orderSample.groupBy({ by: ['orderId'], where }),
        ]);
        const orderIds = pageGroups.map((g) => g.orderId);

        // Fetch all samples belonging to this page's orders.
        const rows = await tx.orderSample.findMany({
          where: { ...where, orderId: { in: orderIds } },
          include: SAMPLE_LIST_INCLUDE,
          orderBy: { createdAt: 'desc' },
        });
        return { orderIds, total: allGroups.length, rows, mode };
      },
    );

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

    // Assemble one InHouseOrderGroup per paged order id (order-first).
    const groups: InHouseOrderGroup[] = [];
    for (const orderId of orderIds) {
      const orderRows = rows.filter((r) => r.orderId === orderId);
      if (orderRows.length === 0) continue;
      groups.push(
        this.buildOrderGroup(
          orderId,
          orderRows,
          mode,
          deptNameById,
          tat,
          nowMs,
        ),
      );
    }

    return paginated(groups, total, page, limit);
  }

  /**
   * Grouped samples for a **single order** — the same order-first grouping the
   * in-house list produces (via {@link buildOrderGroup} keyed on the tenant's
   * current `groupingMode`), but scoped to one order id rather than a page of
   * orders. Powers the Product Overview modal's grouped Test Details, so its
   * groups/barcodes/action-scope match `/accession/inhouse-orders` exactly.
   * Scoped by tenant + order id only (no branch filter): the modal always
   * targets a specific order the caller just created/opened, and a user with
   * access to several branches must be able to see the order across them.
   *
   * One physical sample sent between branches has several rows (the sender's
   * original and each receiving branch's copy). The overview lists the order's
   * tests, not its sample records, so a sender's original whose transfer was
   * accepted — and which therefore has a live copy — is left out
   * ({@link supersededSampleIds}); the row of the branch that currently holds the
   * sample is the one shown. A transfer still on its way has no copy yet, so the
   * original stays visible as "Sent".
   * @param tenantId tenant scope (from JWT)
   * @param orderId the order whose samples to group
   * @returns the order's grouped samples, or `null` when it has none yet (e.g. a
   *   DRAFT / non-diagnostic order with no generated samples)
   */
  async findOrderGrouped(
    tenantId: string,
    orderId: string,
  ): Promise<InHouseOrderGroup | null> {
    const nowMs = Date.now();
    // TAT bands are branch-scoped; without the modal's active branch we resolve
    // the tenant default (branchId = null) — good enough for the derived band a
    // grouped row shows, and never affects grouping/action scope.
    const tat = await this.tatThresholds(tenantId, null);

    const { rows, mode } = await this.prisma.withTenant(
      tenantId,
      async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { groupingMode: true },
        });
        const mode =
          tenant?.groupingMode ?? AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME;
        const found = await tx.orderSample.findMany({
          where: { orderId, tenantId, deletedAt: null },
          include: SAMPLE_LIST_INCLUDE,
          orderBy: { createdAt: 'desc' },
        });
        const superseded = await this.supersededSampleIds(tx, tenantId, found);
        const rows =
          superseded.size > 0
            ? found.filter((r) => !superseded.has(r.id))
            : found;
        return { rows, mode };
      },
    );

    if (rows.length === 0) return null;

    // Batch-resolve department names for the order's samples.
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

    return this.buildOrderGroup(orderId, rows, mode, deptNameById, tat, nowMs);
  }

  /**
   * Ids of samples that an accepted internal transfer has superseded. A
   * `SENT_INTERNAL` sample with an `ACCEPTED` INTERNAL transfer is superseded
   * when a live sample of the same order exists at the transfer's destination
   * branch and carries all of its tests — that is the receiving branch's copy
   * (made when the transfer was accepted, with the same order items / tests), and
   * it is now the record of the branch holding the sample. The sender's original
   * is just history. Matching on the full (order item, test) set keeps the
   * samples of a panel's different member tests apart, and an accepted transfer
   * whose copy was since voided supersedes nothing — the original stays.
   * Needs only the rows already loaded plus one transfer query.
   */
  private async supersededSampleIds(
    tx: Prisma.TransactionClient,
    tenantId: string,
    rows: ReadonlyArray<{
      id: string;
      status: SampleStatus;
      branchId: string | null;
      tests: ReadonlyArray<{ orderItemId: string; labTestId: string | null }>;
    }>,
  ): Promise<Set<string>> {
    const sent = rows.filter((r) => r.status === SampleStatus.SENT_INTERNAL);
    if (sent.length === 0) return new Set();
    const accepted = await tx.sampleTransfer.findMany({
      where: {
        tenantId,
        sampleId: { in: sent.map((r) => r.id) },
        kind: TransferKind.INTERNAL,
        transferStatus: TransferStatus.ACCEPTED,
        deletedAt: null,
        destinationBranchId: { not: null },
      },
      select: { sampleId: true, destinationBranchId: true },
    });
    const testKey = (t: { orderItemId: string; labTestId: string | null }) =>
      `${t.orderItemId}:${t.labTestId ?? ''}`;
    const superseded = new Set<string>();
    for (const t of accepted) {
      const original = sent.find((r) => r.id === t.sampleId);
      if (!original || original.tests.length === 0) continue;
      const needed = original.tests.map(testKey);
      const hasCopy = rows.some((c) => {
        if (c.id === original.id || c.branchId !== t.destinationBranchId) {
          return false;
        }
        const have = new Set(c.tests.map(testKey));
        return needed.every((k) => have.has(k));
      });
      if (hasCopy) superseded.add(original.id);
    }
    return superseded;
  }

  /**
   * Assemble a single order's {@link InHouseOrderGroup}: enrich each raw sample
   * row with its derived TAT band + department name, then bucket the order's
   * samples into **final groups** by the tenant's LIVE grouping mode
   * (Sample-wise = per sample; Order-wise = the whole order; Department-wise =
   * per department; Dept+Sample = per department + sample name) — the very same
   * `barcodeGroupKey` used at barcode-assignment time. Grouping keys off the
   * current mode (not the frozen barcode), so the displayed grouping, the
   * barcode grouping and the action scope always agree with the tenant's current
   * Group Settings — even after the mode is changed, a sample is missing a
   * barcode, or a barcode was edited. Shared by {@link findAllGrouped} (list)
   * and {@link findOrderGrouped} (single order).
   */
  private buildOrderGroup(
    orderId: string,
    orderRows: OrderSampleListRow[],
    mode: AccessionGroupingMode,
    deptNameById: Map<string, string>,
    tat: TatThresholds,
    nowMs: number,
  ): InHouseOrderGroup {
    const toItem = (row: OrderSampleListRow): GroupedSampleItem => ({
      ...row,
      tatStatus: deriveTatStatus(row.createdAt, row.status, tat, nowMs),
      departmentName: row.departmentId
        ? (deptNameById.get(row.departmentId) ?? null)
        : null,
    });

    // The single distinct value across a bucket, else null (used for the group's
    // department / sample-name label).
    const distinctOrNull = <T>(values: T[]): T | null => {
      const set = new Set(values);
      return set.size === 1 ? [...set][0]! : null;
    };

    const items = orderRows.map(toItem);

    const buckets = new Map<string, GroupedSampleItem[]>();
    for (const it of items) {
      const bucketKey = this.barcodeGroupKey(it, mode);
      const arr = buckets.get(bucketKey);
      if (arr) arr.push(it);
      else buckets.set(bucketKey, [it]);
    }

    const finalGroups: InHouseSampleGroup[] = [...buckets.entries()].map(
      ([bucketKey, samples]) => {
        const deptId = distinctOrNull(samples.map((s) => s.departmentId));
        const sampleLabel = distinctOrNull(
          samples.map((s) => s.sampleGroupLabel ?? null),
        );
        // One shared barcode per group when the members agree; `null` (→ the
        // FE's "No barcode") when they carry differing/blank values — e.g.
        // left stale after a mode change (which nulls them) — flagging the
        // group for a fresh Assign Barcode.
        const barcode = distinctOrNull(samples.map((s) => s.barcode ?? null));
        return {
          groupKey: `${orderId}::${bucketKey}`,
          barcode,
          department: deptId
            ? { id: deptId, name: deptNameById.get(deptId) ?? deptId }
            : null,
          sampleLabel,
          sampleIds: samples.map((s) => s.id),
          samples,
        };
      },
    );

    return {
      orderId,
      order: orderRows[0]?.order ?? null,
      groupingMode: mode,
      sampleIds: items.map((i) => i.id),
      groups: finalGroups,
    };
  }

  /**
   * Accession list summary: a count per status (§A.5 tabs, all statuses present
   * with 0 default), a count per TAT band (§A.4 bar), and the overall total.
   *
   * The counts follow the SAME filters as the list (date range, search, doctor,
   * panel, department, …) so the tabs/cards describe the records the user is
   * looking at — but deliberately ignore `status`, `tatStatus` and paging: every
   * tab/card must keep showing its own total whichever tab or card is selected
   * (otherwise picking "New" would zero every other tab). Counts are SAMPLES, as
   * before. Everything is counted in the database (one group-by for the tabs, one
   * count per TAT band) — no rows are loaded into memory.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param personId caller, for the department-visibility scope
   * @param query the list's filters (status / tatStatus / page / limit are ignored)
   */
  async summary(
    tenantId: string,
    branchId: string | null,
    personId: string,
    query: ListSamplesDto = {},
  ): Promise<AccessionSummary> {
    const scopeIds = await this.userDepartmentScope.resolveDepartmentIds(
      tenantId,
      personId,
    );
    const tat = await this.tatThresholds(tenantId, branchId);
    const nowMs = Date.now();
    const where = this.buildSampleWhere(
      tenantId,
      branchId,
      {
        ...query,
        status: undefined,
        tatStatus: undefined,
        page: undefined,
        limit: undefined,
      },
      tat,
      nowMs,
      scopeIds,
    );

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

    // One count per TAT band — the same `createdAt` range + open-status rule the
    // list's TAT filter uses, so a card always equals the rows behind it.
    const bandCounts = await Promise.all(
      TAT_STATUSES.map((band) =>
        this.prisma.orderSample.count({
          where: {
            AND: [
              where,
              { status: { notIn: [...TERMINAL_SAMPLE_STATUSES] } },
              { createdAt: tatCreatedAtRange(band, tat, nowMs) },
            ],
          },
        }),
      ),
    );
    // Built in the fixed band order (WITHIN → BREACHED), not completion order.
    const byTat = Object.fromEntries(
      TAT_STATUSES.map((band, i) => [band, bandCounts[i]]),
    ) as Record<TatStatus, number>;
    return { total, byStatus, byTat };
  }

  /**
   * Fetch one accession sample fully composed (tests + history + transfers +
   * order/patient), scoped to the tenant (Sample Overview — PDF §A.10.4).
   * @param id sample id
   * @param tenantId tenant scope
   * @param actingBranchId the caller's ACTIVE branch. When given, the sample must
   *   have a stake in that branch (see {@link branchMayReadSample}), otherwise it
   *   is reported as not found. Omit (or null, for a tenant-wide caller such as
   *   the business admin) to read without the branch check - the service's own
   *   internal reads do.
   * @throws OrderSampleNotFoundException if missing/soft-deleted/other tenant, or
   *   if it has no stake in the caller's branch
   */
  async findById(
    id: string,
    tenantId: string,
    actingBranchId?: string | null,
  ): Promise<OrderSampleDetail> {
    const sample = await this.prisma.orderSample.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: SAMPLE_INCLUDE,
    });
    if (!sample) {
      throw new OrderSampleNotFoundException(id);
    }
    if (
      actingBranchId &&
      !(await this.branchMayReadSample(id, tenantId, actingBranchId))
    ) {
      // Same answer as a missing sample: do not confirm that it exists.
      throw new OrderSampleNotFoundException(id);
    }
    return this.withDepartments(sample, tenantId);
  }

  /**
   * Whether a branch has a stake in a sample - holds it, created it, processes it,
   * has had it, booked its order, or sent / received a transfer that moved it, its
   * copy or the transfer that produced it. Reads by id (Sample Overview, History,
   * the transfer detail) are limited to these branches, so a branch that never
   * touched a sample cannot open it by guessing or reusing an id.
   * @param sampleId the sample to check
   * @param tenantId tenant scope
   * @param actingBranchId the caller's active branch
   */
  async branchMayReadSample(
    sampleId: string,
    tenantId: string,
    actingBranchId: string | null | undefined,
  ): Promise<boolean> {
    if (!actingBranchId) return true;
    const sample = await this.prisma.orderSample.findFirst({
      where: { id: sampleId, tenantId, deletedAt: null },
      select: {
        branchId: true,
        originBranchId: true,
        processingBranchId: true,
        heldBranchIds: true,
        sourceTransferId: true,
        order: { select: { branchId: true } },
      },
    });
    if (!sample) return false;
    const transfers = await this.prisma.sampleTransfer.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { sampleId },
          { clonedSampleId: sampleId },
          ...(sample.sourceTransferId ? [{ id: sample.sourceTransferId }] : []),
        ],
      },
      select: {
        branchId: true,
        originBranchId: true,
        destinationBranchId: true,
      },
    });
    return branchMayRead(actingBranchId, branchesWithStake(sample, transfers));
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

    // Resolve the transfers' OUTSOURCE center names (logical ref — no Prisma
    // relation), WITHOUT a deletedAt filter so a since-deactivated center still
    // resolves. Only queried when the sample actually has an outsource transfer,
    // so non-outsourced samples pay nothing. Lets the FE pre-fill Assign/Edit
    // Center with the current center instead of opening blank.
    const centerIds = [
      ...new Set(
        sample.transfers
          .map((tr) => tr.outsourceCenterId)
          .filter((v): v is string => !!v),
      ),
    ];
    const centerNameById = new Map<string, string>();
    if (centerIds.length > 0) {
      const centers = await this.prisma.withTenant(tenantId, (tx) =>
        tx.outsourceCenter.findMany({
          where: { id: { in: centerIds }, tenantId },
          select: { id: true, name: true },
        }),
      );
      centers.forEach((c) => centerNameById.set(c.id, c.name));
    }
    const transfers = sample.transfers.map((tr) => ({
      ...tr,
      outsourceCenterName: tr.outsourceCenterId
        ? (centerNameById.get(tr.outsourceCenterId) ?? null)
        : null,
    }));

    return {
      ...sample,
      tests,
      transfers,
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
   * @param branchId the caller's active branch: the sample must have a stake in it
   *   (null for a tenant-wide caller reads without the check)
   * @throws OrderSampleNotFoundException if the sample is missing, or has no stake
   *   in the caller's branch
   */
  async findHistory(
    id: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<Array<OrderSampleStatusHistory & AccessionHistoryActor>> {
    const sample = await this.findById(id, tenantId, branchId);
    const rows = await this.prisma.orderSampleStatusHistory.findMany({
      where: { sampleId: id, tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const movements = rows.filter(
      (r) => r.fromStatus !== null && r.fromStatus !== r.toStatus,
    );
    // A cancelled order shows its cancellation in the trail too, at its place in
    // the timeline (newest first, like every other entry).
    const cancelled = await this.orderCancelledEntry(tenantId, sample);
    const trail = cancelled
      ? [...movements, cancelled].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        )
      : movements;
    return this.enrichHistoryActors(trail, tenantId, branchId);
  }

  /**
   * The "Order cancelled" line of a sample's audit trail, read from the order
   * itself (no history row is written, so orders cancelled before this existed
   * show it too): who last changed the order and when - the cancel, unless a later
   * change such as a refund moved it. Null when the order is not cancelled.
   * Built in the shape of a history row so the trail renders it like the others;
   * `action = 'order-cancelled'` marks it and its statuses are not a transition.
   */
  private async orderCancelledEntry(
    tenantId: string,
    sample: {
      id: string;
      orderId: string;
      branchId: string | null;
      status: SampleStatus;
    },
  ): Promise<OrderSampleStatusHistory | null> {
    const order = await this.prisma.order.findFirst({
      where: {
        id: sample.orderId,
        tenantId,
        status: OrderStatus.CANCELLED,
        deletedAt: null,
      },
      select: { id: true, updatedAt: true, updatedBy: true },
    });
    if (!order) return null;
    return {
      id: `order-cancelled:${order.id}`,
      tenantId,
      branchId: sample.branchId,
      sampleId: sample.id,
      action: 'order-cancelled',
      fromStatus: null,
      toStatus: sample.status,
      reason: null,
      notes: null,
      attachmentUrl: null,
      changedBy: order.updatedBy ?? null,
      createdAt: order.updatedAt,
      updatedAt: order.updatedAt,
      deletedAt: null,
    };
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
   * Resolves the `order_label_print` template to use — the caller's explicit
   * `templateId` when given, otherwise the configured default (Old Templates →
   * Configuration), then the first active template — and renders it with this
   * sample's real data via `PdfReportTemplateService.generatePdf`.
   * @param branchId active branch (honors branch-level Configuration first,
   * then tenant-wide); null for tenant-wide only
   * @throws OrderSampleNotFoundException if missing/soft-deleted
   * @throws NoActiveLabelTemplateException if no active template exists
   */
  async printLabel(
    id: string,
    tenantId: string,
    branchId: string | null,
    templateId?: string,
  ): Promise<Buffer> {
    const sample = await this.findById(id, tenantId);
    const context = await this.buildLabelContext(sample, tenantId);
    const resolvedTemplateId =
      templateId ??
      (await this.resolveLabelTemplateId(
        tenantId,
        branchId,
        'order_label_print',
      ));
    return this.pdfReportTemplateService.generatePdf(
      resolvedTemplateId,
      tenantId,
      context,
    );
  }

  /**
   * Print many samples' labels into one PDF ("Multiple Label Print" checklist
   * item). Renders ONE `multiple_order_label_print`-type template ONCE, with
   * one repeating `sections.labels` row per **distinct barcode** (not per
   * sample) — several samples sharing one barcode (per the tenant's grouping
   * mode, e.g. Department+Sample) print as a single combined label, merging
   * their accession numbers/test names/sample types rather than repeating the
   * same barcode image once per sample. A sample with no barcode yet (never
   * assigned) is never merged with another — each stays its own singleton row.
   * Same flattened-section approach as `LabReportService.printAllForOrder`
   * (the renderer only expands one level of `{{#each}}`).
   * @param branchId active branch (honors branch-level Configuration first,
   * then tenant-wide); null for tenant-wide only
   * @throws OrderSampleNotFoundException if any sample id is missing
   * @throws NoActiveLabelTemplateException if no active template exists
   */
  async printLabels(
    ids: string[],
    tenantId: string,
    branchId: string | null,
    templateId?: string,
  ): Promise<Buffer> {
    const samples = await Promise.all(
      ids.map((id) => this.findById(id, tenantId)),
    );
    const { timezone, dateFormat, timeFormat } =
      await this.tenantService.getLocale(tenantId);

    // Group by barcode value; samples with no barcode each form their own
    // singleton group (nothing to merge them by), keyed off their own id so
    // they never collide with each other or with a real barcode value.
    const groups = new Map<string, OrderSampleDetail[]>();
    for (const s of samples) {
      const key = s.barcode ? `bc:${s.barcode}` : `id:${s.id}`;
      const arr = groups.get(key);
      if (arr) arr.push(s);
      else groups.set(key, [s]);
    }
    const labels = [...groups.values()].map((group) =>
      this.buildMergedLabelVariables(group, timezone, dateFormat, timeFormat),
    );
    const combined: GeneratePdfDto = { sections: { labels } };

    const resolvedTemplateId =
      templateId ??
      (await this.resolveLabelTemplateId(
        tenantId,
        branchId,
        'multiple_order_label_print',
      ));
    return this.pdfReportTemplateService.generatePdf(
      resolvedTemplateId,
      tenantId,
      combined,
    );
  }

  /**
   * Resolve the label template to render when the caller gave none, following
   * the 3-tier rule: (1) the Configuration default for this slot/type (active
   * branch, then tenant-wide), (2) the first active template of this type,
   * (3) fail with a clear, user-facing error. More than one active template is
   * valid — we simply pick the configured one, else the first.
   * @throws NoActiveLabelTemplateException when no active template exists
   */
  private async resolveLabelTemplateId(
    tenantId: string,
    branchId: string | null,
    type: PdfReportTemplateType,
  ): Promise<string> {
    // 1. Configuration default (Old Templates → Configuration).
    const configured =
      await this.pdfTemplateConfigService.resolveConfiguredTemplateId(
        tenantId,
        branchId,
        type,
      );
    if (configured) return configured;
    // 2. First active template of this type.
    const { data } = await this.pdfReportTemplateService.findAllForTenant(
      tenantId,
      1,
      1,
      { type, status: 'ACTIVE' },
    );
    if (data[0]) return data[0].id;
    // 3. Nothing available.
    throw new NoActiveLabelTemplateException(tenantId, type);
  }

  /** Flat `{variable}` values for one sample's label. */
  private buildLabelVariables(
    sample: OrderSampleDetail,
    timezone: string,
    dateFormat: string,
    timeFormat: string,
  ): Record<string, unknown> {
    const patient = sample.order?.patient;
    return {
      accession_no: sample.accessionNo,
      barcode: sample.barcode ?? '',
      // S3 URL of the rendered Code 128 barcode image, so a label template can
      // show the scannable image via `<img src="{orderIdBarcode}">` (in addition
      // to the font-rendered `{barcode}` value).
      orderIdBarcode: sample.orderIdBarcode ?? '',
      patient_name: patient
        ? [patient.firstName, patient.middleName, patient.lastName]
            .filter(Boolean)
            .join(' ')
        : '',
      // Single-unit age ("25 Years" / "6 Months" / "15 Days") from DOB, unit
      // picked by the registration Age Type rule; stored age/ageType when DOB
      // is unknown. Labels deliberately skip the full "Y Years, M Months,
      // D Days" breakdown the order documents print. `now` is the branch-local
      // date so the age doesn't lag a day between local and UTC midnight.
      patient_age: patientSingleUnitAgeDisplay(
        patient?.dateOfBirth ?? null,
        patient?.age ?? null,
        patient?.ageType ?? null,
        toBranchLocalInstant(new Date(), timezone),
      ),
      patient_gender: patient?.gender ?? '',
      patient_um_id: patient?.umId ?? '',
      // Distinct department name(s) of the sample's tests, comma-joined
      // (resolved by `withDepartments` — a sample can span departments).
      department_name: sample.departmentLabel ?? '',
      order_code: sample.order?.orderCode ?? '',
      test_names: sample.tests
        .map((t) => t.testName)
        .filter(Boolean)
        .join(', '),
      sample_name: sample.sampleName ?? '',
      sample_type: sample.sampleType ?? '',
      container_type: sample.containerType
        ? CONTAINER_TYPE_LABELS[sample.containerType]
        : '',
      priority: sample.priority,
      // Collection date AND time, e.g. `21/09/2026 01:30 PM` (date + space +
      // tenant 12h/24h time). Blank when the sample has no collection time.
      collected_at: sample.collectedAt
        ? `${formatTenantDate(
            toBranchLocalInstant(sample.collectedAt, timezone),
            dateFormat,
          )} ${formatTenantTime(
            toBranchLocalInstant(sample.collectedAt, timezone),
            timeFormat,
          )}`
        : '',
    };
  }

  /**
   * Flat `{variable}` values for one **barcode group's** label row — one or
   * more samples sharing a barcode, merged into a single label. Fields that
   * are identical across the group's samples (barcode/image, patient,
   * order/UHID, department, sample type/container, collected time) are taken
   * from the first sample; fields that vary per sample (accession number,
   * test names) are comma-joined across every sample in the group so the one
   * printed label still reflects everything the shared barcode covers.
   */
  private buildMergedLabelVariables(
    group: OrderSampleDetail[],
    timezone: string,
    dateFormat: string,
    timeFormat: string,
  ): Record<string, unknown> {
    const base = this.buildLabelVariables(
      group[0]!,
      timezone,
      dateFormat,
      timeFormat,
    );
    if (group.length === 1) return base;
    return {
      ...base,
      accession_no: group
        .map((s) => s.accessionNo)
        .filter(Boolean)
        .join(', '),
      test_names: [
        ...new Set(
          group.flatMap((s) => s.tests.map((t) => t.testName).filter(Boolean)),
        ),
      ].join(', '),
    };
  }

  /** Render context for a single-sample label print. */
  private async buildLabelContext(
    sample: OrderSampleDetail,
    tenantId: string,
  ): Promise<GeneratePdfDto> {
    const { timezone, dateFormat, timeFormat } =
      await this.tenantService.getLocale(tenantId);
    return {
      variables: this.buildLabelVariables(
        sample,
        timezone,
        dateFormat,
        timeFormat,
      ),
    };
  }

  // ── State-machine actions (PDF §A.9/§A.10) ─────────────────────────────────

  /**
   * Collect Sample (§A.10.1) — New/Hold/Repeat → Collected. The sample barcode is
   * generated **at collection time** (not at order creation): once the samples
   * transition to COLLECTED, a sequential, grouping-aware barcode is assigned to
   * each collected sample that lacks one (`assignBarcodesOnCollectInTx`), in the
   * same transaction.
   */
  async collect(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: CollectSampleDto,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
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
      (tx, changedIds) =>
        this.assignBarcodesOnCollectInTx(tx, tenantId, personId, changedIds),
    );
  }

  /**
   * Collect & Print (§A.10.1) — identical to {@link collect} on the backend (the
   * sample barcode is generated on collection either way); the "& Print"
   * distinction is a front-end concern — it additionally opens the label print
   * dialog after collection.
   */
  async collectAndPrint(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: CollectSampleDto,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    return this.collect(ids, tenantId, personId, dto);
  }

  /** Accept Sample — Collected/Halt → Accepted (stamps received/accepted time). */
  async accept(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: AcceptSampleDto,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
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
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
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
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
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
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    const result = await this.transitionIds(
      ids,
      tenantId,
      personId,
      'error',
      () => ({ data: {} }),
      dto,
    );
    // Fire-and-forget: inform the order's referring panel (B2B). Handled by
    // ClinicalEventListener; walk-in orders (no panel) are skipped there.
    this.emitSampleFlagged(
      'accession.sample.error',
      tenantId,
      result.succeeded,
    );
    return result;
  }

  /** Hold — New/Repeat → Hold. */
  async hold(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: SampleNoteDto,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'hold',
      () => ({ data: {} }),
      dto,
    );
  }

  /**
   * Repeat — Acquired/Halt/Error → Repeat (records the repeat reason).
   *
   * A receiving-branch COPY of a transferred sample (`sourceTransferId` set) is
   * not repeated in place: the test goes back to its sender (see
   * {@link returnCopyToOrigin}) — allowed until its report's result is validated.
   * Such copies are handled first, in their own transaction; every other id
   * follows the normal transition path, where a Repeat also resets the report
   * (see {@link reportsToResetOnRepeat}). A copy is voided, so it is not part of
   * the returned list.
   */
  async repeat(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: RepeatSampleDto,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    const skippedCopies: BulkSkippedItem[] = [];
    const skipInvalid = (dto as ActionNote).skipInvalid === true;
    const copies = await this.prisma.withTenant(tenantId, (tx) =>
      tx.orderSample.findMany({
        where: {
          id: { in: ids },
          tenantId,
          deletedAt: null,
          sourceTransferId: { not: null },
        },
        // one fixed order (ascending id), see `utils/request-order.util`
        orderBy: { id: 'asc' },
        select: {
          id: true,
          status: true,
          sourceTransferId: true,
          accessionNo: true,
        },
      }),
    );
    const returnedOriginIds: string[] = [];
    if (copies.length > 0) {
      await this.prisma.withTenant(tenantId, async (tx) => {
        for (const copy of copies) {
          try {
            returnedOriginIds.push(
              await this.returnCopyToOrigin(
                tx,
                tenantId,
                personId,
                copy.id,
                dto.repeatReason,
              ),
            );
            // Keep the transfer row in step (no-op if it is already closed).
            await tx.sampleTransfer.updateMany({
              where: {
                id: copy.sourceTransferId!,
                tenantId,
                deletedAt: null,
                transferStatus: TransferStatus.ACCEPTED,
              },
              data: {
                transferStatus: TransferStatus.REPEAT,
                repeatReason: dto.repeatReason,
                updatedBy: personId,
              },
            });
          } catch (e) {
            if (skipInvalid && e instanceof InvalidSampleTransitionException) {
              skippedCopies.push({
                id: copy.id,
                accessionNo: copy.accessionNo ?? null,
                reason: refusalMessage(e),
                code: e.errorCode,
              });
              continue;
            }
            throw e;
          }
        }
      });
    }
    await this.notifySamplesRepeated(tenantId, returnedOriginIds);
    const copyIds = new Set(copies.map((c) => c.id));
    const restIds = ids.filter((id) => !copyIds.has(id));
    const rest: BulkActionResult<OrderSampleWithRelations> =
      restIds.length > 0
        ? await this.transitionIds(
            restIds,
            tenantId,
            personId,
            'repeat',
            () => ({ data: {}, reason: dto.repeatReason }),
            dto,
          )
        : { succeeded: [], skipped: [] };
    // Fire-and-forget: inform the order's referring panel (B2B). Handled by
    // ClinicalEventListener; walk-in orders (no panel) are skipped there.
    this.emitSampleFlagged('accession.sample.repeat', tenantId, rest.succeeded);
    // A returned copy is voided, so report the sender's original sample that went
    // to REPEAT in its place - one entry per processed id (callers compare the
    // count with what they asked for).
    const returned = await Promise.all(
      returnedOriginIds.map((id) => this.findById(id, tenantId)),
    );
    return {
      succeeded: [...returned, ...rest.succeeded],
      skipped: [...skippedCopies, ...rest.skipped],
    };
  }

  /**
   * The user actions that stay allowed on a CANCELLED order's samples so a sample
   * that is out at another branch can be wound down: Retrieve (the sender pulling
   * back a sample the receiver has not received yet; the usual window still
   * applies) and, for the receiving branch's own copy, Store then Discard (Discard
   * is only legal from Stored, so Store must stay open too - otherwise a copy
   * whose report was already worked on, which cannot be sent back, would have no
   * way out).
   */
  private isCancelledOrderWindDown(
    action: SampleAction,
    sample: { sourceTransferId: string | null; status: SampleStatus },
  ): boolean {
    // Retrieve winds down only a sample that is OUT at another branch / partner. A
    // sample that is back (or never left) is frozen like any other - Retrieve would
    // otherwise keep stepping it back on a cancelled order.
    if (action === 'retrieve') return isTransferredStatus(sample.status);
    return (
      (action === 'store' || action === 'discard') &&
      sample.sourceTransferId !== null
    );
  }

  /**
   * Whether the order is CANCELLED - the one question every accession and
   * transfer action asks before touching a sample, so a cancelled order's samples
   * stay exactly as they were. Public so the transfer service shares it.
   * @param tx active Prisma transaction client
   * @param tenantId tenant scope
   * @param orderId the sample's order
   */
  async isOrderCancelled(
    tx: Pick<Prisma.TransactionClient, 'order'>,
    tenantId: string,
    orderId: string,
  ): Promise<boolean> {
    const cancelled = await tx.order.findFirst({
      where: { id: orderId, tenantId, status: OrderStatus.CANCELLED },
      select: { id: true },
    });
    return cancelled !== null;
  }

  /**
   * Pre-checks for sending a sample to another branch (INTERNAL transfer), inside
   * the caller's transaction. Refuses when:
   *  - the destination is the sample's own branch;
   *  - the sample already has an open transfer to another branch (in transit,
   *    picked up, received or accepted) — no second transfer for the same sample;
   *  - the report(s) the sample serves at the sending branch have already been
   *    worked on (not PENDING, or holding results/notes/attachments) — a report
   *    may only change branch while untouched.
   * A missing sample is left for `transitionInTx` to report.
   * @throws ValidationException for a same-branch destination
   * @throws SendBlockedException for an open transfer or a worked-on report
   *   (skippable by group "skip invalid" actions)
   */
  async assertInternalSendable(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sampleId: string,
    destinationBranchId: string | null,
  ): Promise<void> {
    const sample = await tx.orderSample.findFirst({
      where: { id: sampleId, tenantId, deletedAt: null },
      include: { tests: { where: { deletedAt: null } } },
    });
    if (!sample) return;
    if (destinationBranchId && destinationBranchId === sample.branchId) {
      throw new ValidationException(
        "The destination branch cannot be the sample's own branch.",
      );
    }
    // Never send a sample to a branch that has already held it (A -> B -> A,
    // A -> B -> C -> B, ...). The way back to an earlier branch is Repeat.
    if (destinationBranchId && isPreviousHolder(sample, destinationBranchId)) {
      throw new SendBlockedException(sample.status, PREVIOUS_HOLDER_MESSAGE);
    }
    const open = await tx.sampleTransfer.findFirst({
      where: {
        sampleId,
        tenantId,
        deletedAt: null,
        kind: TransferKind.INTERNAL,
        transferStatus: {
          in: [
            TransferStatus.IN_TRANSIT,
            TransferStatus.PICKED_UP,
            TransferStatus.RECEIVED,
            TransferStatus.ACCEPTED,
          ],
        },
      },
      select: { id: true },
    });
    if (open) {
      throw new SendBlockedException(
        sample.status,
        'This sample already has an open transfer to another branch.',
      );
    }
    const reportIds = await this.labReportService.findReportIdsForSampleTests(
      tx,
      tenantId,
      sample.branchId,
      sample.tests,
    );
    // Lock before checking, so a technician write still in flight is seen by the
    // check (and one that starts later finds the report sent out).
    await this.labReportService.lockReports(tx, tenantId, reportIds);
    for (const reportId of reportIds) {
      if (
        !(await this.labReportService.isReportUntouched(tx, tenantId, reportId))
      ) {
        throw new SendBlockedException(
          sample.status,
          'The report for this test has already been worked on (results, notes or attachments exist, or it is past Pending), so the sample cannot be sent to another branch.',
        );
      }
    }
  }

  /**
   * Return a transferred test to its sender: the receiving branch's Repeat of its
   * copy of the sample (after it accepted the transfer). Inside the caller's
   * transaction —
   *  0. refuses (`SampleSentToBranchException`) when the copy has itself been
   *     passed on to another branch, a partner or an outsource centre
   *     (`SENT_INTERNAL` / `FORWARD_EXTERNAL` / `OUTSOURCED`): it is out of this
   *     branch's hands, so voiding it here would leave that onward transfer open
   *     at the next branch with a sample and report nobody returned. The branch
   *     must retrieve it first (possible only before the next branch receives it);
   *  1. refuses (`SampleReturnBlockedException`) only when a report the copy
   *     serves already has a validated result (Result Done, Approved, Published);
   *     anything earlier is work in progress and is reset in step 3;
   *  2. voids the copy (soft-delete + `CANCELLED` + history row) together with
   *     its `OrderSampleTest` links, so it drops out of the receiver's lists and
   *     nothing reads its stale status;
   *  3. resets the report(s) (values cleared, back to PENDING, lock removed,
   *     worklist entries dropped; notes/attachments kept) and hands them back to
   *     the sender (clearing any NABL stopwatch);
   *  4. moves the sender's ORIGINAL sample from `SENT_INTERNAL` to `REPEAT`
   *     (system-driven, with the reason on its history), which also ends the
   *     "sent out" hiding of the report for the sender.
   * The caller updates the `SampleTransfer` row itself.
   * @returns the sender's original sample id (now `REPEAT`), so the caller can
   *   notify once the transaction has committed
   * @param copyId the receiving branch's copy (must carry `sourceTransferId`)
   * @param reason the receiver's repeat/reject reason, recorded on the history
   * @param action which button the receiver pressed; only names the action in the
   *   "already passed on" refusal (Reject and Repeat otherwise do the same thing)
   * @throws OrderSampleNotFoundException if the copy, its transfer or the
   *   original sample cannot be found
   * @throws SampleSentToBranchException if the copy has been passed on already
   * @throws SampleReturnBlockedException if a report's result is already validated
   */
  async returnCopyToOrigin(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    copyId: string,
    reason: string,
    action: 'repeat' | 'reject' = 'repeat',
  ): Promise<string> {
    const copy = await tx.orderSample.findFirst({
      where: { id: copyId, tenantId, deletedAt: null },
      include: { tests: { where: { deletedAt: null } } },
    });
    if (!copy || !copy.sourceTransferId) {
      throw new OrderSampleNotFoundException(copyId);
    }
    // Checked before anything is read or written: a copy this branch has already
    // passed on cannot be sent back (see the doc comment, step 0).
    if (isTransferredStatus(copy.status)) {
      throw new SampleSentToBranchException(action, copy.status);
    }
    const transfer = await tx.sampleTransfer.findFirst({
      where: { id: copy.sourceTransferId, tenantId, deletedAt: null },
    });
    if (!transfer)
      throw new OrderSampleNotFoundException(copy.sourceTransferId);
    const origin = await tx.orderSample.findFirst({
      where: { id: transfer.sampleId, tenantId, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (!origin) throw new OrderSampleNotFoundException(transfer.sampleId);

    const reportIds = await this.labReportService.findReportIdsForSampleTests(
      tx,
      tenantId,
      copy.branchId,
      copy.tests,
    );
    await this.labReportService.lockReports(tx, tenantId, reportIds);
    // Only a validated result (Result Done, Approved, Published) stops the send-back;
    // earlier work is reset below so the sending branch starts clean.
    if (
      !(await this.labReportService.canReturnToSender(tx, tenantId, reportIds))
    ) {
      throw new SampleReturnBlockedException(copy.status);
    }

    const now = new Date();
    await tx.orderSampleTest.updateMany({
      where: { sampleId: copy.id, deletedAt: null },
      data: { deletedAt: now },
    });
    await tx.orderSample.update({
      where: { id: copy.id },
      data: {
        deletedAt: now,
        status: SampleStatus.CANCELLED,
        previousStatus: copy.status,
        updatedBy: personId,
        statusHistory: {
          create: {
            tenantId,
            branchId: copy.branchId,
            action: 'returned-to-origin',
            fromStatus: copy.status,
            toStatus: SampleStatus.CANCELLED,
            reason,
            changedBy: personId,
          },
        },
      },
    });

    await this.labReportService.resetReportsForReturn(
      tx,
      tenantId,
      reportIds,
      personId,
    );
    if (origin.branchId) {
      await this.labReportService.moveReportsToBranch(
        tx,
        tenantId,
        reportIds,
        origin.branchId,
      );
    }
    await this.transitionInTx(
      tx,
      tenantId,
      personId,
      origin.id,
      'repeat',
      () => ({ data: {}, reason }),
      {
        force: true,
        system: true,
        notes: `Returned by the receiving branch: ${reason}`,
      },
    );
    return origin.id;
  }

  /**
   * Fire the "sample flagged for repeat" notification (B2B referring panel) for
   * samples that went to `REPEAT` outside the normal Repeat action - i.e. a test
   * returned to its sender by the receiving branch. Call AFTER the transaction
   * has committed so a rolled-back change never notifies. Fire-and-forget.
   */
  async notifySamplesRepeated(
    tenantId: string,
    sampleIds: string[],
  ): Promise<void> {
    if (sampleIds.length === 0) return;
    const samples = await this.prisma.orderSample.findMany({
      where: { id: { in: sampleIds }, tenantId },
      select: { id: true, branchId: true, orderId: true },
    });
    this.emitSampleFlagged('accession.sample.repeat', tenantId, samples);
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
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
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
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'discard',
      () => ({ data: {}, reason: dto.discardMethod }),
      dto,
    );
  }

  /**
   * Return — Accepted/Error/Stored → Returned (records the handover person).
   *
   * A copy that arrived from another branch (an accepted INTERNAL transfer) is
   * not simply marked Returned: it goes back to the branch that sent it, exactly
   * like the receiving branch's Repeat — the copy is voided, the report returns
   * to the sender and the sender's original sample goes to `REPEAT` (the sender
   * recollects it). Refused if the report has been worked on. Without this the
   * report would stay at the receiving branch with a `RETURNED` copy while the
   * sender's sample stays `SENT_INTERNAL` with no action left.
   * @throws SampleReturnBlockedException if the copy's report was worked on
   */
  async returnSample(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: ReturnSampleDto,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    const skippedCopies: BulkSkippedItem[] = [];
    const note = dto as ActionNote;
    const skipInvalid = note.skipInvalid === true;
    const copies = await this.prisma.withTenant(tenantId, (tx) =>
      tx.orderSample.findMany({
        where: {
          id: { in: ids },
          tenantId,
          deletedAt: null,
          sourceTransferId: { not: null },
        },
        // one fixed order (ascending id), see `utils/request-order.util`
        orderBy: { id: 'asc' },
        select: {
          id: true,
          status: true,
          sourceTransferId: true,
          accessionNo: true,
        },
      }),
    );
    const returnedOriginIds: string[] = [];
    if (copies.length > 0) {
      const reason = dto.notes
        ? `Sample returned by the receiving branch: ${dto.notes}`
        : 'Sample returned by the receiving branch';
      await this.prisma.withTenant(tenantId, async (tx) => {
        for (const copy of copies) {
          try {
            // Same legality as a normal Return. A group action never forces a
            // Return (`return` is not a FORCE_TARGET), so a copy that is not in a
            // returnable status is refused (or skipped) like any other sample.
            if (!nextSampleStatus('return', copy.status)) {
              throw new InvalidSampleTransitionException('return', copy.status);
            }
            returnedOriginIds.push(
              await this.returnCopyToOrigin(
                tx,
                tenantId,
                personId,
                copy.id,
                reason,
              ),
            );
            // Keep the transfer row in step (no-op if it is already closed).
            await tx.sampleTransfer.updateMany({
              where: {
                id: copy.sourceTransferId!,
                tenantId,
                deletedAt: null,
                transferStatus: TransferStatus.ACCEPTED,
              },
              data: {
                transferStatus: TransferStatus.REPEAT,
                repeatReason: reason,
                updatedBy: personId,
              },
            });
          } catch (e) {
            if (skipInvalid && e instanceof InvalidSampleTransitionException) {
              skippedCopies.push({
                id: copy.id,
                accessionNo: copy.accessionNo ?? null,
                reason: refusalMessage(e),
                code: e.errorCode,
              });
              continue;
            }
            throw e;
          }
        }
      });
    }
    await this.notifySamplesRepeated(tenantId, returnedOriginIds);
    const copyIds = new Set(copies.map((c) => c.id));
    const restIds = ids.filter((id) => !copyIds.has(id));
    const rest: BulkActionResult<OrderSampleWithRelations> =
      restIds.length > 0
        ? await this.transitionIds(
            restIds,
            tenantId,
            personId,
            'return',
            () => ({
              data: dto.handoverPerson
                ? { logisticsPerson: dto.handoverPerson }
                : {},
            }),
            dto,
          )
        : { succeeded: [], skipped: [] };
    // A returned copy is voided, so report the sender's original sample that went
    // to REPEAT in its place — one entry per processed id.
    const returned = await Promise.all(
      returnedOriginIds.map((id) => this.findById(id, tenantId)),
    );
    return {
      succeeded: [...returned, ...rest.succeeded],
      skipped: [...skippedCopies, ...rest.skipped],
    };
  }

  /** Cancel — New/Collected/Hold → Cancelled (records the cancellation reason). */
  async cancel(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: CancelSampleDto,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
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
    actingBranchId: string | null,
    dto: RetrieveSampleDto,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    await this.assertRetrieverIsSender(ids, tenantId, actingBranchId);
    return this.transitionIds(
      ids,
      tenantId,
      personId,
      'retrieve',
      // Record the station/lab the sample was retrieved from on the history row's
      // `reason` (the shared Notes + Attachment ride along via the note arg).
      () => ({
        data: {},
        ...(dto.retrievedFrom ? { reason: dto.retrievedFrom } : {}),
      }),
      dto,
    );
  }

  /**
   * Only the SENDING branch can pull back a sample it sent to another branch. A
   * sample that is out at another branch (SENT_INTERNAL) is held by the branch
   * that sent it, so the caller's active branch must be that branch. Always an
   * error, never a "skip", so a group Retrieve cannot touch another branch's
   * samples. Other samples are unaffected.
   * @throws TransferWrongBranchException
   */
  private async assertRetrieverIsSender(
    ids: string[],
    tenantId: string,
    actingBranchId: string | null,
  ): Promise<void> {
    const sent = await this.prisma.withTenant(tenantId, (tx) =>
      tx.orderSample.findMany({
        where: {
          id: { in: ids },
          tenantId,
          deletedAt: null,
          status: SampleStatus.SENT_INTERNAL,
        },
        select: { id: true, branchId: true },
      }),
    );
    const foreign = sent.find((s) => s.branchId !== actingBranchId);
    if (foreign) {
      throw new TransferWrongBranchException(foreign.id, 'retrieve', 'sender');
    }
  }

  // ── No-status-change mutations (§A.10.2 / §A.10.3) ─────────────────────────

  /**
   * Assign / Edit Barcode (§A.10.2) — available at any status, no status change.
   * Assigns ONE shared barcode to **every** id (the FE passes a whole group's
   * sample ids): the typed `dto.barcode` when supplied, otherwise the next
   * system-sequential value from the branch counter (which skips any value
   * already taken). A manual value is rejected when already used by a sample
   * outside this group. A single Code 39 image is rendered and uploaded to S3,
   * and all members are updated to the shared `barcode` + `orderIdBarcode` in one
   * transaction (all-or-none). A failed render/upload rolls the whole assignment
   * back (fail-together).
   * @throws OrderSampleNotFoundException if any id is missing / other-tenant
   * @throws ValidationException if a manual barcode is already in use
   */
  async assignBarcode(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: AssignBarcodeDto,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    if (ids.length === 0) return { succeeded: [], skipped: [] };
    const changed = await this.prisma.withTenant(tenantId, async (tx) => {
      const samples = await tx.orderSample.findMany({
        where: { id: { in: ids }, tenantId, deletedAt: null },
        select: {
          id: true,
          status: true,
          branchId: true,
          barcode: true,
          orderId: true,
        },
      });
      const found = new Set(samples.map((s) => s.id));
      const missing = ids.find((id) => !found.has(id));
      if (missing) throw new OrderSampleNotFoundException(missing);
      // A cancelled order's samples are frozen - the barcode stays as it is.
      for (const s of samples) {
        if (await this.isOrderCancelled(tx, tenantId, s.orderId)) {
          throw new SampleOrderCancelledException('assign-barcode', s.status);
        }
      }

      const branchId = samples[0]?.branchId ?? null;
      let value: string;
      // A transferred copy inherits its sender's barcode (same physical tube), so
      // that value legitimately exists on another sample. Saving it again changes
      // nothing, so it is not a clash — only a value the selection does not
      // already carry is checked for availability.
      const unchanged =
        !!dto.barcode && samples.every((s) => s.barcode === dto.barcode);
      if (dto.barcode) {
        // A manually-entered barcode must be free across the tenant: reject when
        // any sample OUTSIDE the current group already carries it. Re-assigning
        // the same value to this same group stays allowed (idempotent edit).
        const clash = unchanged
          ? null
          : await tx.orderSample.findFirst({
              where: {
                tenantId,
                barcode: dto.barcode,
                deletedAt: null,
                id: { notIn: ids },
              },
              select: { id: true },
            });
        if (clash) {
          throw new ValidationException(
            `Barcode "${dto.barcode}" is already in use.`,
          );
        }
        value = dto.barcode;
      } else if (branchId) {
        value = await this.barcodeService.allocateNumberInTx(
          tx,
          tenantId,
          branchId,
        );
      } else {
        throw new ValidationException(
          'Auto-generating a barcode requires the sample to belong to a branch.',
        );
      }
      const url = await this.barcodeService.generateAndUpload(value, tenantId);

      await tx.orderSample.updateMany({
        where: { id: { in: ids }, tenantId },
        data: { barcode: value, orderIdBarcode: url, updatedBy: personId },
      });
      for (const sample of samples) {
        await tx.orderSampleStatusHistory.create({
          data: {
            tenantId,
            branchId: sample.branchId,
            sampleId: sample.id,
            action: 'assign-barcode',
            toStatus: sample.status,
            fromStatus: sample.status,
            changedBy: personId,
          },
        });
      }
      return ids;
    });
    // Barcode assignment performs no status transition, so nothing is ever
    // skipped — `skipped` is returned empty for the uniform bulk-result contract.
    const succeeded = await Promise.all(
      changed.map((id) => this.findById(id, tenantId)),
    );
    return { succeeded, skipped: [] };
  }

  /**
   * Append a no-status-change history row (note + optional attachment) to a
   * sample inside an existing, already tenant-scoped transaction. Used by
   * transfer-side actions that carry the shared optional notes/attachment but
   * perform no sample status transition (e.g. Assign Center §A.7), mirroring how
   * `dispatch` records them on the sample via `transitionInTx`. No-ops when
   * neither a note nor an attachment was supplied so an empty modal leaves no
   * history noise.
   * @throws OrderSampleNotFoundException if the sample is missing/soft-deleted
   */
  async recordNoteInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    sampleId: string,
    action: string,
    note: { notes?: string; attachmentUrl?: string },
  ): Promise<void> {
    if (!note.notes && !note.attachmentUrl) return;
    const sample = await tx.orderSample.findFirst({
      where: { id: sampleId, tenantId, deletedAt: null },
    });
    if (!sample) throw new OrderSampleNotFoundException(sampleId);
    await tx.orderSampleStatusHistory.create({
      data: {
        tenantId,
        branchId: sample.branchId,
        sampleId: sample.id,
        action,
        toStatus: sample.status,
        fromStatus: sample.status,
        notes: note.notes ?? null,
        attachmentUrl: note.attachmentUrl ?? null,
        changedBy: personId,
      },
    });
  }

  /**
   * Update Sample (§A.10.3) — records a note/attachment with no status change.
   * Refused on a cancelled order (its samples are frozen; the legacy system had no
   * way to add a sample note after a cancel either). Share & Inform is NOT refused:
   * telling the patient about a cancelled order is a real use, as in legacy.
   * @throws SampleOrderCancelledException if a sample's order is cancelled
   */
  async updateNotes(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: SampleNoteDto,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    return this.mutateIds(
      ids,
      tenantId,
      personId,
      'update',
      () => ({ data: {} }),
      dto,
      async (tx, sample) => {
        if (await this.isOrderCancelled(tx, tenantId, sample.orderId)) {
          throw new SampleOrderCancelledException('update', sample.status);
        }
      },
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
    const {
      succeeded: [sample],
    } = await this.mutateIds(
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

    // A cancelled order's samples are frozen - except the wind-down of a sample
    // that is out at another branch: the sender's Retrieve, the receiving branch's
    // Store / Discard of its own copy, and the system-driven moves that the receiving
    // branch's Reject / Repeat / Return trigger (`note.system`). Everything else is
    // refused.
    if (
      !note.system &&
      !this.isCancelledOrderWindDown(action, sample) &&
      (await this.isOrderCancelled(tx, tenantId, sample.orderId))
    ) {
      throw new SampleOrderCancelledException(action, sample.status);
    }

    // A sample sent to another branch of the tenant is out of this branch's
    // hands: the ONLY user action that may touch it is Retrieve (and only before
    // the receiving branch has received it — checked below). This guard runs
    // before the `force` override, so a group "force" action cannot bypass it.
    if (
      sample.status === SampleStatus.SENT_INTERNAL &&
      action !== 'retrieve' &&
      !note.system
    ) {
      throw new SampleSentToBranchException(action, sample.status);
    }

    // Group status actions force a direct override: the sample is moved to the
    // action's fixed target status regardless of its current status (no legality
    // check). `retrieve` and `return` have no forced target (see FORCE_TARGET), so
    // they keep the normal legality check — a Collected sample can never be Returned.
    const forced = note.force ? FORCE_TARGET[action] : undefined;

    // The receiving branch sent this sample back (REPEAT with a SENT_INTERNAL
    // previous status): nothing to pull back — the sender collects it again. Checked
    // before the target is worked out, so it is reported as such instead of as a
    // generic invalid transition.
    if (
      action === 'retrieve' &&
      sample.status !== SampleStatus.SENT_INTERNAL &&
      sample.previousStatus === SampleStatus.SENT_INTERNAL &&
      nextSampleStatus('retrieve', sample.status) === null
    ) {
      throw new RetrieveBlockedException(sample.status, 'RETURNED');
    }

    let toStatus: SampleStatus | null;
    if (forced) {
      toStatus = forced;
    } else if (action === 'retrieve' && isTransferredStatus(sample.status)) {
      // A sample that is out at another branch / partner goes back to the status it
      // had before it was sent (a group "force" send can leave a NEW / COLLECTED
      // sample at the other branch - pulling it back must not skip its steps).
      toStatus = this.retrieveTarget(sample);
    } else if (action === 'retrieve') {
      // Revert to the sample's immediately-previous status from its OWN history:
      // the `fromStatus` of the most recent NON-retrieve transition INTO the
      // current status. Repeated retrieves therefore walk back the real timeline
      // (New → Collected → Accepted ⇒ Accepted → Collected → New), instead of
      // oscillating on the single `previousStatus` column. Falls back to the §A.9
      // transfer-return target, then `null`: a sample with no prior history (just
      // created, or already back at its first status) yields an "invalid"
      // transition, so bulk `skipInvalid` skips it gracefully — no-op, no loop —
      // rather than forcing a hardcoded previous status.
      const prevRow = await tx.orderSampleStatusHistory.findFirst({
        where: {
          sampleId: sample.id,
          tenantId,
          deletedAt: null,
          toStatus: sample.status,
          // Only a genuine MOVEMENT into the current status counts — not a prior
          // retrieve (which would walk back up), and not a no-status-change row
          // (assign-barcode / update notes / share all record toStatus ==
          // fromStatus == current). `{ not: current }` on the nullable fromStatus
          // also drops the `generate` row (fromStatus = null), so a freshly-created
          // sample correctly yields no previous status. Mirrors findHistory's
          // movement filter so the UI's shown "New Status" matches what happens.
          fromStatus: { not: sample.status },
          action: { not: 'retrieve' },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { fromStatus: true },
      });
      toStatus =
        prevRow?.fromStatus ?? nextSampleStatus('retrieve', sample.status);
    } else {
      toStatus = nextSampleStatus(action, sample.status);
    }
    if (!toStatus) {
      throw new InvalidSampleTransitionException(action, sample.status);
    }

    // Retrieve is the universal undo, but it may not pull a sample (that is at this
    // branch) back to BEFORE its acceptance while a test on it already has a
    // validated result: the sample would say "not accepted yet" next to a result
    // that is done. Same rule as Repeat. A sample that is out at another branch
    // keeps its own transfer rules below, and an undo that stays at or after
    // acceptance (Stored -> Accepted, Halted -> Accepted, ...) is not affected.
    if (
      action === 'retrieve' &&
      !note.system &&
      !isTransferredStatus(sample.status) &&
      PRE_ACCEPT_SAMPLE_STATUSES.includes(toStatus)
    ) {
      await this.assertNoValidatedResultForRetrieve(tx, tenantId, sample);
    }

    if (action === 'retrieve') {
      // Internal transfers can be recalled only until the receiving branch has
      // received them. Checked before AND after the recall so a concurrent
      // receive/accept cannot slip through (the receive/accept update is
      // conditional on the transfer status — see SampleTransferService).
      const assertNotReceived = async (): Promise<void> => {
        const progressed = await tx.sampleTransfer.findFirst({
          where: {
            sampleId: sample.id,
            tenantId,
            deletedAt: null,
            kind: TransferKind.INTERNAL,
            transferStatus: {
              in: [TransferStatus.RECEIVED, TransferStatus.ACCEPTED],
            },
          },
          select: { id: true },
        });
        if (progressed) {
          throw new RetrieveBlockedException(sample.status, 'RECEIVED');
        }
      };
      await assertNotReceived();
      // INTERNAL transfer: close only the OPEN transfer (never an earlier cycle's
      // finished one). The row stays as REJECTED "Recalled via Retrieve" so both
      // branches keep the history and the receiving branch / courier sees it was
      // called back. A Forwarded / Outsourced sample is different: its transfer is
      // unwound by the recall below (main's cleanup), not closed here.
      await tx.sampleTransfer.updateMany({
        where: {
          sampleId: sample.id,
          tenantId,
          deletedAt: null,
          kind: TransferKind.INTERNAL,
          transferStatus: {
            in: [TransferStatus.IN_TRANSIT, TransferStatus.PICKED_UP],
          },
        },
        data: {
          transferStatus: TransferStatus.REJECTED,
          rejectionReason: 'Recalled via Retrieve',
          updatedBy: personId,
        },
      });
      await assertNotReceived();
    }

    // A user's Repeat starts the report over: the new tube must not inherit the
    // old tube's values. Refused first when the result is already validated.
    // (The system-driven Repeat from a receiving branch's return resets the
    // report itself, in returnCopyToOrigin.)
    const repeatReportIds =
      action === 'repeat' && !note.system
        ? await this.reportsToResetOnRepeat(tx, tenantId, sample)
        : [];

    // Claim the row on the status we validated against. Two concurrent requests
    // (double-click Send / Accept / Retrieve) both read the same status; the
    // second blocks on this row lock until the first commits, then re-checks the
    // status and matches nothing — so exactly one wins and the other is refused
    // instead of repeating the transition (a second transfer / history row).
    const claimed = await tx.orderSample.updateMany({
      where: {
        id: sample.id,
        tenantId,
        status: sample.status,
        deletedAt: null,
      },
      data: { updatedBy: personId },
    });
    if (claimed.count !== 1) {
      throw new InvalidSampleTransitionException(action, sample.status);
    }

    // Leaving a transferred status (Retrieve, the sender's Repeat, or the system
    // move a receiving branch's Reject / Repeat / Return triggers) puts the sample
    // back at its origin: the processing branch and dispatch fields are reset below.
    const recalling =
      isTransferredStatus(sample.status) && !isTransferredStatus(toStatus);
    // The sender pulling a Forwarded / Outsourced sample back (Retrieve or Repeat):
    // unwind the transfer fully so no stale record is left (see
    // recallTransfersForSampleInTx). A Retrieve of a Sent (INTERNAL) sample is NOT
    // recalled this way: it closes its own open transfer above (kept as REJECTED
    // history), and the system-driven moves must NOT run this either - a receiving
    // branch's Reject / Repeat / Return closes the transfer itself
    // (SampleTransferService.transferAction / returnCopyToOrigin) right after.
    if (
      recalling &&
      !note.system &&
      (action !== 'retrieve' || sample.status !== SampleStatus.SENT_INTERNAL)
    ) {
      await this.recallTransfersForSampleInTx(tx, tenantId, personId, sample);
    }

    const built = build(sample);
    const originBranch = sample.originBranchId ?? sample.branchId;
    const updated = await tx.orderSample.update({
      where: { id: sample.id },
      data: {
        ...built.data,
        status: toStatus,
        previousStatus: sample.status,
        // A recalled sample is processed at its origin again: revert the processing
        // branch (set to the destination on Send / Assign Center) and clear the
        // now-void dispatch fields so the origin branch's list is accurate.
        ...(recalling
          ? {
              processingBranchId: originBranch,
              dispatchedAt: null,
              logisticsType: null,
              logisticsPerson: null,
            }
          : {}),
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
    if (repeatReportIds.length > 0) {
      await this.labReportService.resetReportsForReturn(
        tx,
        tenantId,
        repeatReportIds,
        personId,
      );
    }
    return updated;
  }

  /**
   * Refuses a Retrieve that would take this sample back to before its acceptance
   * while a report it serves has a validated result (Result Done, Approved or
   * Published). The reports are locked first (the same fixed-order lock Repeat
   * takes), so a validation in flight cannot slip in after the answer. Nothing is
   * changed or deleted: results that are not validated yet stay saved (and are
   * write-locked while the sample waits to be accepted again).
   * @throws SampleRetrieveBlockedByResultException if a report's result is validated
   */
  private async assertNoValidatedResultForRetrieve(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sample: OrderSample,
  ): Promise<void> {
    const tests = await tx.orderSampleTest.findMany({
      where: { sampleId: sample.id, tenantId, deletedAt: null },
      select: { orderItemId: true, labTestId: true },
    });
    const reportIds = await this.labReportService.findReportIdsForSampleTests(
      tx,
      tenantId,
      sample.branchId,
      tests,
    );
    await this.labReportService.lockReports(tx, tenantId, reportIds);
    if (
      !(await this.labReportService.canReturnToSender(tx, tenantId, reportIds))
    ) {
      throw new SampleRetrieveBlockedByResultException(sample.status);
    }
  }

  /**
   * The reports a Repeat of this sample (at its own branch) starts over, checked
   * and locked before the sample changes. A report whose result is already
   * validated (Result Done, Approved, Published) refuses the Repeat — it would wipe
   * a validated result; the lab uses Re-run for that. The reports are locked first
   * so a validation in flight cannot slip in after the answer.
   * @throws SampleRepeatBlockedException if a report's result is validated
   */
  private async reportsToResetOnRepeat(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sample: OrderSample,
  ): Promise<string[]> {
    const tests = await tx.orderSampleTest.findMany({
      where: { sampleId: sample.id, tenantId, deletedAt: null },
      select: { orderItemId: true, labTestId: true },
    });
    const reportIds = await this.labReportService.findReportIdsForSampleTests(
      tx,
      tenantId,
      sample.branchId,
      tests,
    );
    await this.labReportService.lockReports(tx, tenantId, reportIds);
    if (
      !(await this.labReportService.canReturnToSender(tx, tenantId, reportIds))
    ) {
      throw new SampleRepeatBlockedException(sample.status);
    }
    return reportIds;
  }

  /**
   * Where Retrieve puts a transferred sample back: the status it had before it
   * was sent (a group "force" send can leave a NEW / COLLECTED sample at the
   * other branch — pulling it back must not skip its collect / accept steps).
   * Falls back to the transition table (ACCEPTED) when there is no usable
   * previous status.
   */
  private retrieveTarget(sample: OrderSample): SampleStatus | null {
    const tableTarget = nextSampleStatus('retrieve', sample.status);
    const transferred: SampleStatus[] = [
      SampleStatus.SENT_INTERNAL,
      SampleStatus.FORWARD_EXTERNAL,
      SampleStatus.OUTSOURCED,
    ];
    const prev = sample.previousStatus;
    if (
      tableTarget &&
      transferred.includes(sample.status) &&
      prev &&
      !transferred.includes(prev) &&
      prev !== SampleStatus.CANCELLED &&
      prev !== SampleStatus.DISCARDED
    ) {
      return prev;
    }
    return tableTarget ?? prev;
  }

  /**
   * Recall every outstanding transfer of a sample that is being pulled back from a
   * transferred status (Retrieve / Repeat). For each non-deleted transfer:
   *  - if it was an accepted INTERNAL transfer (a clone exists in the receiving
   *    branch's In-House list), soft-delete that clone and move its lab report(s)
   *    back to the origin branch (see {@link removeTransferCloneInTx}); then
   *  - soft-delete the transfer itself, so it disappears from BOTH branches'
   *    referral / outsource queues (`findTransfers` filters `deletedAt: null`).
   * Runs inside the caller's transaction so the sample revert + the cross-branch
   * cleanup commit atomically.
   * @param tx the caller's (tenant-scoped) transaction
   * @param tenantId the current tenant
   * @param personId the acting person (for `updatedBy`)
   * @param sample the source sample being recalled (its branch is the origin)
   */
  private async recallTransfersForSampleInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    sample: OrderSample,
  ): Promise<void> {
    const originBranch = sample.originBranchId ?? sample.branchId;
    const transfers = await tx.sampleTransfer.findMany({
      where: { sampleId: sample.id, tenantId, deletedAt: null },
    });
    const now = new Date();
    for (const transfer of transfers) {
      if (transfer.clonedSampleId) {
        await this.removeTransferCloneInTx(
          tx,
          tenantId,
          personId,
          transfer.clonedSampleId,
          originBranch,
        );
      }
      await tx.sampleTransfer.update({
        where: { id: transfer.id },
        data: {
          deletedAt: now,
          rejectionReason: transfer.rejectionReason ?? 'Recalled via Retrieve',
          updatedBy: personId,
        },
      });
    }
  }

  /**
   * Unwind the clone an accepted INTERNAL transfer created in the receiving branch
   * (RULE 1): (1) recursively recall the clone's OWN outstanding transfers — so a
   * chained transfer (A→B→C) is cleaned up all the way down, not just one hop;
   * (2) move its lab report(s) back to the origin branch (they were re-homed to the
   * destination on accept) so the recalled origin sample keeps its report locally;
   * (3) soft-delete the clone + its tests so it leaves the receiving branch's
   * In-House list. Idempotent — a no-op if the clone is already gone. Mutually
   * recursive with {@link recallTransfersForSampleInTx}; terminates because clone
   * links form a tree (each transfer materialises at most one, newly-created clone).
   * @param tx the caller's transaction
   * @param tenantId the current tenant
   * @param personId the acting person (for `updatedBy`)
   * @param cloneId the destination-branch clone sample id
   * @param originBranch the TRUE origin branch to re-home the clone's report(s) to
   *
   * Public so `SampleTransferService` can reuse it to unwind the clone when an
   * accepted INTERNAL transfer is Rejected (reject-after-accept, §B.10).
   */
  async removeTransferCloneInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    cloneId: string,
    originBranch: string | null,
  ): Promise<void> {
    const clone = await tx.orderSample.findFirst({
      where: { id: cloneId, tenantId, deletedAt: null },
    });
    if (!clone) return; // already removed / never cloned

    // Chained transfer: if this clone was itself forwarded onward (B→C), recall
    // those transfers too (recursively removing their clones). The clone carries
    // the TRUE origin in `originBranchId` (propagated at clone time), so reports
    // all flow back to the original origin branch.
    await this.recallTransfersForSampleInTx(tx, tenantId, personId, clone);

    // Move the clone's report(s) back to the origin before soft-deleting the tests
    // they're resolved from (rehome reads the clone's OrderSampleTest rows).
    if (originBranch) {
      await this.rehomeLabReportsForSample(tx, tenantId, cloneId, originBranch);
    }

    const now = new Date();
    await tx.orderSampleTest.updateMany({
      where: { sampleId: cloneId, tenantId, deletedAt: null },
      data: { deletedAt: now },
    });
    await tx.orderSample.update({
      where: { id: cloneId },
      data: { deletedAt: now, updatedBy: personId },
    });
  }

  /**
   * Apply a validated §A.9 transition to each id inside one tenant-scoped
   * transaction (loops `transitionInTx`). Strict bulk is all-or-nothing; with
   * `note.skipInvalid` (group / multi-select actions) a sample not in a legal
   * state is skipped and recorded in the result's `skipped` list instead of
   * failing the whole batch. Returns the changed rows + the skipped ids so the
   * FE can report successes and skips separately.
   * @param afterInTx optional batch step run once, inside the same transaction,
   *   with the ids that actually transitioned (e.g. collect → assign a
   *   grouping-aware barcode across the whole collected set in one shot).
   * @throws OrderSampleNotFoundException / InvalidSampleTransitionException
   * @throws AccessionNumberConflictException on a barcode clash
   */
  private async transitionIds(
    ids: string[],
    tenantId: string,
    personId: string | null,
    action: SampleAction,
    build: (sample: OrderSample) => ActionPatch,
    note: ActionNote = {},
    afterInTx?: (
      tx: Prisma.TransactionClient,
      changedIds: string[],
    ) => Promise<void>,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    const skipped: BulkSkippedItem[] = [];
    let changed: string[];
    try {
      changed = await this.prisma.withTenant(tenantId, async (tx) => {
        // Pre-read id → accession/status so a skipped sample can be named in the
        // result (its accession number + why) without a per-skip query. Only the
        // `skipInvalid` path ever skips (and reads this), so single / strict bulk
        // actions don't pay for the lookup. A skipped sample is never transitioned,
        // so its status is still accurate when the loop reaches it.
        const metaById = new Map<
          string,
          { id: string; accessionNo: string; status: SampleStatus }
        >();
        if (note.skipInvalid) {
          const metaRows = await tx.orderSample.findMany({
            where: { id: { in: ids }, tenantId, deletedAt: null },
            select: { id: true, accessionNo: true, status: true },
          });
          for (const r of metaRows) metaById.set(r.id, r);
        }
        const done: string[] = [];
        // One fixed order (ascending id) so overlapping group requests cannot deadlock;
        // `done` and `skipped` are put back in the request's order below.
        for (const id of inLockOrder(ids)) {
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
            // Group / multi-select actions ("skip invalid"): skip a sample that
            // is not in a legal state for this action — recording it in `skipped`
            // so the FE can name it — and surface everything else.
            if (
              note.skipInvalid &&
              e instanceof InvalidSampleTransitionException
            ) {
              const meta = metaById.get(id);
              skipped.push({
                id,
                accessionNo: meta?.accessionNo ?? null,
                code: e.errorCode,
                // A refusal that carries its own explanation (a validated result)
                // is shown as such, not as the generic "not allowed from status".
                // The refusal's own sentence (cancelled order, nothing to retrieve,
                // result already done ...); a plain refusal's sentence is the
                // generic "not allowed from status X".
                reason: refusalMessage(e),
              });
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
        const inAskedOrder = inRequestOrder(done, ids, (x) => x);
        if (afterInTx) await afterInTx(tx, inAskedOrder);
        return inAskedOrder;
      });
    } catch (e) {
      this.rethrowConflict(e);
      throw e;
    }
    const succeeded = await Promise.all(
      changed.map((id) => this.findById(id, tenantId)),
    );
    return { succeeded, skipped: inRequestOrder(skipped, ids, (x) => x.id) };
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
   *
   * Bug fix: for a PANEL order item, `OrderSampleTest.labTestId` records
   * which specific (panel-expanded) member test THIS sample serves — passed
   * through to `ensureCreatedForAcceptedItem` so it creates a report for only
   * that one member. Previously this wasn't passed at all, so accepting any
   * ONE of a panel's several member-test samples (each member test gets its
   * own independent `OrderSample` — see the panel-restructure doc comment on
   * `LabReport`) created LabReports for EVERY member test in the panel at
   * once, including members whose own sample was still NEW/uncollected —
   * those reports then sat at PENDING (or were progressed further) with no
   * physical sample ever accepted for them. Confirmed live 2026-09-08: a
   * panel order with 3 member tests, only 1 sample accepted, produced 3
   * LabReports instead of 1.
   */
  async ensureLabReportsForAcceptedSample(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sampleId: string,
    acceptedBy: string | null,
  ): Promise<void> {
    const sampleTests = await tx.orderSampleTest.findMany({
      where: { sampleId, tenantId, deletedAt: null },
      select: { orderItemId: true, labTestId: true },
    });
    for (const { orderItemId, labTestId } of sampleTests) {
      await this.labReportService.ensureCreatedForAcceptedItem(
        tenantId,
        orderItemId,
        tx,
        acceptedBy,
        labTestId,
      );
    }
  }

  /**
   * Re-home the LabReports of a just-cloned transferred sample to its new
   * (receiving) branch — the RULE 1 sibling of
   * {@link ensureLabReportsForAcceptedSample}. On an internal branch transfer
   * the sample's LabReport already exists at the origin branch (created during
   * the origin accept), so `ensureLabReportsForAcceptedSample`'s idempotent
   * create is a no-op; this moves that report to the destination branch so it
   * surfaces in the receiving branch's Technician worklist. Iterates the
   * cloned sample's `OrderSampleTest` rows so a panel's transferred member
   * moves only its own report. Runs inside the transfer-accept transaction.
   * @param tx the caller's transaction
   * @param tenantId the current tenant
   * @param sampleId the cloned (destination-branch) sample
   * @param destBranchId the receiving branch to move the report(s) to
   * @param fromBranchId the sending branch (only reports it still holds move)
   */
  async rehomeLabReportsForSample(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sampleId: string,
    destBranchId: string,
    fromBranchId?: string | null,
  ): Promise<void> {
    const sampleTests = await tx.orderSampleTest.findMany({
      where: { sampleId, tenantId, deletedAt: null },
      select: { orderItemId: true, labTestId: true },
    });
    for (const { orderItemId, labTestId } of sampleTests) {
      await this.labReportService.rehomeReportsForAcceptedItem(
        tx,
        tenantId,
        orderItemId,
        destBranchId,
        labTestId,
        fromBranchId,
      );
    }
  }

  /**
   * Apply a no-status-change mutation (update notes / share) to each id in one
   * transaction, appending a history row that keeps the current status.
   * @param guard optional per-sample refusal, run before anything is written
   * @throws OrderSampleNotFoundException / AccessionNumberConflictException
   */
  private async mutateIds(
    ids: string[],
    tenantId: string,
    personId: string | null,
    action: string,
    build: (sample: OrderSample) => ActionPatch,
    note: ActionNote,
    guard?: (
      tx: Prisma.TransactionClient,
      sample: OrderSample,
    ) => Promise<void>,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    let changed: string[];
    try {
      changed = await this.prisma.withTenant(tenantId, async (tx) => {
        const done: string[] = [];
        // One fixed order (ascending id): see `transitionIds`.
        for (const id of inLockOrder(ids)) {
          const sample = await tx.orderSample.findFirst({
            where: { id, tenantId, deletedAt: null },
          });
          if (!sample) throw new OrderSampleNotFoundException(id);
          // A caller's refusal (e.g. a cancelled order), before anything is written;
          // it aborts the whole transaction, so a group is all-or-nothing.
          if (guard) await guard(tx, sample);
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
        return inRequestOrder(done, ids, (x) => x);
      });
    } catch (e) {
      this.rethrowConflict(e);
      throw e;
    }
    // No-status-change mutations never skip (a missing id throws), so `skipped`
    // is always empty — returned for a uniform bulk-result contract.
    const succeeded = await Promise.all(
      changed.map((id) => this.findById(id, tenantId)),
    );
    return { succeeded, skipped: [] };
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
    scopeIds: string[],
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
    if (query.internalReferralId) {
      order.internalReferralId = query.internalReferralId;
    }
    if (query.externalReferralId) {
      order.externalReferralId = query.externalReferralId;
    }
    if (query.internalReferralBranchId) {
      order.internalReferral = {
        is: { branchId: query.internalReferralBranchId },
      };
    }
    if (query.externalReferralOrganisation) {
      order.externalReferral = {
        is: {
          organisationName: {
            equals: query.externalReferralOrganisation,
            mode: 'insensitive',
          },
        },
      };
    }

    const and: Prisma.OrderSampleWhereInput[] = [];
    if (query.search) {
      const s = query.search;
      and.push({
        OR: [
          { accessionNo: { contains: s, mode: 'insensitive' } },
          { barcode: { contains: s, mode: 'insensitive' } },
          {
            order: {
              is: {
                patient: {
                  is: {
                    OR: [
                      { firstName: { contains: s, mode: 'insensitive' } },
                      { middleName: { contains: s, mode: 'insensitive' } },
                      { lastName: { contains: s, mode: 'insensitive' } },
                      { umId: { contains: s, mode: 'insensitive' } },
                      { mobile: { contains: s, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            },
          },
        ],
      });
    }
    if (query.isOutsource) and.push({ status: SampleStatus.OUTSOURCED });
    if (query.outsourceCenterId) {
      and.push({
        transfers: {
          some: {
            deletedAt: null,
            kind: TransferKind.OUTSOURCE,
            outsourceCenterId: query.outsourceCenterId,
          },
        },
      });
    }
    // Send / Forward / Outsource date: the sample has a transfer of that kind
    // dispatched on the chosen day (its `sendDate`, else when it was created).
    for (const [kind, day] of [
      [TransferKind.INTERNAL, query.sendDate],
      [TransferKind.EXTERNAL, query.forwardDate],
      [TransferKind.OUTSOURCE, query.outsourceDate],
    ] as const) {
      if (day) and.push(this.transferOnDay(kind, day));
    }
    if (query.isUrgent) {
      and.push({
        OR: [
          { priority: { in: [SamplePriority.URGENT, SamplePriority.STAT] } },
          { order: { is: { isUrgentBill: true } } },
        ],
      });
    }
    this.applyOrderMode(query.orderMode, order, and);

    // Department visibility scope (mandatory, not a user filter): a sample is
    // visible when its department is unassigned (NULL → everyone) or one of the
    // caller's mapped departments. Pushed into `and` so it never clobbers the
    // search/urgent/outsource conditions and is applied before pagination.
    and.push(this.departmentScopeForSamples(scopeIds));

    if (Object.keys(order).length > 0) where.order = order;
    if (and.length > 0) where.AND = and;
    return where;
  }

  /**
   * "Has a `kind` transfer dispatched on `day`" (YYYY-MM-DD, whole day). Uses the
   * transfer's `sendDate`, falling back to `createdAt` when no send date was set.
   */
  private transferOnDay(
    kind: TransferKind,
    day: string,
  ): Prisma.OrderSampleWhereInput {
    const range = timestampRange(day, day);
    return {
      transfers: {
        some: {
          deletedAt: null,
          kind,
          OR: [{ sendDate: range }, { sendDate: null, createdAt: range }],
        },
      },
    };
  }

  /**
   * The department-visibility condition for `OrderSample.departmentId` (a
   * denormalized, indexed snapshot): unassigned rows (NULL) are visible to all;
   * an empty scope (user with no department) therefore sees only unassigned rows.
   * @param scopeIds the caller's department ids (see UserDepartmentScopeService)
   */
  private departmentScopeForSamples(
    scopeIds: string[],
  ): Prisma.OrderSampleWhereInput {
    return scopeIds.length > 0
      ? { OR: [{ departmentId: null }, { departmentId: { in: scopeIds } }] }
      : { departmentId: null };
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
    sampleFlow: boolean,
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
        sampleFlow,
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
        sampleFlow,
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
