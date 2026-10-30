import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AccessionGroupingMode,
  AppointmentStatus,
  AuditAction,
  AuditModule,
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
import { barcodeGroupKey } from './utils/barcode-group-key';
import { timestampRange } from '../../common/utils/date-range.util';
import {
  buildCollectionProgressWhere,
  deriveCollectionProgress,
  COLLECTION_WORKFLOW_ITEM_WHERE,
} from '../../common/utils/collection-progress.util';
import type { CollectionProgress } from '../../common/utils/collection-progress.util';
import {
  toBranchLocalInstant,
  formatTenantDate,
  formatTenantTime,
  patientSingleUnitAgeDisplay,
} from '../../common/utils';
import { TenantService } from '../tenant/tenant.service';
import { AppointmentService } from '../appointment/appointment.service';
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
import {
  ORDER_ITEM_REMOVED_REASON,
  RECALLED_VIA_RETRIEVE_REASON,
} from './constants/transfer-close-reasons.constant';
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
  SampleBarcodeLockedException,
  SampleItemRemovedException,
  SampleReturnOrderCancelledException,
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
import { assertDestinationOffers } from './utils/destination-offers.util';
import { escapeLike } from './utils/like-escape.util';
import {
  findPanelMemberEntryFor,
  findSampleDefinitionAt,
  findSetupAtBranch,
  type PerformingSetup,
} from './utils/performing-setup.util';
import { PRE_ACCEPT_SAMPLE_STATUSES } from '../lab-report/utils/sent-out-report.util';
import {
  branchMayRead,
  branchesWithStake,
} from './utils/branch-read-scope.util';
import { inLockOrder, inRequestOrder } from './utils/request-order.util';
import {
  findItemRemovedSampleIds,
  isAllItemsRemoved,
  isSampleItemRemoved,
} from './utils/item-removed.util';
import {
  findReceiverReturns,
  RETURNED_BY_RECEIVER_ACTION,
} from './utils/returned-by-receiver.util';
import { isHiddenFromReceiver } from './utils/receiver-visibility.util';

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
  /**
   * Server-only: the acting user's role (from the JWT), written on the Audit-log
   * entries a Retrieve of a sent sample records. Never set from a request DTO.
   */
  actor?: { roleKey: string | null; roleLabel: string | null };
}

/** An open INTERNAL transfer a Retrieve takes back, with what its audit entries say. */
interface RecalledTransfer {
  id: string;
  destinationBranchId: string | null;
  transferStatus: TransferStatus;
  logisticsType: string | null;
}

/**
 * The audit trail of a Retrieve that took a sample back from another branch before
 * that branch received it: the text added to the sender's history row and the
 * Audit-log entries (one per branch that should be able to read it).
 */
