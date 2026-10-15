import { Injectable } from '@nestjs/common';
import { timestampRange } from '../../common/utils/date-range.util';
import {
  OrderSample,
  Prisma,
  SampleStatus,
  TransferKind,
  TransferStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult, paginated } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { BranchService } from '../branch/branch.service';
import { PermissionCheckService } from '../permissions/services/permission-check.service';
import { ACCESSION_TRANSFER_KEY_GROUPS } from '../permissions/constants/module-permissions.constant';
import { OrderSampleService } from './accession-sample.service';
import {
  TransferAction,
  nextTransferStatus,
} from './constants/transfer-transitions.constant';
import { TransferDispatchDto } from './dto/transfer-dispatch.dto';
import { SendSampleDto } from './dto/send-sample.dto';
import { ForwardSampleDto } from './dto/forward-sample.dto';
import { OutsourceSampleDto } from './dto/outsource-sample.dto';
import { TransferPickUpDto } from './dto/transfer-pickup.dto';
import { TransferReceiveDto } from './dto/transfer-receive.dto';
import { TransferRepeatDto } from './dto/transfer-repeat.dto';
import { TransferRejectDto } from './dto/transfer-reject.dto';
import { SampleNoteDto } from './dto/sample-note.dto';
import { AssignCenterDto } from './dto/assign-center.dto';
import { OutsourceStatusDto } from './dto/outsource-status.dto';
import { ListTransfersDto } from './dto/list-transfers.dto';
import {
  TRANSFER_INCLUDE,
  SampleTransferDeptRow,
  SampleTransferListRow,
  SampleTransferWithRelations,
} from './entities/sample-transfer.entity';
import {
  BulkActionResult,
  BulkSkippedItem,
} from './entities/bulk-action-result.entity';
import {
  AccessionNumberConflictException,
  OrderSampleNotFoundException,
  InvalidSampleTransitionException,
  InvalidTransferTransitionException,
  TransferOrderCancelledException,
  TransferWrongBranchException,
  refusalMessage,
  OutsourceCenterNotFoundException,
  SampleTransferNotFoundException,
  TransferDestinationMissingException,
  TransferNotEditableException,
  SendBlockedException,
} from './exceptions/accession.exceptions';
import { inLockOrder, inRequestOrder } from './utils/request-order.util';
import {
  PREVIOUS_HOLDER_MESSAGE,
  heldBranchesForCopy,
  isPreviousHolder,
} from './utils/previous-holders.util';

/** Destination fields resolved once per Send/Forward/Outsource batch. */
interface TransferDestination {
  destinationBranchId?: string | null;
  outsourceCenterId?: string | null;
  externalPartnerName?: string | null;
  externalPartnerRef?: string | null;
  outsourceStatus?: string | null;
}

/**
 * Sample transfers (PDF Parts B/C/D) — the referral/outsource flows. Tenant-scoped
 * (RLS) + branch-level. Distinct from the commission `InternalReferral`/
 * `ExternalReferral` models (plan decision #2).
 *
 * Sending side (In-House): `send` (INTERNAL branch↔branch), `forward` (EXTERNAL
 * partner lab), `outsource` (third-party) each transition the sample (§A.9) and
 * create a `SampleTransfer` at `IN_TRANSIT`, atomically. Receiving side (Part B/C
 * state machine §B.10): `pickUp` → `receive` → `accept`/`repeat`/`reject`. On
 * INTERNAL `accept`, RULE 1 clones the sample into the receiving branch's In-House
 * list at status `ACCEPTED`. External receiving is cross-tenant (Phase 3 open) —
 * only the sending side is built; the transfer status is the sending row's
 * Internal/External Order Status column (CR-1). Outsource is manual (CR-3):
 * `outsourceStatus` is set by staff, no sync.
 *
 * NOTE: the SampleTransfer row has no history table, so the mandatory fields
 * (receiveCondition/repeatReason/rejectionReason) are stored as columns. The
 * optional per-action notes/attachments are recorded on the *sample's* history
 * instead — dispatch (send/forward/outsource) does so via the sample transition,
 * and Assign Center via `OrderSampleService.recordNoteInTx`.
 */
