import { Injectable } from '@nestjs/common';
import { timestampRange } from '../../common/utils/date-range.util';
import {
  AccessionGroupingMode,
  AuditAction,
  AuditModule,
  OrderSample,
  Prisma,
  SampleStatus,
  TransferKind,
  TransferStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult, paginated } from '../../common/dto/response.dto';
import {
  KaltrosException,
  ValidationException,
} from '../../common/exceptions/kaltros.exception';
import { BranchService } from '../branch/branch.service';
import { PermissionCheckService } from '../permissions/services/permission-check.service';
import {
  ACCESSION_TRANSFER_KEY_GROUPS,
  PERMISSION_KEYS,
} from '../permissions/constants/module-permissions.constant';
import { OrderSampleService } from './accession-sample.service';
import {
  TransferAction,
  nextTransferStatus,
  previousTransferStatus,
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
import { ApplyCenterChangesDto } from './dto/apply-center-changes.dto';
import { OutsourceStatusDto } from './dto/outsource-status.dto';
import { ListTransfersDto } from './dto/list-transfers.dto';
import {
  TRANSFER_INCLUDE,
  SampleTransferCenterRow,
  SampleTransferDeptRow,
  SampleTransferListRow,
  SampleTransferWithRelations,
  SampleTransferWithFlag,
} from './entities/sample-transfer.entity';
import { barcodeGroupKey } from './utils/barcode-group-key';
import {
  HIDDEN_FROM_RECEIVER_WHERE,
  isHiddenFromReceiver,
} from './utils/receiver-visibility.util';
import { missingOutsourceAssignment } from './utils/outsource-assignment.util';
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
  CenterChangesRefusedException,
  TransferItemRemovedException,
  TransferLogisticsMissingException,
  TransferOutsourceNotAssignedException,
  TransferRetrieveBlockedException,
  TransferWrongBranchException,
  refusalMessage,
  OutsourceCenterNotFoundException,
  SampleTransferNotFoundException,
  TransferDestinationMissingException,
  TransferNotOutsourceException,
  TransferNotEditableException,
  TransferCenterChangedException,
  CenterChangesBusyException,
  DestinationLacksTestException,
  SendBlockedException,
} from './exceptions/accession.exceptions';
import { inLockOrder, inRequestOrder } from './utils/request-order.util';
import {
  findItemRemovedSampleIds,
  isSampleItemRemoved,
} from './utils/item-removed.util';
import {
  PREVIOUS_HOLDER_MESSAGE,
  heldBranchesForCopy,
  isPreviousHolder,
} from './utils/previous-holders.util';
import { assertDestinationOffers } from './utils/destination-offers.util';

/** Destination fields resolved once per Send/Forward/Outsource batch. */
/** A checked Assign / Edit Center, ready to write (see `prepareCenterChange`). */
/** Who made a center change, for the Audit-log entries (the role comes from the request). */
interface CenterChangeActor {
  roleKey?: string | null;
  roleLabel?: string | null;
}

/** Human-readable text for a transfer status, used in the Retrieve history note. */
const TRANSFER_STATUS_TEXT: Readonly<Record<TransferStatus, string>> = {
  [TransferStatus.IN_TRANSIT]: 'In Transit',
  [TransferStatus.PICKED_UP]: 'Picked Up',
  [TransferStatus.RECEIVED]: 'Received',
  [TransferStatus.ACCEPTED]: 'Accepted',
  [TransferStatus.REPEAT]: 'Repeat',
  [TransferStatus.REJECTED]: 'Rejected',
};

/** A deadlock or write conflict reported by the database (the request was rolled back). */
function isDatabaseConflict(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
    return true;
  }
  const text = e instanceof Error ? e.message : '';
  return /deadlock detected|40P01|could not serialize access/i.test(text);
}