interface RecallAuditInfo {
  historyNote: string;
  entries: Array<{
    branchId: string | null;
    description: string;
    metadata: Prisma.InputJsonValue;
  }>;
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
 * The kind of hand-off a sample in a transferred status is out on (Sent → INTERNAL,
 * Forwarded → EXTERNAL, Outsourced → OUTSOURCE); `null` for any other status.
 * A recall unwinds ONLY this kind, so an older, already-closed transfer of another
 * kind (e.g. an internal A→B rejection) stays on record as history.
 */
function transferKindOutFor(status: SampleStatus): TransferKind | null {
  switch (status) {
    case SampleStatus.SENT_INTERNAL:
      return TransferKind.INTERNAL;
    case SampleStatus.FORWARD_EXTERNAL:
      return TransferKind.EXTERNAL;
    case SampleStatus.OUTSOURCED:
      return TransferKind.OUTSOURCE;
    default:
      return null;
  }
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
  private readonly logger = new Logger(OrderSampleService.name);

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
    private readonly appointmentService: AppointmentService,
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

    // Sample-Flow-No samples are auto-collected + auto-accepted below; collect their
    // ids so their grouping-aware barcodes are assigned in one batch after the loop.
    const autoCollectedIds: string[] = [];
    for (const unit of units) {
      if (!unit.sample) continue; // labTestSampleId is mandatory
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: { accessionCounter: { increment: 1 } },
        select: { accessionCounter: true },
      });
      const accessionNo = `ACC-${String(tenant.accessionCounter).padStart(5, '0')}`;
      // Sample Flow = No: the sample does NOT bypass the lab workflow — the full
      // collect → accept lifecycle is run automatically here, at order creation, so
      // the sample is born ACCEPTED with a real Collection + Acceptance time (and a
      // barcode, assigned after this loop) and proceeds straight to the technician.
      // Sample Flow = Yes (default): born NEW and follows the normal MANUAL collect →
      // accept workflow (barcode assigned when the sample is actually collected).
      const autoAccept = !unit.sampleFlow;
      // One timestamp for the auto collect + accept pair (collectedAt / receivedAt /
      // acceptedAt), mirroring the manual `collect` then `accept` transitions.
      const stampNow = autoAccept ? new Date() : null;
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
          // The status just before the final (accept) step, so a later Retrieve
          // reverts an auto-accepted sample to COLLECTED (not NEW).
          previousStatus: autoAccept ? SampleStatus.COLLECTED : null,
          collectedAt: stampNow,
          collectedBy: autoAccept ? personId : null,
          receivedAt: stampNow,
          acceptedAt: stampNow,
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
          // Record the real lifecycle so the Sample History reads coherently:
          // generate → collect → accept for a Sample-Flow-No sample; just generate
          // for a normal sample still awaiting manual collection.
          statusHistory: {
            create: autoAccept
              ? [
                  {
                    tenantId,
                    branchId,
                    action: 'generate',
                    toStatus: SampleStatus.NEW,
                    changedBy: personId,
                  },
                  {
                    tenantId,
                    branchId,
                    action: 'collect',
                    fromStatus: SampleStatus.NEW,
                    toStatus: SampleStatus.COLLECTED,
                    reason:
                      'Sample Flow = No: auto-collected at order creation',
                    changedBy: personId,
                  },
                  {
                    tenantId,
                    branchId,
                    action: 'accept',
                    fromStatus: SampleStatus.COLLECTED,
                    toStatus: SampleStatus.ACCEPTED,
                    reason: 'Sample Flow = No: auto-accepted at order creation',
                    changedBy: personId,
                  },
                ]
              : [
                  {
                    tenantId,
                    branchId,
                    action: 'generate',
                    toStatus: SampleStatus.NEW,
                    changedBy: personId,
                  },
                ],
          },
        },
        select: { id: true },
      });
      // Create the LabReport(s) for an auto-accepted sample so it surfaces in the
      // technician worklist — the same path a normal accept takes. The nested
      // `tests.create` above is already persisted, so the OrderSampleTest row
      // this reads exists.
      if (autoAccept) {
        autoCollectedIds.push(created.id);
        await this.ensureLabReportsForAcceptedSample(
          tx,
          tenantId,
          created.id,
          personId,
        );
      }
    }

    // Assign the sequential, grouping-aware barcodes to the Sample-Flow-No samples
    // auto-collected above — the SAME collect-time logic the manual collect path
    // uses (members of one grouping bucket share one barcode). A branchless order
    // has no barcode counter, so those samples stay unbarcoded for a later manual
    // Assign Barcode. This runs INSIDE the order-creation transaction, so it is
    // wrapped: a barcode-IMAGE upload failure (e.g. S3 down/unconfigured) must NEVER
    // roll back the order — the samples' collect/accept timestamps are already
    // persisted and the barcode can be assigned later. Sample Flow = Yes samples
    // stay `barcode = null` until they are actually collected.
    if (autoCollectedIds.length > 0) {
      try {
        await this.assignBarcodesOnCollectInTx(
          tx,
          tenantId,
          personId,
          autoCollectedIds,
        );
      } catch (err) {
        this.logger.warn(
          `Auto-barcode for Sample-Flow-No samples failed on order ${orderId}; left unbarcoded for manual Assign Barcode: ${String(
            err,
          )}`,
        );
      }
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
      const key = `${s.orderId}::${barcodeGroupKey(s, mode)}`;
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
      const key = `${t.orderId}::${barcodeGroupKey(t, mode)}`;
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
   * (soft-deleted + CANCELLED, open transfers closed as REJECTED "Order item
   * removed") while samples shared with a surviving test keep the sample and drop
   * only the removed test's OrderSampleTest link (soft-delete); the removed items'
   * LabReports are soft-deleted. EXCEPTION: a removed item with a report whose
   * work sits at the holder (an in-house accepted sample, or a transfer already
   * ACCEPTED at the receiving branch) is KEPT - samples, links, transfers and
   * reports untouched - and frozen by the "test removed from order" guards (the
   * removal is derived from the item's `deletedAt`). A sample still out in an
   * IN_TRANSIT / PICKED_UP / RECEIVED transfer is always cleaned up as above.
   * Kept items are untouched.
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
          branchId: true,
          status: true,
          previousStatus: true,
          sourceTransferId: true,
          tests: {
            where: { deletedAt: null },
            select: { id: true, orderItemId: true },
          },
        },
      });

      // A removed item with at least one live report (any branch) has work behind
      // it. Where that work actually sits at the holder - an in-house accepted
      // sample, or a transfer already ACCEPTED (copy + report at the receiving
      // branch) - the sample, links, transfers and reports are KEPT, frozen (the
      // removal is derived from the item's `deletedAt`). A sample still out in a
      // transfer that the receiver has not accepted (IN_TRANSIT / PICKED_UP /
      // RECEIVED) has no work at the receiver: it takes the clean-up path below,
      // report or not, exactly as before. Only an INTERNAL transfer can be "out" in
      // that sense: an outsourced / forwarded tube never reaches a branch of ours,
      // its report stays with the sender and is worked there, so its tracking status
      // (which nobody may ever click through) must not decide anything - it is kept
      // and frozen like any in-house tube.
      const reported =
        samples.length > 0
          ? await tx.labReport.findMany({
              where: {
                orderItemId: { in: removedItemIds },
                tenantId,
                deletedAt: null,
              },
              select: { orderItemId: true },
              distinct: ['orderItemId'],
            })
          : [];
      const reportedItemIds = new Set(reported.map((r) => r.orderItemId));
      const outSampleIds = new Set<string>();
      if (reportedItemIds.size > 0) {
        const out = await tx.sampleTransfer.findMany({
          where: {
            sampleId: { in: samples.map((s) => s.id) },
            tenantId,
            deletedAt: null,
            kind: TransferKind.INTERNAL,
            transferStatus: {
              in: [
                TransferStatus.IN_TRANSIT,
                TransferStatus.PICKED_UP,
                TransferStatus.RECEIVED,
              ],
            },
          },
          select: { sampleId: true },
        });
        for (const t of out) outSampleIds.add(t.sampleId);
      }
      // Removed items whose report is kept (so it must not be soft-deleted below).
      const keptItemIds = new Set<string>();

      for (const sample of samples) {
        const removedLinks = sample.tests.filter((l) =>
          removedSet.has(l.orderItemId),
        );
        const survivingLinks = sample.tests.filter(
          (l) => !removedSet.has(l.orderItemId),
        );

        // A RECEIVED COPY (the receiving branch accepted it, so its report and any
        // typed results sit with that branch) that the branch has passed on to a
        // third branch which has not accepted it yet: the work is still HERE, at the
        // branch holding the copy - not at the branch it is travelling to. So the
        // copy and its report are kept and frozen like any accepted copy; only the
        // onward hop is called off (that transfer is closed as "Order item
        // removed") and the copy goes back from Sent to the status it had before,
        // since nothing is travelling any more. Voiding the copy here would leave
        // the sender's A -> B transfer "Accepted" with no live copy.
        if (
          outSampleIds.has(sample.id) &&
          !!sample.sourceTransferId &&
          removedLinks.some((l) => reportedItemIds.has(l.orderItemId))
        ) {
          await tx.sampleTransfer.updateMany({
            where: {
              sampleId: sample.id,
              tenantId,
              deletedAt: null,
              kind: TransferKind.INTERNAL,
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
              rejectionReason: ORDER_ITEM_REMOVED_REASON,
              clonedSampleId: null,
              updatedBy: personId,
            },
          });
          if (sample.status === SampleStatus.SENT_INTERNAL) {
            const back =
              sample.previousStatus &&
              !isTransferredStatus(sample.previousStatus) &&
              sample.previousStatus !== SampleStatus.CANCELLED &&
              sample.previousStatus !== SampleStatus.DISCARDED
                ? sample.previousStatus
                : SampleStatus.ACCEPTED;
            await tx.orderSample.update({
              where: { id: sample.id },
              data: {
                status: back,
                previousStatus: SampleStatus.SENT_INTERNAL,
                processingBranchId: sample.branchId,
                dispatchedAt: null,
                logisticsType: null,
                logisticsPerson: null,
                updatedBy: personId,
                statusHistory: {
                  create: {
                    tenantId,
                    branchId: sample.branchId,
                    action: 'order-item-removed',
                    fromStatus: SampleStatus.SENT_INTERNAL,
                    toStatus: back,
                    reason: ORDER_ITEM_REMOVED_REASON,
                    changedBy: personId,
                  },
                },
              },
            });
          }
          for (const l of removedLinks) keptItemIds.add(l.orderItemId);
          continue;
        }

        // Work sits here (see above): the tube stays whole, with every removed
        // link on it (a report-less one too - it is frozen with the rest).
        if (
          !outSampleIds.has(sample.id) &&
          removedLinks.some((l) => reportedItemIds.has(l.orderItemId))
        ) {
          for (const l of removedLinks) keptItemIds.add(l.orderItemId);
          continue;
        }

        if (survivingLinks.length === 0) {
          // Sample is exclusively tied to removed items — void it. Any transfer
          // of it still open is closed too: otherwise the receiving branch keeps a
          // transfer for a sample that no longer exists (its Accept fails with
          // "sample not found", or - once ACCEPTED - it stays "Accepted" for ever
          // with no live copy and its Repeat / Reject fail). An ACCEPTED transfer's
          // copy at the receiving branch is voided by this same loop (it is linked
          // to the removed item too), so its link is cleared, as Reject-after-Accept
          // does.
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
                  TransferStatus.ACCEPTED,
                ],
              },
            },
            data: {
              transferStatus: TransferStatus.REJECTED,
              rejectionReason: ORDER_ITEM_REMOVED_REASON,
              clonedSampleId: null,
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

      // Soft-delete the LabReports of the removed order items whose work was not
      // kept above (a report-less item has none; one that was still out in an
      // unaccepted transfer has its untouched, view-only report removed as before).
      await tx.labReport.updateMany({
        where: {
          orderItemId: {
            in: removedItemIds.filter((id) => !keptItemIds.has(id)),
          },
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
   * `print`) and appends a history row. Because a sample is one physical tube
   * shared by several tests, the tests it carries are collected with it; an
   * order item is stamped collected once all of its own samples are collected
   * (a multi-tube panel only after its last tube).
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
    // A sample whose test was removed from the order is frozen (kept only for the
    // tube's wind-down), so a group / order collect passes it by instead of failing.
    const removed = await findItemRemovedSampleIds(
      tx,
      tenantId,
      samples.map((s) => s.id),
    );
    const collectable = samples.filter(
      (s) =>
        COLLECTABLE_SAMPLE_STATUSES.includes(s.status) && !removed.has(s.id),
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

    // First collection on a checked-in appointment advances its lifecycle to
    // IN_PROGRESS. Resolve the distinct orders of the just-collected samples and
    // move any linked appointment still at CHECKED_IN. Keeps the appointment
    // lifecycle in step with accession (via AppointmentService DI, CLAUDE.md #3).
    const collectedOrders = await tx.orderSample.findMany({
      where: {
        id: { in: collectable.map((s) => s.id) },
        tenantId,
        deletedAt: null,
      },
      select: { orderId: true },
    });
    const orderIds = [...new Set(collectedOrders.map((s) => s.orderId))];
    if (orderIds.length > 0) {
      const checkedInOrders = await tx.order.findMany({
        where: {
          id: { in: orderIds },
          tenantId,
          deletedAt: null,
          appointmentId: { not: null },
          appointment: { is: { status: AppointmentStatus.CHECKED_IN } },
        },
        select: { appointmentId: true, branchId: true },
      });
      for (const o of checkedInOrders) {
        if (!o.appointmentId) continue;
        await this.appointmentService.transitionStatusInTx(
          tx,
          tenantId,
          o.branchId,
          o.appointmentId,
          personId,
          AppointmentStatus.IN_PROGRESS,
          'Sample collected',
        );
      }
    }
  }

  /**
   * Collect one accession sample inside an existing (already tenant-scoped)
   * transaction: apply the §A.9 `collect` transition → `COLLECTED` (stamping
   * `collectedAt`/`collectedBy`/`tubeType`; the barcode is assigned separately,
   * grouping-aware, by the batch caller `collectSamplesInTx`), then stamp each
   * order item the sample carries as collected — but only once that item has no
   * OTHER sample still awaiting collection, so a multi-sample panel is not marked
   * collected after just its first tube. The caller must have already
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

    // A tube is drawn once → the tests it carries are collected with it. But an
    // order item (notably a panel) can span SEVERAL tubes, so it is only truly
    // collected once none of its samples remain to be drawn. Stamp each order
    // item this sample carries only when it has no OTHER sample still awaiting
    // collection — otherwise a multi-sample panel would read as collected after
    // just its first tube. The just-collected sample is already `COLLECTED` (and
    // carries `collectedAt`) at this point, so it is excluded from the pending
    // count. (`collectedAt: null` in the update guard preserves an existing stamp.)
    const siblings = await tx.orderSampleTest.findMany({
      where: { sampleId, tenantId, deletedAt: null },
      select: { orderItemId: true },
    });
    const siblingItemIds = [...new Set(siblings.map((t) => t.orderItemId))];
    for (const orderItemId of siblingItemIds) {
      const pendingSamples = await tx.orderSample.count({
        where: {
          tenantId,
          deletedAt: null,
          collectedAt: null,
          status: { in: [...COLLECTABLE_SAMPLE_STATUSES] },
          tests: { some: { orderItemId, tenantId, deletedAt: null } },
        },
      });
      if (pendingSamples > 0) continue;
      await tx.orderItem.updateMany({
        where: {
          id: orderItemId,
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
    const removedIds = await findItemRemovedSampleIds(
      this.prisma,
      tenantId,
      data.map((r) => r.id),
    );
    const named = await this.withDiscardMethods(
      tenantId,
      await this.withTransferNames(tenantId, data),
    );
    const items: OrderSampleListItem[] = named.map((row) => ({
      ...row,
      tatStatus: deriveTatStatus(row.createdAt, row.status, tat, nowMs),
      itemRemoved: removedIds.has(row.id),
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

    const { orderIds, total, rows, mode, collectionByOrderId } =
      await this.prisma.withTenant(tenantId, async (tx) => {
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

        // Order-level collection progress for the page's orders — one bounded
        // query over the workflow items' `collectedAt` (bill-only items excluded),
        // folded into collected/total per order (§A.6 "Collection Status" column).
        const itemRows =
          orderIds.length > 0
            ? await tx.orderItem.findMany({
                where: {
                  orderId: { in: orderIds },
                  tenantId,
                  deletedAt: null,
                  ...COLLECTION_WORKFLOW_ITEM_WHERE,
                },
                select: { orderId: true, collectedAt: true },
              })
            : [];
        const counts = new Map<string, { collected: number; total: number }>();
        for (const it of itemRows) {
          const c = counts.get(it.orderId) ?? { collected: 0, total: 0 };
          c.total += 1;
          if (it.collectedAt) c.collected += 1;
          counts.set(it.orderId, c);
        }
        const collectionByOrderId = new Map<string, CollectionProgress>();
        for (const [orderId, c] of counts) {
          collectionByOrderId.set(
            orderId,
            deriveCollectionProgress(c.collected, c.total),
          );
        }

        return {
          orderIds,
          total: allGroups.length,
          rows,
          mode,
          collectionByOrderId,
        };
      });

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
    // Samples whose test was removed from the order (one query for the page).
    const removedIds = await findItemRemovedSampleIds(
      this.prisma,
      tenantId,
      rows.map((r) => r.id),
    );

    // The destination / center names the "Send details" column shows (one lookup per page).
    const namedRows = await this.withDiscardMethods(
      tenantId,
      await this.withTransferNames(tenantId, rows),
    );

    // Assemble one InHouseOrderGroup per paged order id (order-first).
    const groups: InHouseOrderGroup[] = [];
    for (const orderId of orderIds) {
      const orderRows = namedRows.filter((r) => r.orderId === orderId);
      if (orderRows.length === 0) continue;
      groups.push({
        ...this.buildOrderGroup(
          orderId,
          orderRows,
          mode,
          deptNameById,
          tat,
          nowMs,
          removedIds,
        ),
        collectionStatus: collectionByOrderId.get(orderId) ?? 'PENDING',
      });
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

    const removedIds = await findItemRemovedSampleIds(
      this.prisma,
      tenantId,
      rows.map((r) => r.id),
    );

    return this.buildOrderGroup(
      orderId,
      rows,
      mode,
      deptNameById,
      tat,
      nowMs,
      removedIds,
    );
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
   * and {@link findOrderGrouped} (single order). `itemRemovedIds` are the samples
   * whose test was removed from the order (each row's `itemRemoved` flag).
   */
  private buildOrderGroup(
    orderId: string,
    orderRows: OrderSampleListRow[],
    mode: AccessionGroupingMode,
    deptNameById: Map<string, string>,
    tat: TatThresholds,
    nowMs: number,
    itemRemovedIds: ReadonlySet<string> = new Set(),
  ): InHouseOrderGroup {
    const toItem = (row: OrderSampleListRow): GroupedSampleItem => ({
      ...row,
      tatStatus: deriveTatStatus(row.createdAt, row.status, tat, nowMs),
      itemRemoved: itemRemovedIds.has(row.id),
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
      const bucketKey = barcodeGroupKey(it, mode);
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
      // Derived from the sample's own test links (already loaded): the test was
      // removed from the order when every live link belongs to a removed item.
      itemRemoved: isAllItemsRemoved(sample.tests),
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
    // A copy created by an accepted transfer is born ACCEPTED, so its single
    // `transfer-accept` row has no `fromStatus` - but it is the one fact the
    // receiving branch's trail has ("accepted from another branch"), so it is kept.
    // Likewise the sender's `returned-by-receiver` row changes no status, yet it is
    // how "the receiving branch sent it back, and why" reaches the sender's trail.
    // A transfer `retrieve` (§B.13 one-step-back undo) moves only the TRANSFER status,
    // not the sample's, so its row is from==to too - but it is a real event the trail
    // must show, so it is kept as well.
    const movements = rows.filter(
      (r) =>
        (r.fromStatus !== null && r.fromStatus !== r.toStatus) ||
        r.action === 'transfer-accept' ||
        r.action === 'retrieve' ||
        r.action === RETURNED_BY_RECEIVER_ACTION,
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

  /**
   * Error — Halt → Error. A Sent sample may be flagged Error only after the
   * receiving branch rejected it, and only by the branch that sent it:
   * `actingBranchId` (the caller's active branch) is then checked against the
   * sample's own branch, exactly like Retrieve. Omitted by internal callers.
   */
  async error(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: SampleNoteDto,
    actingBranchId?: string | null,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    if (actingBranchId !== undefined) {
      await this.assertRetrieverIsSender(
        ids,
        tenantId,
        actingBranchId,
        'error',
      );
    }
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
   * (see {@link reportsToResetOnRepeat}). A copy is voided, so the sender's
   * original (still Sent, reading "Sent – Repeated") is reported in its place.
   *
   * A Sent sample is never treated as a copy here, even if it is one (a branch that
   * received a sample and passed it on): for it, Repeat is the SENDER's confirmation
   * after the next branch sent it back (see `isSentReturnAction`), and the normal
   * path below applies the guard.
   */
  async repeat(
    ids: string[],
    tenantId: string,
    personId: string | null,
    dto: RepeatSampleDto,
    actingBranchId?: string | null,
  ): Promise<BulkActionResult<OrderSampleWithRelations>> {
    // A Sent sample may be repeated only after the receiving branch asked for a
    // repeat, and only by the branch that sent it (the caller's active branch must
    // be the sample's own branch, exactly like Retrieve). Omitted by internal callers.
    if (actingBranchId !== undefined) {
      await this.assertRetrieverIsSender(
        ids,
        tenantId,
        actingBranchId,
        'repeat',
      );
    }
    const skippedCopies: BulkSkippedItem[] = [];
    const skipInvalid = (dto as ActionNote).skipInvalid === true;
    const copies = await this.prisma.withTenant(tenantId, (tx) =>
      tx.orderSample.findMany({
        where: {
          id: { in: ids },
          tenantId,
          deletedAt: null,
          sourceTransferId: { not: null },
          status: { not: SampleStatus.SENT_INTERNAL },
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
    // A returned copy is voided, so report the sender's original sample (still Sent)
    // in its place - one entry per processed id (callers compare the count with
    // what they asked for).
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
    // The destination must offer every test on the tube (an active Lab Test List entry).
    // Without a destination (centre assigned later) the same check runs at Assign Center.
    if (destinationBranchId) {
      await assertDestinationOffers(
        tx,
        tenantId,
        [sampleId],
        destinationBranchId,
        'sender',
        sample.status,
      );
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
    await this.assertReportsUntouched(tx, tenantId, sample, 'send');
  }

  /**
   * Pre-check for Forward (partner lab) and Outsource (outsource center): like a Send
   * to another branch, the sample may only go out while the report(s) it serves have
   * not been worked on (still PENDING, no results / notes / attachments, not locked).
   * Runs inside the caller's transaction, locking the reports first. A missing
   * sample is left for `transitionInTx` to report.
   * @throws SendBlockedException for a worked-on report (skippable by group "skip
   *   invalid" actions); its message says why the sample cannot go out
   */
  async assertDispatchable(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sampleId: string,
    action: 'forward' | 'outsource',
  ): Promise<void> {
    const sample = await tx.orderSample.findFirst({
      where: { id: sampleId, tenantId, deletedAt: null },
      include: { tests: { where: { deletedAt: null } } },
    });
    if (!sample) return;
    await this.assertReportsUntouched(tx, tenantId, sample, action);
  }

  /**
   * Locks the reports the sample serves at its branch, then refuses (with a message
   * naming `action`) when any of them has been worked on. Shared by Send, Forward and
   * Outsource.
   */
  private async assertReportsUntouched(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sample: {
      branchId: string | null;
      status: SampleStatus;
      tests: Array<{ orderItemId: string; labTestId: string | null }>;
    },
    action: 'send' | 'forward' | 'outsource',
  ): Promise<void> {
    const reportIds = await this.labReportService.findReportIdsForSampleTests(
      tx,
      tenantId,
      sample.branchId,
      sample.tests,
    );
    // Lock before checking, so a technician write still in flight is seen by the
    // check (and one that starts later finds the report sent out).
    await this.labReportService.lockReports(tx, tenantId, reportIds);
    const outcome =
      action === 'send'
        ? 'sent to another branch'
        : action === 'forward'
          ? 'forwarded to a partner lab'
          : 'outsourced';
    for (const reportId of reportIds) {
      if (
        !(await this.labReportService.isReportUntouched(tx, tenantId, reportId))
      ) {
        throw new SendBlockedException(
          sample.status,
          `The report for this test has already been worked on (results, notes or attachments exist, or it is past Pending), so the sample cannot be ${outcome}.`,
          action,
        );
      }
    }
  }

  /**
   * Whether the sender may Repeat / flag Error on its Sent sample because the
   * receiving branch sent it back: Repeat only when the latest INTERNAL transfer
   * was closed as `REPEAT`, Error only when it was `REJECTED` by the receiving
   * branch (a rejection the system wrote itself does not count). Every other Sent
   * sample stays untouchable except for Retrieve.
   */
  private async isSentReturnAction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sampleId: string,
    action: 'repeat' | 'error',
  ): Promise<boolean> {
    const back = (await findReceiverReturns(tx, tenantId, [sampleId])).get(
      sampleId,
    );
    if (!back) return false;
    return action === 'repeat'
      ? back.kind === 'REPEAT'
      : back.kind === 'REJECTED';
  }

  /**
   * Write the sender's trail entry for "the receiving branch sent this sample back"
   * (Reject / Repeat / Return). The sender's tube does NOT move: it stays Sent and
   * reads "Sent – Repeated" / "Sent – Rejected" until the sender decides, so this
   * row (no status change; shown in the history, see {@link findHistory}) is how the
   * reason reaches the sender's audit trail.
   * @param originSampleId the sender's original (Sent) sample
   * @param reason what the receiving branch gave as the reason
   */
  async recordReturnedByReceiverInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    originSampleId: string,
    reason: string,
  ): Promise<void> {
    const origin = await tx.orderSample.findFirst({
      where: { id: originSampleId, tenantId, deletedAt: null },
      select: { id: true, branchId: true, status: true },
    });
    if (!origin) return;
    await tx.orderSampleStatusHistory.create({
      data: {
        tenantId,
        branchId: origin.branchId,
        sampleId: origin.id,
        action: RETURNED_BY_RECEIVER_ACTION,
        fromStatus: origin.status,
        toStatus: origin.status,
        reason,
        notes: `Returned by the receiving branch: ${reason}`,
        changedBy: personId,
      },
    });
  }

  /**
   * What a Retrieve of a sent sample says in the audit trail, for each open INTERNAL
   * transfer it took back: the note added to the sender's history row, and the
   * Audit-log entries - one under the SENDER's branch and one under the RECEIVING
   * branch (so the Audit page's branch filter shows it under both). The receiving
   * branch's entry is left out when it never saw the transfer: no center assigned
   * yet, or hidden from it (In-Transit with no logistics type).
   * Details: accession number, order, transfer id, destination, stage.
   */
  private async buildRecallAuditInfo(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sample: OrderSample,
    recalled: RecalledTransfer[],
  ): Promise<RecallAuditInfo> {
    const branchIds = [
      ...new Set(
        [sample.branchId, ...recalled.map((t) => t.destinationBranchId)].filter(
          (id): id is string => !!id,
        ),
      ),
    ];
    const [branches, order] = await Promise.all([
      tx.branch.findMany({
        where: { id: { in: branchIds }, tenantId },
        select: { id: true, name: true },
      }),
      tx.order.findFirst({
        where: { id: sample.orderId, tenantId },
        select: { orderCode: true },
      }),
    ]);
    const nameOf = (id: string | null): string | null =>
      id ? (branches.find((b) => b.id === id)?.name ?? null) : null;
    const senderName = nameOf(sample.branchId) ?? 'the sending branch';
    const stageOf = (s: TransferStatus): string =>
      s === TransferStatus.PICKED_UP ? 'Picked Up' : 'In-Transit';

    const notes: string[] = [];
    const entries: RecallAuditInfo['entries'] = [];
    for (const t of recalled) {
      const stage = stageOf(t.transferStatus);
      const destName = nameOf(t.destinationBranchId);
      const base = {
        sampleId: sample.id,
        accessionNo: sample.accessionNo,
        orderCode: order?.orderCode ?? null,
        transferId: t.id,
        stage,
        fromBranchId: sample.branchId,
        fromBranch: senderName,
        toBranchId: t.destinationBranchId,
        toBranch: destName,
      };
      notes.push(
        destName
          ? `Retrieved from ${destName} while ${stage}`
          : `Retrieved while ${stage} (no center assigned yet)`,
      );
      entries.push({
        branchId: sample.branchId,
        description: destName
          ? `Retrieved sample ${sample.accessionNo} from ${destName} while ${stage}`
          : `Retrieved sample ${sample.accessionNo} while ${stage} (no center assigned yet)`,
        metadata: { ...base, side: 'sender' },
      });
      const receiverSawIt =
        !!t.destinationBranchId &&
        !isHiddenFromReceiver({
          kind: TransferKind.INTERNAL,
          transferStatus: t.transferStatus,
          logisticsType: t.logisticsType,
        });
      if (receiverSawIt) {
        entries.push({
          branchId: t.destinationBranchId,
          description: `Sample ${sample.accessionNo} was retrieved by ${senderName} before ${destName ?? 'your branch'} received it (it was ${stage})`,
          metadata: { ...base, side: 'receiver' },
        });
      }
    }
    return { historyNote: notes.join('; '), entries };
  }

  /**
   * Writes the Audit-log entries of {@link buildRecallAuditInfo} inside the caller's
   * transaction (so they commit or roll back with the retrieve itself). The actor is
   * the acting user and the role comes from the request. Skipped when there is no
   * acting person (a system call).
   */
  private async writeRecallAuditInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    note: ActionNote,
    info: RecallAuditInfo,
  ): Promise<void> {
    if (!personId) return;
    for (const e of info.entries) {
      await tx.auditLog.create({
        data: {
          tenantId,
          branchId: e.branchId,
          module: AuditModule.ACCESSION,
          action: AuditAction.UPDATE,
          description: e.description,
          actorPersonId: personId,
          actorRoleKey: note.actor?.roleKey ?? null,
          actorRoleLabel: note.actor?.roleLabel ?? null,
          resourceId:
            (e.metadata as { sampleId?: string } | undefined)?.sampleId ?? null,
          metadata: e.metadata,
        },
      });
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
   *  4. leaves the sender's ORIGINAL sample in `SENT_INTERNAL` and records the
   *     return (with its reason) on that sample's history. The sender then reads
   *     "Sent – Repeated" / "Sent – Rejected" (from the transfer, which the caller
   *     closes) and decides: Repeat, Error or Retrieve.
   * The caller updates the `SampleTransfer` row itself.
   * @returns the sender's original sample id (still `SENT_INTERNAL`)
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
    // A copy whose test was removed from the order is frozen: it cannot be sent
    // back (its report stays where it is).
    if (await isSampleItemRemoved(tx, tenantId, copy.id)) {
      throw new SampleItemRemovedException(action, copy.status);
    }
    // An order that was cancelled is frozen: the accepted copy (and the results
    // typed on it) stays where it is, so it cannot be sent back - sending it back
    // resets the report. Store then Discard remain the way to wind the tube down.
    // This is the one place every road back goes through (the transfer's Reject /
    // Repeat, the sample's own Repeat and Return).
    if (await this.isOrderCancelled(tx, tenantId, copy.orderId)) {
      throw new SampleReturnOrderCancelledException(action, copy.status);
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
      // Cleared first (above), now back on the SENDER's own copy of the test: its
      // parameters, ranges and methods again, not the receiver's.
      await this.pointReportsAtBranchSetup(
        tx,
        tenantId,
        origin.branchId,
        reportIds,
      );
    }
    // The sender's original does NOT move: it stays Sent (reading "Sent – Repeated" /
    // "Sent – Rejected" from the transfer the caller closes) until the sender
    // chooses Repeat / Error / Retrieve. Only the trail entry is written.
    await this.recordReturnedByReceiverInTx(
      tx,
      tenantId,
      personId,
      origin.id,
      reason,
    );
    return origin.id;
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
   * to the sender and the sender's original sample stays Sent, reading
   * "Sent – Repeated" until the sender confirms the Repeat. Refused if a report
   * has a validated result. Without this the report would stay at the receiving
   * branch with a `RETURNED` copy while the sender's sample has no action left.
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
    // A returned copy is voided, so report the sender's original sample (still Sent)
    // in its place — one entry per processed id.
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
    /** The acting user's role (for the Audit-log entries of a recall); optional. */
    actor?: ActionNote['actor'],
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
      actor ? { ...dto, actor } : dto,
    );
  }

  /**
   * Retrieve ONE sample inside the caller's transaction (used by the all-or-nothing
   * "apply center changes"): the sender check (only the branch that sent it), then the
   * normal Retrieve transition - which soft-deletes the open internal transfer and
   * writes the audit trail. Strict: any refusal is thrown to the caller, whose
   * transaction then rolls back.
   * @param actor the acting user's role, for the Audit-log entries
   */
  async retrieveOneInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    actingBranchId: string | null,
    sampleId: string,
    note: { notes?: string; attachmentUrl?: string },
    actor?: ActionNote['actor'],
  ): Promise<void> {
    const sent = await tx.orderSample.findFirst({
      where: {
        id: sampleId,
        tenantId,
        deletedAt: null,
        status: SampleStatus.SENT_INTERNAL,
      },
      select: { id: true, branchId: true },
    });
    if (sent && sent.branchId !== actingBranchId) {
      throw new TransferWrongBranchException(sent.id, 'retrieve', 'sender');
    }
    await this.transitionInTx(
      tx,
      tenantId,
      personId,
      sampleId,
      'retrieve',
      () => ({ data: {} }),
      { ...note, ...(actor ? { actor } : {}) },
    );
  }

  /**
   * Only the SENDING branch can pull back a sample it sent to another branch - or,
   * once the receiving branch sent it back, Repeat / flag Error on it. A sample that
   * is out at another branch (SENT_INTERNAL) is held by the branch that sent it, so
   * the caller's active branch must be that branch. Always an error, never a
   * "skip", so a group action cannot touch another branch's samples. Other samples
   * are unaffected.
   * @throws TransferWrongBranchException
   */
  private async assertRetrieverIsSender(
    ids: string[],
    tenantId: string,
    actingBranchId: string | null,
    action: 'retrieve' | 'repeat' | 'error' = 'retrieve',
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
      throw new TransferWrongBranchException(foreign.id, action, 'sender');
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
   * @throws SampleOrderCancelledException if a sample's order is cancelled
   * @throws SampleBarcodeLockedException if a sample is out at another
   *   branch / partner / centre, or is a copy received from another branch
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
          sourceTransferId: true,
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
      // The barcode belongs to the physical tube that travels: a sample that is out
      // at another branch / partner / centre, and a copy received from another
      // branch, keep the number they have (editing one side would leave the tube
      // with two numbers). All-or-nothing, like the rest of this action.
      for (const s of samples) {
        if (isTransferredStatus(s.status) || s.sourceTransferId) {
          throw new SampleBarcodeLockedException(s.status);
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

    // A sample whose test was removed from the order is kept for the physical
    // tube's wind-down only: Store and Discard stay open, and so does the sender's
    // Retrieve of a sample that is OUT at another branch / partner (otherwise it
    // could never be pulled back; Retrieve keeps its own guards below). Every other
    // user action (Send, Return, Repeat, Forward, Outsource, collect, accept, ...)
    // is refused. The system-driven moves (`note.system`) are not user actions and
    // pass.
    if (
      !note.system &&
      action !== 'store' &&
      action !== 'discard' &&
      !(action === 'retrieve' && isTransferredStatus(sample.status)) &&
      (await isSampleItemRemoved(tx, tenantId, sample.id))
    ) {
      throw new SampleItemRemovedException(action, sample.status);
    }

    // A sample sent to another branch of the tenant is out of this branch's
    // hands: the user action that may touch it is Retrieve (and only before the
    // receiving branch has received it — checked below). The one other way out is
    // after the receiving branch SENT IT BACK (its transfer is closed): Repeat when
    // it asked for a Repeat, Error when it rejected the sample (see
    // `isSentReturnAction`). This guard runs before the `force` override, so a group
    // "force" action cannot bypass it.
    const sentReturnAction =
      sample.status === SampleStatus.SENT_INTERNAL &&
      (action === 'repeat' || action === 'error') &&
      !note.system &&
      (await this.isSentReturnAction(tx, tenantId, sample.id, action));
    if (
      sample.status === SampleStatus.SENT_INTERNAL &&
      action !== 'retrieve' &&
      !note.system &&
      !sentReturnAction
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

    // The receiving branch sent this sample back (it stays Sent - Repeated / Sent -
    // Rejected): Retrieve would only put it back to Accepted at the sender as if
    // nothing had happened, so it is refused. The sender Repeats (after a repeat) or
    // flags Error (after a rejection) instead.
    if (
      action === 'retrieve' &&
      sample.status === SampleStatus.SENT_INTERNAL &&
      !note.system &&
      (await findReceiverReturns(tx, tenantId, [sample.id])).has(sample.id)
    ) {
      throw new RetrieveBlockedException(sample.status, 'SENT_BACK');
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
      const walkedTo =
        prevRow?.fromStatus ?? nextSampleStatus('retrieve', sample.status);
      // A sample is in Sent / Forwarded / Outsourced only through a real, open
      // transfer. Once it has come back (the receiving branch returned it) and been
      // collected again, the history still says "Sent → Repeat": stepping back must
      // stop there. Landing on a transferred status with no open transfer is an
      // impossible state (the report would turn view-only and the sample could not be
      // repeated or re-sent). A sample that really is out is retrieved by the branch
      // above (`retrieveTarget`), never by this walk-back.
      if (walkedTo && isTransferredStatus(walkedTo)) {
        throw new RetrieveBlockedException(sample.status, 'RETURNED');
      }
      toStatus = walkedTo;
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

    // The open INTERNAL transfers a Retrieve takes back (soft-deleted below); what the
    // audit entries need to say about them.
    let recalledTransfers: RecalledTransfer[] = [];
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
      // INTERNAL transfer: remove only the OPEN transfer (never an earlier cycle's
      // finished one). It is SOFT-DELETED, so the row leaves the receiving branch's
      // Internal Transfer page and counts; what happened is kept in the audit trail
      // (the sample's history row and the Audit log, written below with the stage,
      // destination, who and when). A Forwarded / Outsourced sample is different: its
      // transfer is unwound by the recall below (main's cleanup), not here.
      const openInternal = await tx.sampleTransfer.findMany({
        where: {
          sampleId: sample.id,
          tenantId,
          deletedAt: null,
          kind: TransferKind.INTERNAL,
          transferStatus: {
            in: [TransferStatus.IN_TRANSIT, TransferStatus.PICKED_UP],
          },
        },
        select: {
          id: true,
          destinationBranchId: true,
          transferStatus: true,
          logisticsType: true,
        },
      });
      if (openInternal.length > 0) {
        // Conditional on the status we read: a Receive that committed since the read
        // matches nothing here, so the row is neither deleted nor counted, and the
        // refusal below fires (the second assertNotReceived cannot see a deleted row,
        // so this condition is what makes the recall race-safe).
        const recalled = await tx.sampleTransfer.updateMany({
          where: {
            id: { in: openInternal.map((t) => t.id) },
            deletedAt: null,
            transferStatus: {
              in: [TransferStatus.IN_TRANSIT, TransferStatus.PICKED_UP],
            },
          },
          data: {
            deletedAt: new Date(),
            rejectionReason: RECALLED_VIA_RETRIEVE_REASON,
            updatedBy: personId,
          },
        });
        if (recalled.count !== openInternal.length) {
          throw new RetrieveBlockedException(sample.status, 'RECEIVED');
        }
        recalledTransfers = openInternal;
      }
      await assertNotReceived();
    }

    // A user's Repeat starts the report over: the new tube must not inherit the
    // old tube's values. Refused first when the result is already validated.
    // (The system-driven Repeat from a receiving branch's return resets the
    // report itself, in returnCopyToOrigin.)
    // A Repeat confirmed by the sender after the receiving branch sent the sample
    // back (`sentReturnAction`) resets nothing: the report was already reset and
    // handed back when the receiving branch acted, and has been view-only since.
    const repeatReportIds =
      action === 'repeat' && !note.system && !sentReturnAction
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
    // The sender's own Repeat / Error after the receiving branch sent the sample back
    // is NOT a recall either: the receiving branch's closed transfer (REPEAT /
    // REJECTED) is the record of what it did and must stay for both branches.
    if (
      recalling &&
      !note.system &&
      !sentReturnAction &&
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
    // A Retrieve that took the sample back from another branch: say so (stage,
    // destination) on the sender's history row and in the Audit log (below), in this
    // same transaction so the entries can never be lost.
    const recallInfo =
      recalledTransfers.length > 0
        ? await this.buildRecallAuditInfo(
            tx,
            tenantId,
            sample,
            recalledTransfers,
          )
        : null;
    await tx.orderSampleStatusHistory.create({
      data: {
        tenantId,
        branchId: sample.branchId,
        sampleId: sample.id,
        action,
        toStatus,
        fromStatus: sample.status,
        reason: built.reason ?? null,
        notes:
          [note.notes, recallInfo?.historyNote].filter(Boolean).join(' · ') ||
          null,
        attachmentUrl: note.attachmentUrl ?? null,
        changedBy: personId,
      },
    });
    if (recallInfo) {
      await this.writeRecallAuditInTx(tx, tenantId, personId, note, recallInfo);
    }
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
   * Recall the hand-off a sample is being pulled back from (Retrieve / Repeat).
   * Only transfers of the kind the sample is out on are recalled (see
   * {@link transferKindOutFor}): an older transfer of another kind that is already
   * closed (e.g. an internal A→B rejection before the sample was Forwarded) is
   * history and is left untouched. A sample whose status maps to no kind (a passed-on
   * clone being unwound) keeps the old behaviour and recalls all its transfers.
   * For each matching non-deleted transfer:
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
    const kindOut = transferKindOutFor(sample.status);
    const transfers = await tx.sampleTransfer.findMany({
      where: {
        sampleId: sample.id,
        tenantId,
        deletedAt: null,
        ...(kindOut ? { kind: kindOut } : {}),
      },
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
          rejectionReason:
            transfer.rejectionReason ?? RECALLED_VIA_RETRIEVE_REASON,
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
      const cloneTests = await tx.orderSampleTest.findMany({
        where: { sampleId: cloneId, tenantId, deletedAt: null },
        select: { orderItemId: true, labTestId: true },
      });
      const movedReportIds =
        await this.labReportService.findReportIdsForSampleTests(
          tx,
          tenantId,
          clone.branchId,
          cloneTests,
        );
      await this.rehomeLabReportsForSample(tx, tenantId, cloneId, originBranch);
      // back on the origin's own copy of the test
      await this.pointReportsAtBranchSetup(
        tx,
        tenantId,
        originBranch,
        movedReportIds,
      );
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
   * Point these reports at the test setup `branchId` uses for each test, while that branch HOLDS the tube
   * (see `performing-setup.util`). A report's parameters, ranges, values and methods are all read through
   * `LabReport.labTestId`, so moving the pointer is what makes the holding branch's technician work with
   * that branch's own copy of the test:
   *  - on Accept the reports move to the receiver, which then uses ITS copy;
   *  - on a return (Reject / Repeat, or unwinding a clone) they move back to the sender's copy.
   * A panel-member report also carries `memberBranchLabTestId` (the Lab Test List entry of the member); it
   * follows: the panel's own member entry where the panel belongs to `branchId`, else the branch's entry.
   * A test with no tenant link, or one the branch has no active entry for, is left as it is (nothing is
   * refused: Phase 1 already blocks a destination that does not offer the test).
   * Run AFTER the reports changed branch (and, on a return, after they were cleared), inside the caller's
   * transaction.
   * @param branchId the branch that now holds the reports
   * @param reportIds the reports that moved
   */
  async pointReportsAtBranchSetup(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    reportIds: string[],
  ): Promise<void> {
    if (reportIds.length === 0) return;
    const reports = await tx.labReport.findMany({
      where: {
        id: { in: reportIds },
        tenantId,
        deletedAt: null,
        labTestId: { not: null },
      },
      select: {
        id: true,
        labTestId: true,
        memberBranchLabTestId: true,
        performingBranchLabTestId: true,
        orderItem: { select: { branchLabPanelId: true, branchId: true } },
      },
    });
    const setups = new Map<string, PerformingSetup | null>();
    for (const r of reports) {
      const from = r.labTestId!;
      if (!setups.has(from)) {
        setups.set(from, await findSetupAtBranch(tx, tenantId, branchId, from));
      }
      const setup = setups.get(from);
      if (!setup) {
        // nothing to point at, but back at the order's own branch the order line's
        // entry applies again
        if (
          r.orderItem?.branchId === branchId &&
          r.performingBranchLabTestId !== null
        ) {
          await tx.labReport.update({
            where: { id: r.id },
            data: { performingBranchLabTestId: null },
          });
        }
        continue;
      }
      let member = r.memberBranchLabTestId;
      if (r.memberBranchLabTestId) {
        const panelId = r.orderItem?.branchLabPanelId ?? null;
        const own = panelId
          ? await findPanelMemberEntryFor(tx, panelId, setup.labTestId)
          : null;
        member =
          own && own.branchId === branchId ? own.id : setup.branchLabTestId;
      }
      // The Lab Test List entry the holding branch works with (template / PDF, TAT,
      // department). At the order's OWN branch that is the order line's entry (null =
      // "use the order line"); anywhere else it is that branch's entry.
      const performing =
        r.orderItem?.branchId === branchId ? null : setup.branchLabTestId;
      if (
        setup.labTestId === from &&
        member === r.memberBranchLabTestId &&
        performing === r.performingBranchLabTestId
      ) {
        continue;
      }
      await tx.labReport.update({
        where: { id: r.id },
        data: {
          labTestId: setup.labTestId,
          performingBranchLabTestId: performing,
          ...(r.memberBranchLabTestId ? { memberBranchLabTestId: member } : {}),
        },
      });
    }
  }

  /**
   * Accept of an INTERNAL transfer, last step: the receiving branch's copy of the tube and the reports it
   * now holds use the RECEIVER's own test setup. The copy was created with the sender's ids (so the report
   * creation / re-homing steps before this one still match the existing report), and is switched here:
   *  - the reports point at the receiver's Branch Master Data copy (see {@link pointReportsAtBranchSetup});
   *  - each `OrderSampleTest` points at the same copy, so every "which report does this tube serve" match
   *    (Send, Return, the write-locks) keeps lining up with the report;
   *  - the sample's own test, sample definition and department become the receiver's.
   * A test the receiver has no setup for keeps the sender's ids.
   * @param copyId the receiving branch's copy, just created at ACCEPTED
   * @param destBranchId the receiving branch
   */
  async retargetCopyToReceivingSetup(
    tx: Prisma.TransactionClient,
    tenantId: string,
    copyId: string,
    destBranchId: string,
  ): Promise<void> {
    const copy = await tx.orderSample.findFirst({
      where: { id: copyId, tenantId, deletedAt: null },
      include: { tests: { where: { deletedAt: null } } },
    });
    if (!copy) return;
    const reportIds = await this.labReportService.findReportIdsForSampleTests(
      tx,
      tenantId,
      destBranchId,
      copy.tests,
    );
    await this.pointReportsAtBranchSetup(tx, tenantId, destBranchId, reportIds);
    // The receiver's TAT clock is its own: a NABL stopwatch the sender had started on the
    // report must not carry over (the same reset a return gives the sender, see
    // `LabReportService.moveReportsToBranch`). The report is untouched at this point.
    if (reportIds.length > 0) {
      await tx.labReport.updateMany({
        where: { id: { in: reportIds }, tenantId, deletedAt: null },
        data: {
          isNablTat: false,
          tatIsRunning: false,
          tatStartAt: null,
          tatLastTickAt: null,
          tatNetMinutes: null,
          tatEndAt: null,
        },
      });
    }
    for (const t of copy.tests) {
      if (!t.labTestId) continue;
      const setup = await findSetupAtBranch(
        tx,
        tenantId,
        destBranchId,
        t.labTestId,
      );
      if (!setup || setup.labTestId === t.labTestId) continue;
      await tx.orderSampleTest.update({
        where: { id: t.id },
        data: { labTestId: setup.labTestId },
      });
    }
    if (!copy.labTestId) return;
    const own = await findSetupAtBranch(
      tx,
      tenantId,
      destBranchId,
      copy.labTestId,
    );
    if (!own || own.labTestId === copy.labTestId) return;
    const definition = await findSampleDefinitionAt(
      tx,
      tenantId,
      copy.labTestSampleId,
      own.labTestId,
    );
    await tx.orderSample.update({
      where: { id: copy.id },
      data: {
        labTestId: own.labTestId,
        labTestSampleId: definition ?? copy.labTestSampleId,
        departmentId: own.departmentId,
      },
    });
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
    if (query.collectionStatus) {
      // Order-level collection progress (PENDING/PARTIAL/COLLECTED), derived from
      // the order's workflow items — the same rule as the Order Console's
      // `sampleStatus`, applied here through the sample's to-one `order` relation.
      order.AND = [
        ...(Array.isArray(order.AND)
          ? order.AND
          : order.AND
            ? [order.AND]
            : []),
        buildCollectionProgressWhere(query.collectionStatus),
      ];
    }

    const and: Prisma.OrderSampleWhereInput[] = [];
    if (query.search) {
      const s = query.search;
      and.push({
        OR: [
          { accessionNo: { contains: s, mode: 'insensitive' } },
          { barcode: { contains: s, mode: 'insensitive' } },
          // The Order ID column (`ORD-00717`): finds every sample of that order.
          {
            order: {
              is: { orderCode: { contains: s, mode: 'insensitive' } },
            },
          },
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
    // Logistics: how a sample TRAVELS is recorded on its transfer (a Send / Forward / Outsource
    // writes it there, never on the sample), so match the transfer of a sample that is out
    // now; the sample's own column is kept as an alternative for older rows.
    if (query.logisticsType) {
      and.push({
        OR: [
          { logisticsType: query.logisticsType },
          {
            status: { in: [...TRANSFERRED_STATUSES] },
            transfers: {
              some: { deletedAt: null, logisticsType: query.logisticsType },
            },
          },
        ],
      });
    }
    // "Sent to": the sample is Sent right now and its transfer is addressed to that branch.
    if (query.destinationBranchId) {
      and.push(
        this.heldTransfer(SampleStatus.SENT_INTERNAL, TransferKind.INTERNAL, {
          destinationBranchId: query.destinationBranchId,
        }),
      );
    }
    // "Forward partner": the sample is Forwarded right now to a partner with this name.
    const partner = query.externalPartnerName?.trim();
    if (partner) {
      and.push(
        this.heldTransfer(
          SampleStatus.FORWARD_EXTERNAL,
          TransferKind.EXTERNAL,
          {
            // literal text: `%` and `_` typed by the user are not wildcards
            externalPartnerName: {
              contains: escapeLike(partner),
              mode: 'insensitive',
            },
          },
        ),
      );
    }
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
   * Add the names the list's "Send details" column shows to each row's latest transfer: the
   * destination branch and the outsource center are logical refs (ids only), so one batched,
   * tenant-scoped lookup per page resolves them - WITHOUT a deletedAt filter, so a
   * since-deactivated branch or center still shows its name. Rows with no transfer cost nothing.
   */
  private async withTransferNames(
    tenantId: string,
    rows: OrderSampleListRow[],
  ): Promise<OrderSampleListRow[]> {
    const branchIds = new Set<string>();
    const centerIds = new Set<string>();
    for (const r of rows) {
      for (const t of r.transfers) {
        if (t.destinationBranchId) branchIds.add(t.destinationBranchId);
        if (t.outsourceCenterId) centerIds.add(t.outsourceCenterId);
      }
    }
    if (branchIds.size === 0 && centerIds.size === 0) return rows;
    const names = await this.prisma.withTenant(tenantId, async (tx) => ({
      branches:
        branchIds.size > 0
          ? await tx.branch.findMany({
              where: { id: { in: [...branchIds] }, tenantId },
              select: { id: true, name: true },
            })
          : [],
      centers:
        centerIds.size > 0
          ? await tx.outsourceCenter.findMany({
              where: { id: { in: [...centerIds] }, tenantId },
              select: { id: true, name: true },
            })
          : [],
    }));
    const branchName = new Map(names.branches.map((b) => [b.id, b.name]));
    const centerName = new Map(names.centers.map((c) => [c.id, c.name]));
    return rows.map((r) => ({
      ...r,
      transfers: r.transfers.map((t) => ({
        ...t,
        destinationBranchName: t.destinationBranchId
          ? (branchName.get(t.destinationBranchId) ?? null)
          : null,
        outsourceCenterName: t.outsourceCenterId
          ? (centerName.get(t.outsourceCenterId) ?? null)
          : null,
      })),
    }));
  }

  /**
   * Add the Discard Method the Discarded tab shows. The method is stored only as the `reason` of
   * the `discard` history entry, so one batched lookup per page reads the latest entry of each
   * sample that is Discarded right now (a sample retrieved and discarded again shows its newest
   * method). Pages without a Discarded sample cost nothing.
   */
  private async withDiscardMethods(
    tenantId: string,
    rows: OrderSampleListRow[],
  ): Promise<OrderSampleListRow[]> {
    const discardedIds = rows
      .filter((r) => r.status === SampleStatus.DISCARDED)
      .map((r) => r.id);
    if (discardedIds.length === 0) return rows;
    const history = await this.prisma.withTenant(tenantId, (tx) =>
      tx.orderSampleStatusHistory.findMany({
        where: {
          tenantId,
          sampleId: { in: discardedIds },
          action: 'discard',
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: { sampleId: true, reason: true },
      }),
    );
    const methodBySample = new Map<string, string | null>();
    for (const h of history) {
      if (!methodBySample.has(h.sampleId)) {
        methodBySample.set(h.sampleId, h.reason);
      }
    }
    return rows.map((r) =>
      r.status === SampleStatus.DISCARDED
        ? { ...r, discardMethod: methodBySample.get(r.id) ?? null }
        : r,
    );
  }

  /**
   * "The sample is out on a `kind` transfer right now": its status is the matching
   * transferred one (`status`) and it has a live (not recalled) transfer of that kind
   * matching `transfer`. A transfer the other side closed as repeated / rejected stays live, so
   * a sample that is still "Sent - Repeated" is found; once the sender repeats or retrieves it,
   * its status changes and it is not.
   */
  private heldTransfer(
    status: SampleStatus,
    kind: TransferKind,
    transfer: Prisma.SampleTransferWhereInput,
  ): Prisma.OrderSampleWhereInput {
    return {
      status,
      transfers: { some: { deletedAt: null, kind, ...transfer } },
    };
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