@Injectable()
export class SampleTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly samples: OrderSampleService,
    private readonly branches: BranchService,
    private readonly permissionCheck: PermissionCheckService,
  ) {}

  // ── Sending side (In-House → transfer) ─────────────────────────────────────

  /** Send (Internal Transfer): Accepted → Sent (Internal) + INTERNAL transfer. */
  async send(
    sampleIds: string[],
    tenantId: string,
    personId: string | null,
    dto: SendSampleDto,
  ): Promise<BulkActionResult<SampleTransferWithRelations>> {
    if (dto.destinationBranchId) {
      await this.branches.findById(dto.destinationBranchId, tenantId);
    }
    return this.dispatch(
      sampleIds,
      tenantId,
      personId,
      'send',
      TransferKind.INTERNAL,
      dto,
      { destinationBranchId: dto.destinationBranchId ?? null },
    );
  }

  /** Forward (External Transfer): Accepted → Forward (External) + EXTERNAL transfer. */
  async forward(
    sampleIds: string[],
    tenantId: string,
    personId: string | null,
    dto: ForwardSampleDto,
  ): Promise<BulkActionResult<SampleTransferWithRelations>> {
    return this.dispatch(
      sampleIds,
      tenantId,
      personId,
      'forward',
      TransferKind.EXTERNAL,
      dto,
      {
        externalPartnerName: dto.externalPartnerName,
        externalPartnerRef: dto.externalPartnerRef ?? null,
      },
    );
  }

  /**
   * Outsource: Accepted → Outsourced + OUTSOURCE transfer (manual tracking).
   * The center is optional here — when provided it is validated against the
   * caller's tenant; when omitted the transfer is created with a null
   * `outsourceCenterId` and the center can be set later via Assign Center.
   */
  async outsource(
    sampleIds: string[],
    tenantId: string,
    personId: string | null,
    dto: OutsourceSampleDto,
  ): Promise<BulkActionResult<SampleTransferWithRelations>> {
    if (dto.outsourceCenterId) {
      await this.assertOutsourceCenter(dto.outsourceCenterId, tenantId);
    }
    return this.dispatch(
      sampleIds,
      tenantId,
      personId,
      'outsource',
      TransferKind.OUTSOURCE,
      dto,
      {
        outsourceCenterId: dto.outsourceCenterId ?? null,
        outsourceStatus: dto.outsourceStatus ?? null,
      },
    );
  }

  // ── Receiving side (Part B/C state machine §B.10) ──────────────────────────

  /** Picked Up (§B.11.1): In-Transit → Picked Up. */
  async pickUp(
    transferIds: string[],
    tenantId: string,
    personId: string | null,
    actingBranchId: string | null,
    dto: TransferPickUpDto,
    skipInvalid = false,
  ): Promise<BulkActionResult<SampleTransferWithRelations>> {
    return this.transferAction(
      transferIds,
      tenantId,
      personId,
      actingBranchId,
      'pick-up',
      () => ({
        pickedUpBy: dto.pickedUpBy ?? null,
        pickedUpAt: new Date(),
      }),
      skipInvalid,
    );
  }

  /** Receive (§B.11.2): Picked Up → Received (records condition on receipt). */
  async receive(
    transferIds: string[],
    tenantId: string,
    personId: string | null,
    actingBranchId: string | null,
    dto: TransferReceiveDto,
    skipInvalid = false,
  ): Promise<BulkActionResult<SampleTransferWithRelations>> {
    return this.transferAction(
      transferIds,
      tenantId,
      personId,
      actingBranchId,
      'receive',
      () => ({
        receivedAt: new Date(),
        receiveCondition: dto.receiveCondition,
      }),
      skipInvalid,
    );
  }

  /** Accept (§B.11.3): Received → Accepted. INTERNAL clones into In-House (RULE 1). */
  async accept(
    transferIds: string[],
    tenantId: string,
    personId: string | null,
    actingBranchId: string | null,
    _dto: SampleNoteDto,
    skipInvalid = false,
  ): Promise<BulkActionResult<SampleTransferWithRelations>> {
    return this.transferAction(
      transferIds,
      tenantId,
      personId,
      actingBranchId,
      'accept',
      () => ({
        acceptedAt: new Date(),
      }),
      skipInvalid,
    );
  }

  /** Repeat (§B.11.4): Received/Accepted → Repeat (origin notified to re-collect). */
  async repeatTransfer(
    transferIds: string[],
    tenantId: string,
    personId: string | null,
    actingBranchId: string | null,
    dto: TransferRepeatDto,
    skipInvalid = false,
  ): Promise<BulkActionResult<SampleTransferWithRelations>> {
    return this.transferAction(
      transferIds,
      tenantId,
      personId,
      actingBranchId,
      'repeat',
      () => ({
        repeatReason: dto.repeatReason,
      }),
      skipInvalid,
      dto.repeatReason,
    );
  }

  /** Reject (§B.11.5): Received → Rejected (origin notified). */
  async reject(
    transferIds: string[],
    tenantId: string,
    personId: string | null,
    actingBranchId: string | null,
    dto: TransferRejectDto,
    skipInvalid = false,
  ): Promise<BulkActionResult<SampleTransferWithRelations>> {
    return this.transferAction(
      transferIds,
      tenantId,
      personId,
      actingBranchId,
      'reject',
      () => ({
        rejectionReason: dto.rejectionReason,
      }),
      skipInvalid,
      dto.rejectionReason,
    );
  }

  // ── Destination management & manual outsource status ───────────────────────

  /** Assign Center (§A.7): set the destination on a transfer created without one. */
  async assignCenter(
    transferId: string,
    tenantId: string,
    personId: string | null,
    dto: AssignCenterDto,
    actor?: { branchId: string | null; profileKey: string | null },
  ): Promise<SampleTransferWithRelations> {
    const transfer = await this.findTransferById(transferId, tenantId);
    // Choosing / changing where an INTERNAL transfer goes is the SENDING branch's
    // call (the branch that created it), never the receiver's or a bystander's.
    if (
      actor &&
      transfer.kind === TransferKind.INTERNAL &&
      transfer.branchId !== actor.branchId
    ) {
      throw new TransferWrongBranchException(
        transferId,
        'assign-center',
        'sender',
      );
    }
    // A cancelled order's transfer is frozen, destination included.
    const sampleOfTransfer = await this.prisma.orderSample.findFirst({
      where: { id: transfer.sampleId, tenantId },
      select: { orderId: true },
    });
    if (
      sampleOfTransfer &&
      (await this.samples.isOrderCancelled(
        this.prisma,
        tenantId,
        sampleOfTransfer.orderId,
      ))
    ) {
      throw new TransferOrderCancelledException(transferId, 'assign-center');
    }
    // An INTERNAL transfer's destination can only change until the receiving
    // branch has received it (same window as Retrieve).
    if (
      transfer.kind === TransferKind.INTERNAL &&
      transfer.transferStatus !== TransferStatus.IN_TRANSIT &&
      transfer.transferStatus !== TransferStatus.PICKED_UP
    ) {
      throw new TransferNotEditableException(
        transferId,
        transfer.transferStatus,
      );
    }
    // Permission: setting a MISSING destination is "Assign … center"; changing an
    // ALREADY-SET destination is "Update … center". Enforce the matching group
    // (assertAny across kinds; admin roles bypass in the checker).
    const alreadySet =
      transfer.kind === TransferKind.INTERNAL
        ? !!transfer.destinationBranchId
        : transfer.kind === TransferKind.OUTSOURCE
          ? !!transfer.outsourceCenterId
          : !!transfer.externalPartnerName;
    if (actor) {
      await this.permissionCheck.assertAny(
        {
          tenantId,
          personId: personId ?? '',
          branchId: actor.branchId,
          profileKey: actor.profileKey,
        },
        alreadySet
          ? [...ACCESSION_TRANSFER_KEY_GROUPS.UPDATE_CENTER]
          : [...ACCESSION_TRANSFER_KEY_GROUPS.ASSIGN_CENTER],
      );
    }
    // Persist the modal's Logistics Information alongside the destination, the
    // same columns the Send/Forward/Outsource dispatch writes (§B.9). Only set a
    // field when the caller supplied it so an Assign that omits logistics never
    // clobbers values recorded at send time.
    const data: Prisma.SampleTransferUpdateInput = { updatedBy: personId };
    if (dto.sendDate !== undefined) data.sendDate = new Date(dto.sendDate);
    if (dto.sendTime !== undefined) data.sendTime = dto.sendTime;
    if (dto.sampleForm !== undefined) data.sampleForm = dto.sampleForm;
    if (dto.logisticsType !== undefined) data.logisticsType = dto.logisticsType;
    if (dto.logisticsPerson !== undefined) {
      data.logisticsPerson = dto.logisticsPerson;
    }
    if (transfer.kind === TransferKind.INTERNAL) {
      if (!dto.destinationBranchId) {
        throw new TransferDestinationMissingException(transferId);
      }
      await this.branches.findById(dto.destinationBranchId, tenantId);
      // Same rule as Send: never to a branch that already held this sample.
      if (isPreviousHolder(transfer.sample, dto.destinationBranchId)) {
        throw new SendBlockedException(
          transfer.sample.status,
          PREVIOUS_HOLDER_MESSAGE,
        );
      }
      data.destinationBranchId = dto.destinationBranchId;
    } else if (transfer.kind === TransferKind.OUTSOURCE) {
      if (!dto.outsourceCenterId) {
        throw new TransferDestinationMissingException(transferId);
      }
      await this.assertOutsourceCenter(dto.outsourceCenterId, tenantId);
      data.outsourceCenterId = dto.outsourceCenterId;
    } else {
      if (!dto.externalPartnerName) {
        throw new TransferDestinationMissingException(transferId);
      }
      data.externalPartnerName = dto.externalPartnerName;
    }
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.sampleTransfer.update({ where: { id: transferId }, data });
      // Keep the source sample's processing branch in step when an INTERNAL
      // destination is assigned (or changed) after dispatch, mirroring the
      // dispatch-time behaviour so the origin branch's list stays accurate.
      if (transfer.kind === TransferKind.INTERNAL && dto.destinationBranchId) {
        await tx.orderSample.update({
          where: { id: transfer.sampleId },
          data: {
            processingBranchId: dto.destinationBranchId,
            updatedBy: personId,
          },
        });
      }
      // Record the modal's optional note/attachment on the sample history (no
      // status change), exactly as dispatch does — SampleTransfer has no history
      // table, so the note lives on the sample's audit trail.
      await this.samples.recordNoteInTx(
        tx,
        tenantId,
        personId,
        transfer.sampleId,
        'assign-center',
        { notes: dto.notes, attachmentUrl: dto.attachmentUrl },
      );
    });
    return this.findTransferById(transferId, tenantId);
  }

  /** Manually update an OUTSOURCE transfer's status (CR-3 — no sync). */
  async updateOutsourceStatus(
    transferId: string,
    tenantId: string,
    personId: string | null,
    dto: OutsourceStatusDto,
  ): Promise<SampleTransferWithRelations> {
    await this.findTransferById(transferId, tenantId);
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.sampleTransfer.update({
        where: { id: transferId },
        data: { outsourceStatus: dto.outsourceStatus, updatedBy: personId },
      }),
    );
    return this.findTransferById(transferId, tenantId);
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /**
   * List transfers for the active branch (the Internal/External referral queues).
   * `direction=incoming` (default) shows transfers destined for this branch (the
   * receiving queue); `outgoing` shows transfers sent from it.
   */
  async findTransfers(
    tenantId: string,
    branchId: string | null,
    query: ListTransfersDto,
  ): Promise<PaginatedResult<SampleTransferListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.SampleTransferWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.kind) where.kind = query.kind;
    if (query.status) where.transferStatus = query.status;
    if (query.logisticsType) where.logisticsType = query.logisticsType;
    if (query.direction === 'outgoing') {
      where.originBranchId = branchId;
    } else {
      where.destinationBranchId = branchId;
    }
    // A day-only `dateTo` covers that whole day (see `timestampRange`).
    const sendDateRange = timestampRange(query.dateFrom, query.dateTo);
    if (sendDateRange) where.sendDate = sendDateRange;
    // Filters on the linked sample + its order (accession search, referral refs).
    const sample: Prisma.OrderSampleWhereInput = {};
    if (query.search) {
      sample.accessionNo = { contains: query.search, mode: 'insensitive' };
    }
    const order: Prisma.OrderWhereInput = {};
    if (query.referredByDoctorId) {
      order.referredByDoctorId = query.referredByDoctorId;
    }
    if (query.referralPanelId) order.referralPanelId = query.referralPanelId;
    if (Object.keys(order).length > 0) sample.order = { is: order };
    if (Object.keys(sample).length > 0) where.sample = { is: sample };

    // withTenant (not array-form $transaction) so the RLS tenant GUC is set for
    // both queries — array-form bypasses the per-op RLS extension and returns
    // zero rows under enforced RLS (see PrismaService).
    const [data, total] = await this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.sampleTransfer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: TRANSFER_INCLUDE,
      });
      const count = await tx.sampleTransfer.count({ where });
      const deptRows = await this.withDepartmentLabels(tx, tenantId, rows);
      const fullRows = await this.withOutsourceCenterNames(
        tx,
        tenantId,
        deptRows,
      );
      return [fullRows, count] as const;
    });
    return paginated(data, total, page, limit);
  }

  /**
   * Attach each row's sample `departmentLabel` (the Department column). Batched
   * variant of `OrderSampleService.withDepartments`: the classification lives on
   * `BranchLabTest`/`BranchLabPanel` as a logical `departmentId` (no Prisma
   * relation), so the ids across the whole page are resolved in one
   * tenant-scoped `Department` query.
   * @param tx the tenant-scoped transaction client (RLS GUC already set)
   * @param tenantId tenant scope for the Department lookup
   * @param rows the page of transfers (TRANSFER_INCLUDE payload)
   * @returns the rows with `sample.departmentLabel` = distinct names joined with ", " (null when none)
   */
  private async withDepartmentLabels(
    tx: Prisma.TransactionClient,
    tenantId: string,
    rows: SampleTransferWithRelations[],
  ): Promise<SampleTransferDeptRow[]> {
    const deptIdsOf = (row: SampleTransferWithRelations): string[] =>
      row.sample.tests
        .map(
          (t) =>
            t.orderItem?.branchLabTest?.departmentId ??
            t.orderItem?.branchLabPanel?.departmentId ??
            null,
        )
        .filter((v): v is string => !!v);

    const deptIds = [...new Set(rows.flatMap(deptIdsOf))];
    const nameById = new Map<string, string>();
    if (deptIds.length > 0) {
      const depts = await tx.department.findMany({
        where: { id: { in: deptIds }, tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      depts.forEach((d) => nameById.set(d.id, d.name));
    }

    return rows.map((row) => {
      const names = [
        ...new Set(
          deptIdsOf(row)
            .map((id) => nameById.get(id))
            .filter((v): v is string => !!v),
        ),
      ];
      return {
        ...row,
        sample: {
          ...row.sample,
          departmentLabel: names.length > 0 ? names.join(', ') : null,
        },
      };
    });
  }

  /**
   * Attach each transfer's `outsourceCenterName` (the OUTSOURCE destination's
   * display name). `SampleTransfer.outsourceCenterId` is a logical ref (no Prisma
   * relation), so the names are resolved in one tenant-scoped `OutsourceCenter`
   * query — deliberately WITHOUT a `deletedAt` filter, so a historical transfer to
   * a since-deactivated center still shows its name instead of surfacing the raw
   * id. Transfers with no center (not yet assigned) stay null.
   * @param tx the tenant-scoped transaction client (RLS GUC already set)
   * @param tenantId tenant scope for the OutsourceCenter lookup
   * @param rows the page of (dept-labelled) transfers
   */
  private async withOutsourceCenterNames(
    tx: Prisma.TransactionClient,
    tenantId: string,
    rows: SampleTransferDeptRow[],
  ): Promise<SampleTransferListRow[]> {
    const centerIds = [
      ...new Set(
        rows.map((r) => r.outsourceCenterId).filter((v): v is string => !!v),
      ),
    ];
    const nameById = new Map<string, string>();
    if (centerIds.length > 0) {
      const centers = await tx.outsourceCenter.findMany({
        where: { id: { in: centerIds }, tenantId },
        select: { id: true, name: true },
      });
      centers.forEach((c) => nameById.set(c.id, c.name));
    }
    return rows.map((row) => ({
      ...row,
      outsourceCenterName: row.outsourceCenterId
        ? (nameById.get(row.outsourceCenterId) ?? null)
        : null,
    }));
  }

  /**
   * Fetch one transfer with its sample + order context.
   * @param actingBranchId the caller's ACTIVE branch. When given, the branch must
   *   be the transfer's sender / holder / receiver, or have a stake in its sample
   *   (see {@link OrderSampleService.branchMayReadSample}); otherwise the transfer
   *   is reported as not found. Omit (or null, for a tenant-wide caller such as
   *   the business admin) to read without the branch check - the service's own
   *   internal reads do.
   * @throws SampleTransferNotFoundException if missing/soft-deleted/other tenant,
   *   or if the caller's branch has no stake in it
   */
  async findTransferById(
    id: string,
    tenantId: string,
    actingBranchId?: string | null,
  ): Promise<SampleTransferWithRelations> {
    const transfer = await this.prisma.sampleTransfer.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: TRANSFER_INCLUDE,
    });
    if (!transfer) throw new SampleTransferNotFoundException(id);
    if (actingBranchId) {
      const ownTransfer = [
        transfer.branchId,
        transfer.originBranchId,
        transfer.destinationBranchId,
      ].includes(actingBranchId);
      if (
        !ownTransfer &&
        !(await this.samples.branchMayReadSample(
          transfer.sampleId,
          tenantId,
          actingBranchId,
        ))
      ) {
        // Same answer as a missing transfer: do not confirm that it exists.
        throw new SampleTransferNotFoundException(id);
      }
    }
    return transfer;
  }

  // ── Engine ───────────────────────────────────────────────────────────────

  /**
   * Transition a sample (Send/Forward/Outsource) and create its `SampleTransfer`
   * for each id in one transaction. All-or-nothing across the id set.
   */
  private async dispatch(
    sampleIds: string[],
    tenantId: string,
    personId: string | null,
    sampleAction: 'send' | 'forward' | 'outsource',
    kind: TransferKind,
    dto: TransferDispatchDto,
    destination: TransferDestination,
  ): Promise<BulkActionResult<SampleTransferWithRelations>> {
    const now = new Date();
    const sendDate = dto.sendDate ? new Date(dto.sendDate) : now;
    const skipped: BulkSkippedItem[] = [];
    const created = await this.prisma.withTenant(tenantId, async (tx) => {
      // Pre-read id → accession/status so a skipped sample can be named in the
      // result without a per-skip query. Only the `skipInvalid` path skips (and
      // reads this), so single / strict dispatches don't pay for the lookup. A
      // skipped sample is never transitioned, so its status is still accurate.
      const metaById = new Map<
        string,
        { id: string; accessionNo: string; status: SampleStatus }
      >();
      if (dto.skipInvalid) {
        const metaRows = await tx.orderSample.findMany({
          where: { id: { in: sampleIds }, tenantId, deletedAt: null },
          select: { id: true, accessionNo: true, status: true },
        });
        for (const r of metaRows) metaById.set(r.id, r);
      }
      const done: Array<{ sampleId: string; transferId: string }> = [];
      // One fixed order (ascending id) so overlapping group sends cannot deadlock;
      // the result is put back in the request's order below.
      for (const sampleId of inLockOrder(sampleIds)) {
        // Group override: `force` moves every sample straight to the transfer's
        // target status regardless of its current one; `skipInvalid` skips
        // samples not in a legal state instead of failing the whole batch.
        let sample: OrderSample;
        try {
          if (kind === TransferKind.INTERNAL) {
            await this.samples.assertInternalSendable(
              tx,
              tenantId,
              sampleId,
              destination.destinationBranchId ?? null,
            );
          }
          sample = await this.samples.transitionInTx(
            tx,
            tenantId,
            personId,
            sampleId,
            sampleAction,
            () => ({
              data: {
                dispatchedAt: sendDate,
                logisticsType: dto.logisticsType ?? null,
                logisticsPerson: dto.logisticsPerson ?? null,
              },
            }),
            {
              notes: dto.notes,
              attachmentUrl: dto.attachmentUrl,
              force: dto.force,
              skipInvalid: dto.skipInvalid,
            },
          );
        } catch (e) {
          if (
            dto.skipInvalid &&
            e instanceof InvalidSampleTransitionException
          ) {
            const meta = metaById.get(sampleId);
            skipped.push({
              id: sampleId,
              accessionNo: meta?.accessionNo ?? null,
              reason: refusalMessage(e),
              code: e.errorCode,
            });
            continue;
          }
          throw e;
        }
        const data: Prisma.SampleTransferUncheckedCreateInput = {
          tenantId,
          branchId: sample.branchId,
          sampleId: sample.id,
          kind,
          transferStatus: TransferStatus.IN_TRANSIT,
          // The branch sending on THIS hop (the one holding the sample now), not
          // the chain's first sender: B forwarding its copy to C is B's outgoing
          // transfer. The sample's own `originBranchId` keeps the true origin.
          originBranchId: sample.branchId,
          destinationBranchId: destination.destinationBranchId ?? null,
          outsourceCenterId: destination.outsourceCenterId ?? null,
          externalPartnerName: destination.externalPartnerName ?? null,
          externalPartnerRef: destination.externalPartnerRef ?? null,
          outsourceStatus: destination.outsourceStatus ?? null,
          sendDate,
          sendTime: dto.sendTime ?? null,
          sampleForm: dto.sampleForm ?? null,
          logisticsType: dto.logisticsType ?? null,
          logisticsPerson: dto.logisticsPerson ?? null,
          createdBy: personId,
          updatedBy: personId,
        };
        const transfer = await tx.sampleTransfer.create({ data });
        // For an INTERNAL send with a known destination, reflect where the
        // sample is now being processed on the source row itself, so the origin
        // branch's In-House list shows `processing = destination branch` (not the
        // origin) once it's sent. Forward/outsource have no local receiving
        // branch, so they leave the processing branch unchanged.
        if (kind === TransferKind.INTERNAL && destination.destinationBranchId) {
          await tx.orderSample.update({
            where: { id: sample.id },
            data: {
              processingBranchId: destination.destinationBranchId,
              updatedBy: personId,
            },
          });
        }
        done.push({ sampleId, transferId: transfer.id });
      }
      return done;
    });
    const succeeded = await Promise.all(
      inRequestOrder(created, sampleIds, (x) => x.sampleId).map((x) =>
        this.findTransferById(x.transferId, tenantId),
      ),
    );
    return {
      succeeded,
      skipped: inRequestOrder(skipped, sampleIds, (x) => x.id),
    };
  }

  /**
   * Apply a validated §B.10 transfer transition to each id in one transaction. On
   * INTERNAL `accept`, clones the sample into the receiving branch's In-House list
   * (RULE 1); on `reject` of an already-accepted INTERNAL transfer, unwinds that
   * clone first. Strict bulk is all-or-nothing; with `skipInvalid` (bulk / group
   * actions) a transfer not in a legal state is skipped and recorded in the
   * result's `skipped` list. Returns the changed rows + the skipped ids.
   * @throws SampleTransferNotFoundException / InvalidTransferTransitionException
   * @throws TransferDestinationMissingException / AccessionNumberConflictException
   */
  private async transferAction(
    transferIds: string[],
    tenantId: string,
    personId: string | null,
    actingBranchId: string | null,
    action: TransferAction,
    build: () => Prisma.SampleTransferUpdateManyMutationInput,
    skipInvalid = false,
    reason?: string,
  ): Promise<BulkActionResult<SampleTransferWithRelations>> {
    const skipped: BulkSkippedItem[] = [];
    let changed: string[];
    // Sender-side samples returned to REPEAT by this call (notified once the
    // transaction has committed).
    const returnedSampleIds: string[] = [];
    try {
      changed = await this.prisma.withTenant(tenantId, async (tx) => {
        // Pre-read transfer id → sample accession no so a skipped transfer can be
        // named in the result. Only the skipInvalid path reads this.
        const accNoById = new Map<string, string | null>();
        if (skipInvalid) {
          const metaRows = await tx.sampleTransfer.findMany({
            where: { id: { in: transferIds }, tenantId, deletedAt: null },
            select: { id: true, sample: { select: { accessionNo: true } } },
          });
          for (const r of metaRows) {
            accNoById.set(r.id, r.sample?.accessionNo ?? null);
          }
        }
        const done: string[] = [];
        // Always work through the transfers in the SAME order (sorted by id), not the
        // order the user selected them in. Two overlapping group actions that picked
        // the same rows in opposite orders would otherwise each hold a lock the other
        // is waiting for (a deadlock -> 500); with one fixed order the second simply
        // waits for the first. The result is put back in the request's order below.
        for (const id of inLockOrder(transferIds)) {
          const transfer = await tx.sampleTransfer.findFirst({
            where: { id, tenantId, deletedAt: null },
          });
          if (!transfer) throw new SampleTransferNotFoundException(id);
          // Only the RECEIVING branch works an INTERNAL transfer. The caller's
          // active branch (the profile they are working as) must be the transfer's
          // destination; a transfer nobody was addressed to falls through to the
          // "destination missing" refusal below. Always an error, never a "skip":
          // a group action must not reveal or touch another branch's transfers.
          if (
            transfer.kind === TransferKind.INTERNAL &&
            transfer.destinationBranchId &&
            transfer.destinationBranchId !== actingBranchId
          ) {
            throw new TransferWrongBranchException(
              transfer.id,
              action,
              'receiver',
            );
          }
          // A cancelled order's transfers are frozen - the forward steps (pick up,
          // receive, accept) are refused. Reject and Repeat stay open so the
          // receiving branch can send the sample back and wind it down.
          if (
            action === 'pick-up' ||
            action === 'receive' ||
            action === 'accept'
          ) {
            const transferred = await tx.orderSample.findFirst({
              where: { id: transfer.sampleId, tenantId },
              select: { orderId: true },
            });
            // Accept creates new records (the copy at the receiving branch), so it
            // takes the order row FOR SHARE first: a cancel that is committing at
            // this very moment is waited for, and the check below then sees it.
            // (Accepts of the same order do not block each other.)
            if (transferred && action === 'accept') {
              await tx.$queryRaw`SELECT id FROM orders WHERE id = ${transferred.orderId} AND tenant_id = ${tenantId} FOR SHARE`;
            }
            if (
              transferred &&
              (await this.samples.isOrderCancelled(
                tx,
                tenantId,
                transferred.orderId,
              ))
            ) {
              const refusal = new TransferOrderCancelledException(
                transfer.id,
                action,
              );
              // A group "skip invalid" call must not fail as a whole because one
              // transfer belongs to a cancelled order: skip it, say why, and carry
              // on with the others. Nothing has been written for it yet. A single
              // action (or a group without skip invalid) still gets the 409.
              if (skipInvalid) {
                skipped.push({
                  id,
                  accessionNo: accNoById.get(id) ?? null,
                  reason: refusalMessage(refusal),
                  code: refusal.errorCode,
                });
                continue;
              }
              throw refusal;
            }
          }
          // An INTERNAL transfer nobody was addressed to cannot be picked up,
          // received or accepted — the sender must assign a branch first (Assign
          // Center closes once the receiver has it, so it would be stuck).
          if (
            transfer.kind === TransferKind.INTERNAL &&
            !transfer.destinationBranchId &&
            (action === 'pick-up' ||
              action === 'receive' ||
              action === 'accept')
          ) {
            throw new TransferDestinationMissingException(transfer.id);
          }
          const to = nextTransferStatus(action, transfer.transferStatus);
          if (!to) {
            if (skipInvalid) {
              skipped.push({
                id,
                accessionNo: accNoById.get(id) ?? null,
                reason: `Transfer action "${action}" is not allowed from status ${transfer.transferStatus}`,
                code: 'INVALID_TRANSFER_TRANSITION',
              });
              continue;
            }
            throw new InvalidTransferTransitionException(
              action,
              transfer.transferStatus,
            );
          }
          // Reject / Repeat after acceptance (INTERNAL): the accept created a copy in
          // the receiving branch. `returnToSender` below owns that wind-down - it voids
          // the copy, refuses when a report at the receiver already has a validated
          // result, and resets the report and hands it back to the sender. The earlier
          // clone pre-unwind is deliberately NOT run here: it would void the copy first
          // and `returnToSender` would then find none (and skip the validated-result
          // check). Only INTERNAL transfers ever have a copy (`clonedSampleId`).
          let clonedSampleId: string | null = null;
          if (action === 'accept') {
            clonedSampleId = await this.cloneIntoDestination(
              tx,
              tenantId,
              personId,
              transfer,
            );
          }
          // Receiving branch rejects / repeats an INTERNAL transfer: the test
          // goes back to the sender (its original sample -> REPEAT).
          if (
            transfer.kind === TransferKind.INTERNAL &&
            (action === 'reject' || action === 'repeat')
          ) {
            // A group "skip invalid" action must not fail as a whole because one
            // transfer cannot go back (a validated result at the receiver, or its
            // copy already passed on to another branch: both are
            // `InvalidSampleTransitionException`s). Each return runs inside a
            // savepoint so that a transfer which is skipped leaves nothing behind,
            // even when it has several copies and the refusal comes after the
            // first one was already returned.
            if (skipInvalid) await tx.$executeRaw`SAVEPOINT return_to_sender`;
            try {
              const returned = await this.returnToSender(
                tx,
                tenantId,
                personId,
                transfer,
                reason,
                action,
              );
              if (skipInvalid) {
                await tx.$executeRaw`RELEASE SAVEPOINT return_to_sender`;
              }
              returnedSampleIds.push(...returned);
            } catch (e) {
              if (
                skipInvalid &&
                e instanceof InvalidSampleTransitionException
              ) {
                await tx.$executeRaw`ROLLBACK TO SAVEPOINT return_to_sender`;
                await tx.$executeRaw`RELEASE SAVEPOINT return_to_sender`;
                skipped.push({
                  id,
                  accessionNo: accNoById.get(id) ?? null,
                  reason: refusalMessage(e),
                  code: e.errorCode,
                });
                continue;
              }
              throw e;
            }
          }
          // Conditional on the status we validated: a concurrent Retrieve /
          // action that already moved the transfer makes this a no-op → refuse
          // instead of overwriting it.
          const updated = await tx.sampleTransfer.updateMany({
            where: {
              id: transfer.id,
              deletedAt: null,
              transferStatus: transfer.transferStatus,
            },
            data: {
              ...build(),
              transferStatus: to,
              // Link the transfer to the clone it just created so a later recall
              // (Retrieve) can unwind the clone (§A.10.19).
              ...(clonedSampleId ? { clonedSampleId } : {}),
              // The clone was just unwound (reject-after-accept) — clear the link.
              ...(action === 'reject' && transfer.clonedSampleId
                ? { clonedSampleId: null }
                : {}),
              updatedBy: personId,
            },
          });
          if (updated.count !== 1) {
            throw new InvalidTransferTransitionException(
              action,
              transfer.transferStatus,
            );
          }
          done.push(transfer.id);
        }
        return done;
      });
    } catch (e) {
      this.rethrowConflict(e);
      throw e;
    }
    if (returnedSampleIds.length > 0) {
      await this.samples.notifySamplesRepeated(tenantId, returnedSampleIds);
    }
    // The work ran in sorted-id order; report it in the order the caller asked.
    const succeeded = await Promise.all(
      inRequestOrder(changed, transferIds, (x) => x).map((id) =>
        this.findTransferById(id, tenantId),
      ),
    );
    return {
      succeeded,
      skipped: inRequestOrder(skipped, transferIds, (x) => x.id),
    };
  }

  /**
   * The receiving branch rejected/repeated an INTERNAL transfer — hand the test
   * back to the sender, inside the caller's transaction:
   *  - before the receiver accepted (`RECEIVED`): the sender's original sample
   *    goes `SENT_INTERNAL → REPEAT` (its report never left the sender, and stops
   *    being hidden);
   *  - after the receiver accepted (`ACCEPTED`, Repeat or Reject): the receiver's
   *    copy is voided, the report returns to the sender, and the original sample
   *    goes to `REPEAT` — refused if the report has been worked on
   *    (see `OrderSampleService.returnCopyToOrigin`).
   * @returns the sender's original sample id(s) that went to `REPEAT`
   * @throws SampleReturnBlockedException if a report at the receiver was worked on
   * @throws ValidationException if the receiver's copy cannot be found
   */
  private async returnToSender(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    transfer: { id: string; sampleId: string; transferStatus: TransferStatus },
    reason: string | undefined,
    action: 'repeat' | 'reject',
  ): Promise<string[]> {
    const why = reason ?? 'Returned by the receiving branch';
    if (transfer.transferStatus === TransferStatus.ACCEPTED) {
      const copies = await tx.orderSample.findMany({
        where: { sourceTransferId: transfer.id, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (copies.length === 0) {
        throw new ValidationException(
          "The receiving branch's copy of this sample was not found.",
        );
      }
      const originIds: string[] = [];
      for (const copy of copies) {
        originIds.push(
          await this.samples.returnCopyToOrigin(
            tx,
            tenantId,
            personId,
            copy.id,
            why,
            action,
          ),
        );
      }
      return originIds;
    }
    await this.samples.transitionInTx(
      tx,
      tenantId,
      personId,
      transfer.sampleId,
      'repeat',
      () => ({ data: {}, reason: why }),
      {
        force: true,
        system: true,
        notes: `Returned by the receiving branch: ${why}`,
      },
    );
    return [transfer.sampleId];
  }

  /**
   * RULE 1 (PDF §B.11.3): when an INTERNAL transfer is accepted, materialise the
   * sample in the receiving branch's In-House list — a new `OrderSample` at
   * status `ACCEPTED`, in the destination branch, carrying the same order + tests.
   * External/outsource transfers have no local receiving branch, so no clone.
   */
  private async cloneIntoDestination(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    transfer: {
      id: string;
      kind: TransferKind;
      sampleId: string;
      destinationBranchId: string | null;
      receiveCondition: string | null;
    },
  ): Promise<string | null> {
    if (transfer.kind !== TransferKind.INTERNAL) return null;
    if (!transfer.destinationBranchId) {
      throw new TransferDestinationMissingException(transfer.id);
    }
    const source = await tx.orderSample.findFirst({
      where: { id: transfer.sampleId, tenantId, deletedAt: null },
      include: { tests: true },
    });
    if (!source) throw new OrderSampleNotFoundException(transfer.sampleId);

    const destBranch = transfer.destinationBranchId;
    const now = new Date();
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { accessionCounter: { increment: 1 } },
      select: { accessionCounter: true },
    });
    const accessionNo = `ACC-${String(tenant.accessionCounter).padStart(5, '0')}`;
    const cloned = await tx.orderSample.create({
      data: {
        tenantId,
        branchId: destBranch,
        orderId: source.orderId,
        labTestId: source.labTestId,
        labTestSampleId: source.labTestSampleId,
        departmentId: source.departmentId,
        accessionNo,
        sampleType: source.sampleType,
        containerType: source.containerType,
        sampleGroupLabel: source.sampleGroupLabel,
        sampleName: source.sampleName,
        priority: source.priority,
        status: SampleStatus.ACCEPTED,
        originBranchId: source.originBranchId ?? source.branchId,
        processingBranchId: destBranch,
        sourceTransferId: transfer.id,
        // Branches this sample has been with (sender's list + sender + receiver):
        // it can never be sent back to any of them.
        heldBranchIds: heldBranchesForCopy(source, destBranch),
        // The same physical tube travels with its barcode label, so the
        // receiving branch scans / prints the same barcode (its analyser can then
        // find the copy). A voided copy releases it again (soft-deleted rows are
        // ignored by the barcode-uniqueness checks).
        barcode: source.barcode,
        orderIdBarcode: source.orderIdBarcode,
        receivedAt: now,
        acceptedAt: now,
        sampleCondition: transfer.receiveCondition,
        createdBy: personId,
        updatedBy: personId,
        tests: {
          create: source.tests.map((t) => ({
            tenantId,
            branchId: destBranch,
            orderItemId: t.orderItemId,
            labTestId: t.labTestId,
            testName: t.testName,
          })),
        },
        statusHistory: {
          create: {
            tenantId,
            branchId: destBranch,
            action: 'transfer-accept',
            toStatus: SampleStatus.ACCEPTED,
            changedBy: personId,
          },
        },
      },
    });

    // Real Technician Reporting trigger — this clone is created directly at
    // ACCEPTED (RULE 1), bypassing transitionIds/transitionInTx, so it needs
    // its own call (see OrderSampleService.ensureLabReportsForAcceptedSample).
    await this.samples.ensureLabReportsForAcceptedSample(
      tx,
      tenantId,
      cloned.id,
      personId,
    );

    // The LabReport was created at the origin branch during the origin accept,
    // so the ensure-call above is an idempotent no-op here. Move it to the
    // receiving branch so it leaves the origin (which no longer holds the
    // sample) and surfaces in this branch's Technician worklist.
    await this.samples.rehomeLabReportsForSample(
      tx,
      tenantId,
      cloned.id,
      destBranch,
      source.branchId,
    );

    return cloned.id;
  }

  /** Validate an outsource center belongs to the caller's tenant. */
  private async assertOutsourceCenter(
    id: string,
    tenantId: string,
  ): Promise<void> {
    const center = await this.prisma.outsourceCenter.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!center) throw new OutsourceCenterNotFoundException(id);
  }

  /** Translate a Prisma unique clash (clone accession number) into a 409. */
  private rethrowConflict(e: unknown): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new AccessionNumberConflictException('');
    }
  }
}