interface PreparedCenterChange {
  transferId: string;
  transfer: SampleTransferWithRelations;
  dto: AssignCenterDto;
  data: Prisma.SampleTransferUpdateInput;
  /** The destination the dialog was showing (`null` = none); undefined = do not check. */
  expectedDestination?: string | null;
}

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

  /**
   * Retrieve (§B.13 undo): move each transfer **back exactly one status step** along
   * the receiving lifecycle — `ACCEPTED → RECEIVED → PICKED_UP → IN_TRANSIT`, and the
   * send-backs `REPEAT`/`REJECTED → RECEIVED`. Repeatable until `IN_TRANSIT`, where
   * there is nothing left to undo and the action is refused (or skipped, in a group).
   * Each step writes a `retrieve` history row. This changes only `transferStatus`
   * (and clears the just-undone step's own timestamp for a coherent record) — it does
   * **not** void the accept-time clone or reverse a sender-side return (deliberately
   * scoped out; those are the heavy recall path). Mirrors the forward engine's
   * per-id lock order, optimistic status claim, and `skipInvalid` behaviour.
   * @throws SampleTransferNotFoundException / TransferWrongBranchException
   * @throws TransferItemRemovedException / InvalidTransferTransitionException
   */
  async retrieveTransfer(
    transferIds: string[],
    tenantId: string,
    personId: string | null,
    actingBranchId: string | null,
    _dto: SampleNoteDto,
    skipInvalid = false,
  ): Promise<BulkActionResult<SampleTransferWithRelations>> {
    const skipped: BulkSkippedItem[] = [];
    let changed: string[];
    try {
      changed = await this.prisma.withTenant(tenantId, async (tx) => {
        // Pre-read id → accession no so a skipped transfer can be named in the result.
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
        // Fixed (sorted) id order, like the forward engine, so two overlapping group
        // actions never deadlock — the second waits on the first instead.
        for (const id of inLockOrder(transferIds)) {
          const transfer = await tx.sampleTransfer.findFirst({
            where: { id, tenantId, deletedAt: null },
          });
          if (!transfer) throw new SampleTransferNotFoundException(id);
          // Only the RECEIVING branch of an INTERNAL transfer may act on it; a group
          // action must not touch another branch's transfers (always an error).
          if (
            transfer.kind === TransferKind.INTERNAL &&
            transfer.destinationBranchId &&
            transfer.destinationBranchId !== actingBranchId
          ) {
            throw new TransferWrongBranchException(
              transfer.id,
              'retrieve',
              'receiver',
            );
          }
          // A transfer whose test was removed from the order is frozen.
          if (await isSampleItemRemoved(tx, tenantId, transfer.sampleId)) {
            const refusal = new TransferItemRemovedException(
              transfer.id,
              'retrieve',
            );
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
          const to = previousTransferStatus(transfer.transferStatus);
          if (!to) {
            // IN_TRANSIT — nothing for the receiver to undo.
            if (skipInvalid) {
              skipped.push({
                id,
                accessionNo: accNoById.get(id) ?? null,
                reason: `Transfer action "retrieve" is not allowed from status ${transfer.transferStatus}`,
                code: 'INVALID_TRANSFER_TRANSITION',
              });
              continue;
            }
            throw new InvalidTransferTransitionException(
              'retrieve',
              transfer.transferStatus,
            );
          }
          // The source (sender's) sample — for the history row and, when undoing an
          // accept, the branch its report(s) return to. Its own `branchId` is the
          // IMMEDIATE sender of this hop (where the report sat before the receiver
          // accepted) — for a chain A→B→C that is B, not the true origin A.
          const sample = await tx.orderSample.findFirst({
            where: { id: transfer.sampleId, tenantId },
            select: { id: true, branchId: true, status: true },
          });
          // Clear the just-undone step's own fields so the record stays coherent.
          const clear: Prisma.SampleTransferUpdateManyMutationInput = {};
          if (transfer.transferStatus === TransferStatus.PICKED_UP) {
            clear.pickedUpAt = null;
            clear.pickedUpBy = null;
          } else if (transfer.transferStatus === TransferStatus.RECEIVED) {
            clear.receivedAt = null;
            clear.receiveCondition = null;
          } else if (transfer.transferStatus === TransferStatus.ACCEPTED) {
            clear.acceptedAt = null;
            // Undoing an accepted INTERNAL transfer: the accept materialised a copy
            // in the receiving branch's In-House list (RULE 1). Unwind it so a later
            // re-Accept does not create a DUPLICATE — soft-delete the copy + move its
            // report(s) back to origin (`removeTransferCloneInTx`, idempotent) and
            // clear the link. Refuse (422) if the receiver has already started working
            // the copy (status past ACCEPTED): undoing would lose that work.
            if (
              transfer.kind === TransferKind.INTERNAL &&
              transfer.clonedSampleId
            ) {
              const clone = await tx.orderSample.findFirst({
                where: {
                  id: transfer.clonedSampleId,
                  tenantId,
                  deletedAt: null,
                },
                select: { id: true, status: true },
              });
              if (clone) {
                if (clone.status !== SampleStatus.ACCEPTED) {
                  const refusal = new TransferRetrieveBlockedException(
                    transfer.id,
                    clone.status,
                  );
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
                await this.samples.removeTransferCloneInTx(
                  tx,
                  tenantId,
                  personId,
                  clone.id,
                  sample?.branchId ?? null,
                );
              }
              clear.clonedSampleId = null;
            }
          }
          // Conditional on the status we validated: a concurrent action that already
          // moved the transfer makes this a no-op → refuse instead of overwriting.
          const updated = await tx.sampleTransfer.updateMany({
            where: {
              id: transfer.id,
              deletedAt: null,
              transferStatus: transfer.transferStatus,
            },
            data: { ...clear, transferStatus: to, updatedBy: personId },
          });
          if (updated.count !== 1) {
            throw new InvalidTransferTransitionException(
              'retrieve',
              transfer.transferStatus,
            );
          }
          // Document the step-back on the sample's history timeline (the transfer's
          // own status change; the sample's status is unchanged by a transfer undo).
          if (sample) {
            await tx.orderSampleStatusHistory.create({
              data: {
                tenantId,
                branchId: sample.branchId,
                sampleId: sample.id,
                action: 'retrieve',
                fromStatus: sample.status,
                toStatus: sample.status,
                notes: `Transfer moved back from ${TRANSFER_STATUS_TEXT[transfer.transferStatus]} to ${TRANSFER_STATUS_TEXT[to]} (Retrieve)`,
                changedBy: personId,
              },
            });
          }
          done.push(transfer.id);
        }
        return done;
      });
    } catch (e) {
      this.rethrowConflict(e);
      throw e;
    }
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

  // ── Destination management & manual outsource status ───────────────────────

  /** Assign Center (§A.7): set the destination on a transfer created without one. */
  async assignCenter(
    transferId: string,
    tenantId: string,
    personId: string | null,
    dto: AssignCenterDto,
    actor?: {
      branchId: string | null;
      profileKey: string | null;
      roleKey?: string | null;
      roleLabel?: string | null;
    },
  ): Promise<SampleTransferWithRelations> {
    const prepared = await this.prepareCenterChange(
      transferId,
      tenantId,
      personId,
      dto,
      actor,
    );
    await this.prisma.withTenant(tenantId, (tx) =>
      this.persistCenterChange(tx, tenantId, personId, prepared, actor),
    );
    return this.findTransferById(transferId, tenantId);
  }

  /**
   * Every check of an Assign / Edit Center (sender branch, cancelled order, removed
   * test, the In-Transit / Picked Up window, permission, destination rules) and the
   * data to write - without writing anything. Shared by the single Assign Center and
   * the all-or-nothing "apply center changes".
   */
  private async prepareCenterChange(
    transferId: string,
    tenantId: string,
    personId: string | null,
    dto: AssignCenterDto,
    actor?: { branchId: string | null; profileKey: string | null },
    expectedDestination?: string | null,
  ): Promise<PreparedCenterChange> {
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
    // A transfer whose test was removed from the order is frozen, destination
    // included.
    if (await isSampleItemRemoved(this.prisma, tenantId, transfer.sampleId)) {
      throw new TransferItemRemovedException(transferId, 'assign-center');
    }
    // An INTERNAL transfer's destination can only change until the receiving
    // branch has received it (same window as Retrieve). An OUTSOURCE transfer follows
    // the same window: once the outside lab has it, or sent it back (Repeated /
    // Rejected), there is nothing left to re-address.
    if (
      (transfer.kind === TransferKind.INTERNAL ||
        transfer.kind === TransferKind.OUTSOURCE) &&
      transfer.transferStatus !== TransferStatus.IN_TRANSIT &&
      transfer.transferStatus !== TransferStatus.PICKED_UP
    ) {
      throw new TransferNotEditableException(
        transferId,
        transfer.transferStatus,
        transfer.kind === TransferKind.OUTSOURCE,
      );
    }
    // The dialog must be showing the center the tube has NOW: if someone changed it
    // since the dialog opened, refuse instead of writing the stale value over theirs.
    if (
      transfer.kind === TransferKind.INTERNAL &&
      expectedDestination !== undefined &&
      (transfer.destinationBranchId ?? null) !== expectedDestination
    ) {
      throw new TransferCenterChangedException(
        transferId,
        expectedDestination,
        transfer.destinationBranchId ?? null,
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
      // ... and only to a branch that offers every test on the tube. Checked when the
      // destination CHANGES (a logistics-only save keeps the destination it already had).
      if (dto.destinationBranchId !== transfer.destinationBranchId) {
        await assertDestinationOffers(
          this.prisma,
          tenantId,
          [transfer.sampleId],
          dto.destinationBranchId,
          'sender',
          transfer.sample.status,
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
    return { transferId, transfer, dto, data, expectedDestination };
  }

  /**
   * Writes a prepared Assign / Edit Center inside the caller's transaction. For an
   * INTERNAL transfer the update is conditional on the transfer still being
   * In-Transit / Picked Up, so a receiving branch that received it in the meantime
   * makes this refuse (and the caller's transaction roll back) instead of changing
   * a transfer it no longer owns.
   */
  private async persistCenterChange(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    prepared: PreparedCenterChange,
    actor?: CenterChangeActor,
  ): Promise<void> {
    const { transferId, transfer, dto, data, expectedDestination } = prepared;
    let resetFromPickedUp = false;
    if (transfer.kind === TransferKind.INTERNAL) {
      const updated = await tx.sampleTransfer.updateMany({
        where: {
          id: transferId,
          deletedAt: null,
          transferStatus: {
            in: [TransferStatus.IN_TRANSIT, TransferStatus.PICKED_UP],
          },
          // Still the center the dialog showed: a change that landed after the
          // check in prepareCenterChange matches nothing here.
          ...(expectedDestination !== undefined
            ? { destinationBranchId: expectedDestination }
            : {}),
        },
        data,
      });
      if (updated.count !== 1) {
        const now = await tx.sampleTransfer.findFirst({
          where: { id: transferId, deletedAt: null },
          select: { transferStatus: true, destinationBranchId: true },
        });
        const editable =
          now?.transferStatus === TransferStatus.IN_TRANSIT ||
          now?.transferStatus === TransferStatus.PICKED_UP;
        if (
          now &&
          editable &&
          expectedDestination !== undefined &&
          now.destinationBranchId !== expectedDestination
        ) {
          throw new TransferCenterChangedException(
            transferId,
            expectedDestination,
            now.destinationBranchId,
          );
        }
        throw new TransferNotEditableException(
          transferId,
          transfer.transferStatus,
        );
      }
      // A transfer the first branch had already PICKED UP, re-addressed to a different
      // branch, starts over at In-Transit: the new branch has not picked it up, and the
      // old branch's pick-up (who, when) must not be shown as the new branch's. Done as
      // its own conditional write so it follows the status as it is NOW, not as it was
      // read when the dialog was prepared.
      if (
        dto.destinationBranchId &&
        dto.destinationBranchId !== transfer.destinationBranchId
      ) {
        const reset = await tx.sampleTransfer.updateMany({
          where: {
            id: transferId,
            deletedAt: null,
            transferStatus: TransferStatus.PICKED_UP,
          },
          data: {
            transferStatus: TransferStatus.IN_TRANSIT,
            pickedUpBy: null,
            pickedUpAt: null,
          },
        });
        resetFromPickedUp = reset.count === 1;
      }
    } else {
      await tx.sampleTransfer.update({ where: { id: transferId }, data });
    }
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
    if (
      transfer.kind === TransferKind.INTERNAL &&
      dto.destinationBranchId &&
      dto.destinationBranchId !== transfer.destinationBranchId
    ) {
      await this.recordReAddressInTx(
        tx,
        tenantId,
        personId,
        prepared,
        resetFromPickedUp,
        actor,
      );
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
  }

  /**
   * Records an INTERNAL transfer's change of destination, inside the caller's
   * transaction (so it commits or rolls back with the change): a row on the sender's
   * sample history, and Audit-log entries - one under the sender's branch always, one
   * under the OLD destination when it had been able to see the transfer (it now loses
   * it), and one under the NEW destination when it can see it now. Each names the
   * sample, order, both branches and the stage, and says when a Picked-Up transfer was
   * started over at In-Transit. Skipped (audit only) when there is no acting person.
   */
  private async recordReAddressInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    personId: string | null,
    prepared: PreparedCenterChange,
    resetFromPickedUp: boolean,
    actor?: CenterChangeActor,
  ): Promise<void> {
    const { transferId, transfer, dto } = prepared;
    const fromId = transfer.destinationBranchId;
    const toId = dto.destinationBranchId as string;
    const sample = await tx.orderSample.findFirst({
      where: { id: transfer.sampleId, tenantId },
      select: {
        id: true,
        branchId: true,
        status: true,
        accessionNo: true,
        order: { select: { orderCode: true } },
      },
    });
    if (!sample) return;
    const branches = await tx.branch.findMany({
      where: {
        id: {
          in: [sample.branchId, fromId, toId].filter(
            (id): id is string => !!id,
          ),
        },
        tenantId,
      },
      select: { id: true, name: true },
    });
    const nameOf = (id: string | null): string | null =>
      id ? (branches.find((b) => b.id === id)?.name ?? null) : null;
    const senderName = nameOf(sample.branchId) ?? 'the sending branch';
    const fromName = nameOf(fromId);
    const toName = nameOf(toId) ?? 'another branch';
    const stage = resetFromPickedUp ? 'Picked Up' : 'In-Transit';
    const logistics = dto.logisticsType ?? transfer.logisticsType ?? null;
    const reset = resetFromPickedUp
      ? ' (it had been picked up, so it starts over at In-Transit)'
      : '';

    const text = fromName
      ? `Center changed from ${fromName} to ${toName} while ${stage}${reset}`
      : `Center assigned: ${toName}`;
    await tx.orderSampleStatusHistory.create({
      data: {
        tenantId,
        branchId: sample.branchId,
        sampleId: sample.id,
        action: 'assign-center',
        toStatus: sample.status,
        fromStatus: sample.status,
        notes: text,
        changedBy: personId,
      },
    });
    if (!personId) return;

    const base = {
      sampleId: sample.id,
      accessionNo: sample.accessionNo,
      orderCode: sample.order?.orderCode ?? null,
      transferId,
      stage,
      fromBranchId: fromId,
      fromBranch: fromName,
      toBranchId: toId,
      toBranch: toName,
      pickedUpReset: resetFromPickedUp,
    };
    const entries: {
      branchId: string | null;
      description: string;
      side: string;
    }[] = [
      {
        branchId: sample.branchId,
        side: 'sender',
        description: fromName
          ? `Changed the center of sample ${sample.accessionNo} from ${fromName} to ${toName} while ${stage}${reset}`
          : `Assigned center ${toName} to sample ${sample.accessionNo}`,
      },
    ];
    // The old destination saw it (a transfer In-Transit with no logistics type is
    // hidden from it) and now loses it.
    const oldSawIt =
      !!fromId &&
      !isHiddenFromReceiver({
        kind: TransferKind.INTERNAL,
        transferStatus: resetFromPickedUp
          ? TransferStatus.PICKED_UP
          : transfer.transferStatus,
        logisticsType: transfer.logisticsType,
      });
    if (oldSawIt) {
      entries.push({
        branchId: fromId,
        side: 'old-receiver',
        description: `Sample ${sample.accessionNo} was re-addressed by ${senderName} to ${toName}; it is no longer coming to ${fromName ?? 'your branch'} (it was ${stage})`,
      });
    }
    // The new destination sees it from now on (In-Transit needs a logistics type).
    const newSeesIt = !isHiddenFromReceiver({
      kind: TransferKind.INTERNAL,
      transferStatus: resetFromPickedUp
        ? TransferStatus.IN_TRANSIT
        : transfer.transferStatus,
      logisticsType: logistics,
    });
    if (newSeesIt) {
      entries.push({
        branchId: toId,
        side: 'new-receiver',
        description: `Sample ${sample.accessionNo} is now on its way to ${toName}, re-addressed by ${senderName}${fromName ? ` (it was going to ${fromName})` : ''}`,
      });
    }
    for (const e of entries) {
      await tx.auditLog.create({
        data: {
          tenantId,
          branchId: e.branchId,
          module: AuditModule.ACCESSION,
          action: AuditAction.UPDATE,
          description: e.description,
          actorPersonId: personId,
          actorRoleKey: actor?.roleKey ?? null,
          actorRoleLabel: actor?.roleLabel ?? null,
          resourceId: sample.id,
          metadata: { ...base, side: e.side },
        },
      });
    }
  }

  /**
   * The Assign / Edit Center dialog's Confirm as ONE all-or-nothing request: each
   * ticked tube gets its own center (`changes`), each un-ticked tube is retrieved
   * (`retrieveSampleIds`), and the logistics fields are shared by the changed tubes.
   * Everything is checked first (sender branch, cancelled order, removed test, the
   * In-Transit / Picked Up window, per-tube Assign / Update Center permission, and the
   * Retrieve permission when anything is un-ticked), then written in ONE transaction
   * with the writes conditional on the transfers still being In-Transit / Picked Up. If
   * any tube cannot be done - including a receiving branch that received one in the
   * meantime - nothing changes and the error names that tube
   * (`CENTER_CHANGES_REFUSED`).
   * @param actor the acting user's branch, profile and role (for permissions and the
   *   Audit-log entries of the retrieves)
   * @returns how many tubes got a new center and how many were retrieved
   */
  async applyCenterChanges(
    tenantId: string,
    personId: string | null,
    dto: ApplyCenterChangesDto,
    actor: {
      branchId: string | null;
      profileKey: string | null;
      roleKey: string | null;
      roleLabel: string | null;
    },
  ): Promise<{ changed: number; retrieved: number }> {
    const changes = dto.changes ?? [];
    const retrieveIds = [...new Set(dto.retrieveSampleIds ?? [])];
    if (changes.length === 0 && retrieveIds.length === 0) {
      throw new ValidationException('There is nothing to change.');
    }
    if (new Set(changes.map((c) => c.transferId)).size !== changes.length) {
      throw new ValidationException(
        'The same transfer appears twice in the center changes.',
      );
    }
    const permCtx = {
      tenantId,
      personId: personId ?? '',
      branchId: actor.branchId,
      profileKey: actor.profileKey,
    };
    // Un-ticking a tube is a Retrieve: it needs that permission (the screen greys it
    // out without it; this is the real guard).
    if (retrieveIds.length > 0) {
      await this.permissionCheck.assertAny(permCtx, [
        PERMISSION_KEYS.ACC_IH_RETRIEVE,
      ]);
    }

    // The accession number of a tube, to name it when it is the one that fails.
    const accessionOfSample = async (
      db: Pick<Prisma.TransactionClient, 'orderSample'>,
      sampleId: string,
    ): Promise<string> =>
      (
        await db.orderSample.findFirst({
          where: { id: sampleId, tenantId },
          select: { accessionNo: true },
        })
      )?.accessionNo ?? sampleId;
    const refuse = (accessionNo: string, e: unknown): unknown =>
      e instanceof KaltrosException
        ? new CenterChangesRefusedException(
            accessionNo,
            refusalMessage(e),
            e.errorCode,
          )
        : e;

    // 1. Check every center change (reads only).
    const prepared: PreparedCenterChange[] = [];
    for (const c of changes) {
      const shared = {
        sendDate: dto.sendDate,
        sendTime: dto.sendTime,
        sampleForm: dto.sampleForm,
        logisticsType: dto.logisticsType,
        logisticsPerson: dto.logisticsPerson,
        notes: dto.notes,
        attachmentUrl: dto.attachmentUrl,
      };
      const one = Object.assign(new AssignCenterDto(), shared, {
        destinationBranchId: c.destinationBranchId,
        outsourceCenterId: c.outsourceCenterId,
        externalPartnerName: c.externalPartnerName,
      });
      try {
        prepared.push(
          await this.prepareCenterChange(
            c.transferId,
            tenantId,
            personId,
            one,
            { branchId: actor.branchId, profileKey: actor.profileKey },
            c.expectedDestinationBranchId,
          ),
        );
      } catch (e) {
        const sample = await this.prisma.sampleTransfer.findFirst({
          where: { id: c.transferId, tenantId },
          select: { sample: { select: { accessionNo: true } } },
        });
        throw refuse(sample?.sample.accessionNo ?? c.transferId, e);
      }
    }
    const retrieving = new Set(retrieveIds);
    const clash = prepared.find((p) => retrieving.has(p.transfer.sampleId));
    if (clash) {
      throw new ValidationException(
        'A tube cannot be retrieved and have its center changed in the same request.',
      );
    }

    // 2. Write everything in ONE transaction; any refusal rolls all of it back.
    //    The tubes are worked in ONE fixed order - ascending sample id, retrieves and
    //    center changes together - whatever order the dialog listed them in. Two
    //    overlapping Confirms that visited the same tubes in different orders would
    //    otherwise each hold a row the other is waiting for (a deadlock -> HTTP 500).
    //    Both kinds of work lock the transfer row, then the sample row, so one global
    //    order by sample is enough.
    const note = { notes: dto.notes, attachmentUrl: dto.attachmentUrl };
    type Work =
      | { sampleId: string; retrieve: true }
      | { sampleId: string; retrieve: false; change: PreparedCenterChange };
    const work: Work[] = [
      ...retrieveIds.map((sampleId): Work => ({ sampleId, retrieve: true })),
      ...prepared.map(
        (change): Work => ({
          sampleId: change.transfer.sampleId,
          retrieve: false,
          change,
        }),
      ),
    ].sort((a, b) =>
      a.sampleId < b.sampleId ? -1 : a.sampleId > b.sampleId ? 1 : 0,
    );
    // Names the failing tube for a refusal the service itself raised. A database error
    // (a deadlock, a lost connection ...) has already aborted the transaction, so it
    // is passed on untouched: running another query now would only fail with
    // "current transaction is aborted" and hide the real error.
    const refusedInTx = async (
      tx: Prisma.TransactionClient,
      sampleId: string,
      e: unknown,
    ): Promise<unknown> =>
      e instanceof KaltrosException
        ? refuse(await accessionOfSample(tx, sampleId), e)
        : e;
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        for (const w of work) {
          if (w.retrieve) {
            // Only a sample sent to another branch and not yet received can be retrieved
            // here (the plain Retrieve would otherwise walk any other sample back).
            const open = await tx.sampleTransfer.findFirst({
              where: {
                sampleId: w.sampleId,
                tenantId,
                deletedAt: null,
                kind: TransferKind.INTERNAL,
                transferStatus: {
                  in: [TransferStatus.IN_TRANSIT, TransferStatus.PICKED_UP],
                },
              },
              select: { id: true },
            });
            try {
              if (!open) {
                throw new ValidationException(
                  'This tube is not waiting at another branch (it may already have been received or sent back), so it cannot be retrieved here.',
                );
              }
              await this.samples.retrieveOneInTx(
                tx,
                tenantId,
                personId,
                actor.branchId,
                w.sampleId,
                note,
                { roleKey: actor.roleKey, roleLabel: actor.roleLabel },
              );
            } catch (e) {
              throw await refusedInTx(tx, w.sampleId, e);
            }
          } else {
            try {
              await this.persistCenterChange(
                tx,
                tenantId,
                personId,
                w.change,
                actor,
              );
            } catch (e) {
              throw await refusedInTx(tx, w.sampleId, e);
            }
          }
        }
      });
    } catch (e) {
      // The database refused the whole request because another one held the same rows
      // (deadlock / write conflict): nothing was written, so say "try again".
      if (isDatabaseConflict(e)) throw new CenterChangesBusyException();
      throw e;
    }
    return { changed: prepared.length, retrieved: retrieveIds.length };
  }

  /** Manually update an OUTSOURCE transfer's status (CR-3 — no sync). */
  async updateOutsourceStatus(
    transferId: string,
    tenantId: string,
    personId: string | null,
    dto: OutsourceStatusDto,
  ): Promise<SampleTransferWithRelations> {
    const transfer = await this.findTransferById(transferId, tenantId);
    // Only a transfer to a third-party lab carries this manual status; refuse an
    // internal / external-partner one instead of writing text onto it.
    if (transfer.kind !== TransferKind.OUTSOURCE) {
      throw new TransferNotOutsourceException(transferId);
    }
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
      // The receiving branch does not see an INTERNAL transfer that is still
      // In-Transit with no logistics type: how it travels is not decided yet. It
      // appears once the sender sets one (see receiver-visibility.util). The sender's
      // own (outgoing) view is unchanged.
      where.AND = [{ NOT: HIDDEN_FROM_RECEIVER_WHERE }];
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
      // The tenant's live grouping mode — the SAME source the in-house grouped
      // list reads — so the referral queue buckets transfers into identical
      // Order → final-group groups (and re-grouping follows a mode change).
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { groupingMode: true },
      });
      const mode =
        tenant?.groupingMode ?? AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME;

      const rows = await tx.sampleTransfer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: TRANSFER_INCLUDE,
      });
      const count = await tx.sampleTransfer.count({ where });
      const deptRows = await this.withDepartmentLabels(tx, tenantId, rows);
      const centerRows = await this.withOutsourceCenterNames(
        tx,
        tenantId,
        deptRows,
      );
      const flaggedRows = await this.withItemRemoved(tx, tenantId, centerRows);
      const fullRows = this.withGroupKeys(flaggedRows, mode);
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
    // `itemRemoved` is attached by withItemRemoved in the next pipeline step, so
    // this returns the dept-labelled + center-named row (the full
    // SampleTransferCenterRow, incl. itemRemoved, is produced downstream).
  ): Promise<
    Array<SampleTransferDeptRow & { outsourceCenterName: string | null }>
  > {
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
   * Attach each transfer's `itemRemoved` flag: true when the test(s) on its sample
   * - or, once accepted, on the receiving branch's copy - were removed from the
   * order (the row is kept but frozen, tagged "Test removed from order"). One
   * query for the whole page (see {@link findItemRemovedSampleIds}).
   * @param tx the tenant-scoped transaction client (RLS GUC already set)
   * @param tenantId tenant scope
   * @param rows the page of transfers
   */
  private async withItemRemoved<
    T extends { sampleId: string; clonedSampleId: string | null },
  >(
    tx: Prisma.TransactionClient,
    tenantId: string,
    rows: T[],
  ): Promise<Array<T & { itemRemoved: boolean }>> {
    const removed = await findItemRemovedSampleIds(
      tx,
      tenantId,
      rows.flatMap((r) =>
        r.clonedSampleId ? [r.sampleId, r.clonedSampleId] : [r.sampleId],
      ),
    );
    return rows.map((r) => ({
      ...r,
      itemRemoved:
        removed.has(r.sampleId) ||
        (r.clonedSampleId !== null && removed.has(r.clonedSampleId)),
    }));
  }

  /**
   * Attach each transfer's final-group key + the active grouping mode, so the
   * referral queue groups transfers into the SAME Order → final-group buckets
   * the In-House list uses. The key is scoped to the sample's order
   * (`${orderId}::${barcodeGroupKey}`) and computed by the one shared
   * {@link barcodeGroupKey} rule — the sample carries its own persisted
   * `departmentId` / `sampleGroupLabel`, so no extra query is needed.
   * @param rows the page of center-labelled transfers (incl. `itemRemoved`)
   * @param mode the tenant's live grouping mode
   */
  private withGroupKeys(
    rows: SampleTransferCenterRow[],
    mode: AccessionGroupingMode,
  ): SampleTransferListRow[] {
    return rows.map((row) => ({
      ...row,
      groupingMode: mode,
      groupKey: `${row.sample.orderId}::${barcodeGroupKey(row.sample, mode)}`,
    }));
  }

  /**
   * Fetch one transfer with its sample + order context, plus its `itemRemoved`
   * flag (see {@link withItemRemoved}).
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
  ): Promise<SampleTransferWithFlag> {
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
    const [flagged] = await this.withItemRemoved(this.prisma, tenantId, [
      transfer,
    ]);
    return flagged!;
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
          } else {
            // Forward / Outsource: like a Send, only while the report has not been
            // worked on (the message tells the user why the sample cannot go out).
            await this.samples.assertDispatchable(
              tx,
              tenantId,
              sampleId,
              sampleAction === 'forward' ? 'forward' : 'outsource',
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
          // receive, accept) are refused. Reject and Repeat stay open while the
          // transfer is only RECEIVED (the receiving branch has no copy or report yet,
          // so it can send the sample back and wind it down); once ACCEPTED the copy
          // holds typed results and `returnCopyToOrigin` refuses (Store / Discard only).
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
          // A transfer whose test was removed from the order is frozen entirely:
          // all five actions are refused (the sample and report were kept only so
          // the physical tube can be wound down, see `isSampleItemRemoved`). Like
          // the cancelled-order case, a group "skip invalid" call skips it with its
          // reason and carries on; a single action gets the 409.
          if (await isSampleItemRemoved(tx, tenantId, transfer.sampleId)) {
            const refusal = new TransferItemRemovedException(
              transfer.id,
              action,
            );
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
          // An INTERNAL transfer still In-Transit with no logistics type is hidden from
          // the receiving branch (how it travels is undecided), so it cannot be picked
          // up either - not through the API or a bulk call. Pick Up is the first step,
          // so Receive and Accept cannot follow. A group "skip invalid" call skips it
          // with this reason; a single action gets the 422. Transfers already picked
          // up (or later) are not affected.
          if (
            action === 'pick-up' &&
            transfer.destinationBranchId &&
            isHiddenFromReceiver(transfer)
          ) {
            const refusal = new TransferLogisticsMissingException(
              transfer.id,
              action,
            );
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
          // An OUTSOURCE transfer with no center / no logistics type yet cannot move
          // either (both are set later through Assign Center): Pick Up needs a center
          // and a logistics type, Receive and Accept a center. A group "skip invalid"
          // call skips it with the reason; a single action gets the 422.
          const notAssigned = missingOutsourceAssignment(transfer, action);
          if (notAssigned.length > 0) {
            const refusal = new TransferOutsourceNotAssignedException(
              transfer.id,
              action,
              notAssigned,
            );
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
          if (
            action === 'accept' &&
            transfer.kind === TransferKind.INTERNAL &&
            transfer.destinationBranchId
          ) {
            // Safety net for a tube sent before the destination was checked: this branch
            // must offer every test on it, else it can not accept (Reject / Repeat instead).
            try {
              await assertDestinationOffers(
                tx,
                tenantId,
                [transfer.sampleId],
                transfer.destinationBranchId,
                'receiver',
                SampleStatus.SENT_INTERNAL,
              );
            } catch (e) {
              if (skipInvalid && e instanceof DestinationLacksTestException) {
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
          if (action === 'accept') {
            clonedSampleId = await this.cloneIntoDestination(
              tx,
              tenantId,
              personId,
              transfer,
            );
          }
          // EXTERNAL / OUTSOURCE accept keeps the report on the sender's own
          // sample (no clone — cloneIntoDestination returned null above). Once
          // this branch records the transfer ACCEPTED, flag that report so the
          // Technician Reporting "Outsource" checkbox includes it (Option B —
          // gated on accept; INTERNAL is handled inside cloneIntoDestination).
          if (
            action === 'accept' &&
            (transfer.kind === TransferKind.EXTERNAL ||
              transfer.kind === TransferKind.OUTSOURCE)
          ) {
            await this.samples.markLabReportsReferralForSample(
              tx,
              tenantId,
              transfer.sampleId,
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
              // Claim the transfer FIRST, on the status we validated. This is the
              // serialisation point of two group actions that overlap on the same
              // transfers: the second blocks on this row until the first commits, then
              // matches nothing and (with skip invalid) skips the transfer instead of
              // failing - and rolling back - its whole batch. (It used to be the
              // sender's sample claim, which a send-back no longer touches.)
              const claim = await tx.sampleTransfer.updateMany({
                where: {
                  id: transfer.id,
                  deletedAt: null,
                  transferStatus: transfer.transferStatus,
                },
                data: { updatedBy: personId },
              });
              if (claim.count !== 1) {
                throw new InvalidTransferTransitionException(
                  action,
                  transfer.transferStatus,
                );
              }
              await this.returnToSender(
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
            } catch (e) {
              if (
                skipInvalid &&
                (e instanceof InvalidSampleTransitionException ||
                  e instanceof InvalidTransferTransitionException)
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
   *  - before the receiver accepted (`RECEIVED`): nothing moves (its report never
   *    left the sender); the return is recorded on the sender's sample history;
   *  - after the receiver accepted (`ACCEPTED`, Repeat or Reject): the receiver's
   *    copy is voided and the report returns to the sender, reset — refused if a
   *    report has a validated result (see `OrderSampleService.returnCopyToOrigin`).
   * Either way the sender's original sample STAYS `SENT_INTERNAL`: the caller closes
   * the transfer as `REPEAT` / `REJECTED`, which the sender's list reads as
   * "Sent – Repeated" / "Sent – Rejected". The sender then chooses Repeat, Error or
   * Retrieve (`OrderSampleService.transitionInTx`), and only then is the referring
   * panel told.
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
  ): Promise<void> {
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
      for (const copy of copies) {
        await this.samples.returnCopyToOrigin(
          tx,
          tenantId,
          personId,
          copy.id,
          why,
          action,
        );
      }
      return;
    }
    // Before the receiver accepted: nothing moved (no copy, the report never left
    // the sender). The sender's sample stays Sent; only its trail entry is written.
    await this.samples.recordReturnedByReceiverInTx(
      tx,
      tenantId,
      personId,
      transfer.sampleId,
      why,
    );
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
        // It is the same physical tube: it was drawn at the sending branch, so the
        // copy keeps when, by whom and in which tube - otherwise the receiving
        // branch's label prints a blank collection time.
        collectedAt: source.collectedAt,
        collectedBy: source.collectedBy,
        tubeType: source.tubeType,
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

    // From here the receiving branch works the tube with ITS OWN copy of the test
    // (parameters, ranges, values, sample definition, department), not the sender's.
    await this.samples.retargetCopyToReceivingSetup(
      tx,
      tenantId,
      cloned.id,
      destBranch,
    );

    // The clone exists only because the transfer was ACCEPTED — flag its reports
    // as referral work so the receiver's Technician Reporting "Outsource" checkbox
    // surfaces them (see LabReport.isReferral).
    await this.samples.markLabReportsReferralForSample(tx, tenantId, cloned.id);

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
