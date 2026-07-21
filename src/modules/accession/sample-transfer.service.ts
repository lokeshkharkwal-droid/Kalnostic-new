import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SampleStatus,
  TransferKind,
  TransferStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult, paginated } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { AccessionSampleService } from './accession-sample.service';
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
  SampleTransferWithRelations,
} from './entities/sample-transfer.entity';
import {
  AccessionNumberConflictException,
  AccessionSampleNotFoundException,
  InvalidTransferTransitionException,
  OutsourceCenterNotFoundException,
  SampleTransferNotFoundException,
  TransferDestinationMissingException,
} from './exceptions/accession.exceptions';

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
 * NOTE: optional per-action notes/attachments on the transfer modals are accepted
 * but not persisted (SampleTransfer has no history table); the mandatory fields
 * (receiveCondition/repeatReason/rejectionReason) are stored as columns.
 */
@Injectable()
export class SampleTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly samples: AccessionSampleService,
    private readonly branches: BranchService,
  ) {}

  // ── Sending side (In-House → transfer) ─────────────────────────────────────

  /** Send (Internal Transfer): Accepted → Sent (Internal) + INTERNAL transfer. */
  async send(
    sampleIds: string[],
    tenantId: string,
    personId: string | null,
    dto: SendSampleDto,
  ): Promise<SampleTransferWithRelations[]> {
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
  ): Promise<SampleTransferWithRelations[]> {
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

  /** Outsource: Accepted → Outsourced + OUTSOURCE transfer (manual tracking). */
  async outsource(
    sampleIds: string[],
    tenantId: string,
    personId: string | null,
    dto: OutsourceSampleDto,
  ): Promise<SampleTransferWithRelations[]> {
    await this.assertOutsourceCenter(dto.outsourceCenterId, tenantId);
    return this.dispatch(
      sampleIds,
      tenantId,
      personId,
      'outsource',
      TransferKind.OUTSOURCE,
      dto,
      {
        outsourceCenterId: dto.outsourceCenterId,
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
    dto: TransferPickUpDto,
  ): Promise<SampleTransferWithRelations[]> {
    return this.transferAction(
      transferIds,
      tenantId,
      personId,
      'pick-up',
      () => ({
        pickedUpBy: dto.pickedUpBy ?? null,
        pickedUpAt: new Date(),
      }),
    );
  }

  /** Receive (§B.11.2): Picked Up → Received (records condition on receipt). */
  async receive(
    transferIds: string[],
    tenantId: string,
    personId: string | null,
    dto: TransferReceiveDto,
  ): Promise<SampleTransferWithRelations[]> {
    return this.transferAction(
      transferIds,
      tenantId,
      personId,
      'receive',
      () => ({
        receivedAt: new Date(),
        receiveCondition: dto.receiveCondition,
      }),
    );
  }

  /** Accept (§B.11.3): Received → Accepted. INTERNAL clones into In-House (RULE 1). */
  async accept(
    transferIds: string[],
    tenantId: string,
    personId: string | null,
    _dto: SampleNoteDto,
  ): Promise<SampleTransferWithRelations[]> {
    return this.transferAction(
      transferIds,
      tenantId,
      personId,
      'accept',
      () => ({
        acceptedAt: new Date(),
      }),
    );
  }

  /** Repeat (§B.11.4): Received/Accepted → Repeat (origin notified to re-collect). */
  async repeatTransfer(
    transferIds: string[],
    tenantId: string,
    personId: string | null,
    dto: TransferRepeatDto,
  ): Promise<SampleTransferWithRelations[]> {
    return this.transferAction(
      transferIds,
      tenantId,
      personId,
      'repeat',
      () => ({
        repeatReason: dto.repeatReason,
      }),
    );
  }

  /** Reject (§B.11.5): Received → Rejected (origin notified). */
  async reject(
    transferIds: string[],
    tenantId: string,
    personId: string | null,
    dto: TransferRejectDto,
  ): Promise<SampleTransferWithRelations[]> {
    return this.transferAction(
      transferIds,
      tenantId,
      personId,
      'reject',
      () => ({
        rejectionReason: dto.rejectionReason,
      }),
    );
  }

  // ── Destination management & manual outsource status ───────────────────────

  /** Assign Center (§A.7): set the destination on a transfer created without one. */
  async assignCenter(
    transferId: string,
    tenantId: string,
    personId: string | null,
    dto: AssignCenterDto,
  ): Promise<SampleTransferWithRelations> {
    const transfer = await this.findTransferById(transferId, tenantId);
    const data: Prisma.SampleTransferUpdateInput = { updatedBy: personId };
    if (transfer.kind === TransferKind.INTERNAL) {
      if (!dto.destinationBranchId) {
        throw new TransferDestinationMissingException(transferId);
      }
      await this.branches.findById(dto.destinationBranchId, tenantId);
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
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.sampleTransfer.update({ where: { id: transferId }, data }),
    );
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
  ): Promise<PaginatedResult<SampleTransferWithRelations>> {
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
    if (query.dateFrom || query.dateTo) {
      where.sendDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    // Filters on the linked sample + its order (accession search, referral refs).
    const sample: Prisma.AccessionSampleWhereInput = {};
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

    const [data, total] = await this.prisma.$transaction([
      this.prisma.sampleTransfer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: TRANSFER_INCLUDE,
      }),
      this.prisma.sampleTransfer.count({ where }),
    ]);
    return paginated(data, total, page, limit);
  }

  /**
   * Fetch one transfer with its sample + order context.
   * @throws SampleTransferNotFoundException if missing/soft-deleted/other tenant
   */
  async findTransferById(
    id: string,
    tenantId: string,
  ): Promise<SampleTransferWithRelations> {
    const transfer = await this.prisma.sampleTransfer.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: TRANSFER_INCLUDE,
    });
    if (!transfer) throw new SampleTransferNotFoundException(id);
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
  ): Promise<SampleTransferWithRelations[]> {
    const now = new Date();
    const sendDate = dto.sendDate ? new Date(dto.sendDate) : now;
    const created = await this.prisma.withTenant(tenantId, async (tx) => {
      const done: string[] = [];
      for (const sampleId of sampleIds) {
        const sample = await this.samples.transitionInTx(
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
          { notes: dto.notes, attachmentUrl: dto.attachmentUrl },
        );
        const data: Prisma.SampleTransferUncheckedCreateInput = {
          tenantId,
          branchId: sample.branchId,
          sampleId: sample.id,
          kind,
          transferStatus: TransferStatus.IN_TRANSIT,
          originBranchId: sample.originBranchId ?? sample.branchId,
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
        done.push(transfer.id);
      }
      return done;
    });
    return Promise.all(
      created.map((id) => this.findTransferById(id, tenantId)),
    );
  }

  /**
   * Apply a validated §B.10 transfer transition to each id in one transaction. On
   * INTERNAL `accept`, clones the sample into the receiving branch's In-House list
   * (RULE 1). All-or-nothing across the id set.
   * @throws SampleTransferNotFoundException / InvalidTransferTransitionException
   * @throws TransferDestinationMissingException / AccessionNumberConflictException
   */
  private async transferAction(
    transferIds: string[],
    tenantId: string,
    personId: string | null,
    action: TransferAction,
    build: () => Prisma.SampleTransferUpdateInput,
  ): Promise<SampleTransferWithRelations[]> {
    let changed: string[];
    try {
      changed = await this.prisma.withTenant(tenantId, async (tx) => {
        const done: string[] = [];
        for (const id of transferIds) {
          const transfer = await tx.sampleTransfer.findFirst({
            where: { id, tenantId, deletedAt: null },
          });
          if (!transfer) throw new SampleTransferNotFoundException(id);
          const to = nextTransferStatus(action, transfer.transferStatus);
          if (!to) {
            throw new InvalidTransferTransitionException(
              action,
              transfer.transferStatus,
            );
          }
          if (action === 'accept') {
            await this.cloneIntoDestination(tx, tenantId, personId, transfer);
          }
          await tx.sampleTransfer.update({
            where: { id: transfer.id },
            data: { ...build(), transferStatus: to, updatedBy: personId },
          });
          done.push(transfer.id);
        }
        return done;
      });
    } catch (e) {
      this.rethrowConflict(e);
      throw e;
    }
    return Promise.all(
      changed.map((id) => this.findTransferById(id, tenantId)),
    );
  }

  /**
   * RULE 1 (PDF §B.11.3): when an INTERNAL transfer is accepted, materialise the
   * sample in the receiving branch's In-House list — a new `AccessionSample` at
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
  ): Promise<void> {
    if (transfer.kind !== TransferKind.INTERNAL) return;
    if (!transfer.destinationBranchId) {
      throw new TransferDestinationMissingException(transfer.id);
    }
    const source = await tx.accessionSample.findFirst({
      where: { id: transfer.sampleId, tenantId, deletedAt: null },
      include: { tests: true },
    });
    if (!source) throw new AccessionSampleNotFoundException(transfer.sampleId);

    const destBranch = transfer.destinationBranchId;
    const now = new Date();
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { accessionCounter: { increment: 1 } },
      select: { accessionCounter: true },
    });
    const accessionNo = `ACC-${String(tenant.accessionCounter).padStart(5, '0')}`;
    await tx.accessionSample.create({
      data: {
        tenantId,
        branchId: destBranch,
        orderId: source.orderId,
        accessionNo,
        sampleType: source.sampleType,
        containerType: source.containerType,
        sampleGroupLabel: source.sampleGroupLabel,
        priority: source.priority,
        status: SampleStatus.ACCEPTED,
        originBranchId: source.originBranchId ?? source.branchId,
        processingBranchId: destBranch,
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
