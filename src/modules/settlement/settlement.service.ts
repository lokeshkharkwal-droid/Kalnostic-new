import { Injectable } from '@nestjs/common';
import { Prisma, SettlementPartyType, SettlementStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { OrderService } from '../order/order.service';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { ListSettlementsDto } from './dto/list-settlements.dto';
import { SettlementSummaryQueryDto } from './dto/settlement-summary-query.dto';
import { ApproveSettlementDto } from './dto/approve-settlement.dto';
import { RejectSettlementDto } from './dto/reject-settlement.dto';
import { SettleSettlementDto } from './dto/settle-settlement.dto';
import { UpdateSettlementDto } from './dto/update-settlement.dto';
import {
  SETTLEMENT_DETAIL_INCLUDE,
  SETTLEMENT_LIST_INCLUDE,
  SettlementDetail,
  SettlementListRow,
  SettlementPaymentHistoryRow,
  SettlementSummary,
} from './entities/settlement.entity';
import {
  SettlementApprovedExceedsBasisException,
  SettlementEditBlockedException,
  SettlementInvalidStatusException,
  SettlementMixedPartyException,
  SettlementNotApprovedException,
  SettlementNotFoundException,
  SettlementPaymentFullySettledException,
  SettlementPaymentNotFoundException,
  SettlementOverSettlementException,
  SettlementPartyMismatchException,
  SettlementPartyResolutionException,
  SettlementSourcePaymentsEmptyException,
  SettlementZeroAmountException,
} from './exceptions/settlement.exceptions';

/** Per-payment collection info returned by OrderService for settlement creation. */
interface PaymentCollectionInfo {
  paid: number;
  orderId: string;
  paymentDate: Date;
  grossShare: number;
  discountShare: number;
  netShare: number;
  dueShare: number;
  referralPanelId: string | null;
  referredByDoctorId: string | null;
  internalReferralId: string | null;
  externalReferralId: string | null;
}

/** The resolved party master snapshot used to fill settlement fields. */
interface ResolvedParty {
  name: string;
  mobile: string | null;
}

/**
 * Finance settlement management. Tenant-scoped + branch-level; Prisma-direct.
 * Settlements are created ONLY from selected collection order records — the party
 * and all money are re-derived server-side (never trusted from the body). The
 * financial basis is the COLLECTED (paid) amount. Reuses {@link OrderService} (via
 * DI, rule #3) so a settlement's figures match the Collection report exactly.
 * Lifecycle: Pending Approval → Approved/Rejected → Partially Settled → Settled.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
  ) {}

  /**
   * Create a settlement from selected collection PAYMENT records. Validates the
   * payments exist, all their orders carry the chosen party (same-party), and each
   * still has a REMAINING unsettled amount (paid − already-reserved). The paid basis
   * is the sum of those remainders; the proposed approved amount defaults to it. The
   * settlement number is drawn atomically from the tenant's billing settings.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from the JWT profile)
   * @param actorId acting person id (from JWT) — recorded as `createdBy`
   * @param dto party type + source payment ids + optional approved/notes/attachment
   * @returns the created settlement with its source payments + (empty) payout history
   * @throws SettlementSourcePaymentsEmptyException when no records are supplied
   * @throws SettlementPaymentNotFoundException when a record does not resolve
   * @throws SettlementPaymentFullySettledException when a record is already fully settled
   * @throws SettlementPartyMismatchException when a record lacks the chosen party
   * @throws SettlementMixedPartyException when records span multiple parties
   * @throws SettlementZeroAmountException when the total collected amount is zero
   * @throws SettlementApprovedExceedsBasisException when approvedAmount > collected
   * @throws SettlementPartyResolutionException when the party master is missing
   */
  async create(
    tenantId: string,
    branchId: string | null,
    actorId: string | null,
    dto: CreateSettlementDto,
  ): Promise<SettlementDetail> {
    if (dto.sourcePaymentIds.length === 0) {
      throw new SettlementSourcePaymentsEmptyException();
    }
    const paymentIds = [...new Set(dto.sourcePaymentIds)];

    const id = await this.prisma.withTenant(tenantId, async (tx) => {
      // Per-payment collection figures + the payment's order party FKs — reuse the
      // Collection report logic so a settlement reconciles with that report.
      const info = await this.orderService.getCollectionInfoForPayments(
        tx,
        tenantId,
        paymentIds,
      );
      const missing = paymentIds.filter((pid) => !info.has(pid));
      if (missing.length > 0) {
        throw new SettlementPaymentNotFoundException(missing);
      }

      // Per-payment amount already reserved by prior (non-rejected) settlements →
      // each payment's REMAINING collectable basis. Fully-reserved payments are
      // ineligible; partially-reserved payments contribute only their remainder.
      const reserved = await this.orderService.getReservedForPayments(
        tx,
        tenantId,
        paymentIds,
      );

      // Same-party validation (via each payment's order) + money aggregation on the
      // REMAINING basis. The per-payment order-figure shares are scaled again by
      // remaining/paid so they reconcile across a payment's multiple settlements.
      const partyIds = new Set<string>();
      const missingParty: string[] = [];
      const fullySettled: string[] = [];
      const links: {
        paymentId: string;
        orderId: string;
        collectedAmount: number;
        grossAmount: number;
        discountAmount: number;
        netAmount: number;
        dueAmount: number;
      }[] = [];
      let gross = 0;
      let discount = 0;
      let net = 0;
      let paid = 0;
      let due = 0;
      let periodFrom: Date | null = null;
      let periodTo: Date | null = null;
      for (const pid of paymentIds) {
        const row = info.get(pid) as PaymentCollectionInfo;
        const fk = this.partyFk(row, dto.partyType);
        if (!fk) {
          missingParty.push(pid);
          continue;
        }
        partyIds.add(fk);
        const remaining = row.paid - (reserved.get(pid) ?? 0);
        if (remaining <= 0) {
          fullySettled.push(pid);
          continue;
        }
        const factor = remaining / row.paid;
        const grossPror = Math.round(row.grossShare * factor);
        const discountPror = Math.round(row.discountShare * factor);
        const netPror = Math.round(row.netShare * factor);
        const duePror = Math.round(row.dueShare * factor);
        links.push({
          paymentId: pid,
          orderId: row.orderId,
          collectedAmount: remaining,
          grossAmount: grossPror,
          discountAmount: discountPror,
          netAmount: netPror,
          dueAmount: duePror,
        });
        gross += grossPror;
        discount += discountPror;
        net += netPror;
        paid += remaining;
        due += duePror;
        if (!periodFrom || row.paymentDate < periodFrom)
          periodFrom = row.paymentDate;
        if (!periodTo || row.paymentDate > periodTo) periodTo = row.paymentDate;
      }
      if (missingParty.length > 0) {
        throw new SettlementPartyMismatchException(dto.partyType, missingParty);
      }
      if (partyIds.size > 1) {
        throw new SettlementMixedPartyException({ partyIds: [...partyIds] });
      }
      if (fullySettled.length > 0) {
        throw new SettlementPaymentFullySettledException(fullySettled);
      }
      if (paid <= 0) {
        throw new SettlementZeroAmountException();
      }
      const partyId = [...partyIds][0] as string;

      // Party snapshot (name / mobile).
      const party = await this.resolveParty(
        tx,
        dto.partyType,
        partyId,
        tenantId,
      );

      const settlementNo = await this.nextSettlementNo(tx, tenantId);
      const now = new Date();
      const settlementDate = dto.settlementDate
        ? new Date(dto.settlementDate)
        : now;

      // Proposed approved amount defaults to the collected basis. It may be
      // adjusted DOWN per the agreed terms, but never above the collected amount
      // (a collection settlement cannot disburse more than was collected).
      const approvedAmount = dto.approvedAmount ?? paid;
      if (approvedAmount > paid) {
        throw new SettlementApprovedExceedsBasisException(paid, approvedAmount);
      }

      const created = await tx.settlement.create({
        data: {
          tenantId,
          branchId,
          settlementNo,
          settlementDate,
          periodFrom: periodFrom ?? now,
          periodTo: periodTo ?? now,
          partyType: dto.partyType,
          partyId,
          partyName: party.name,
          partyMobile: party.mobile,
          grossAmount: gross,
          discountAmount: discount,
          netAmount: net,
          paidAmount: paid,
          dueAmount: due,
          approvedAmount,
          settledAmount: 0,
          status: SettlementStatus.PENDING_APPROVAL,
          notes: dto.notes ?? null,
          decisionAttachmentUrl: dto.attachmentUrl ?? null,
          createdBy: actorId,
          sourcePayments: {
            create: links.map((l) => ({
              tenantId,
              branchId,
              paymentId: l.paymentId,
              orderId: l.orderId,
              collectedAmount: l.collectedAmount,
              grossAmount: l.grossAmount,
              discountAmount: l.discountAmount,
              netAmount: l.netAmount,
              dueAmount: l.dueAmount,
            })),
          },
        },
        select: { id: true },
      });
      return created.id;
    });

    return this.getOne(id, tenantId);
  }

  /**
   * List settlements (paginated) scoped to the caller's tenant + active branch,
   * with optional filters. Newest first.
   * @param tenantId tenant scope
   * @param activeBranchId active branch (from the JWT profile)
   * @param query filters + pagination
   */
  async list(
    tenantId: string,
    activeBranchId: string | null,
    query: ListSettlementsDto,
  ): Promise<PaginatedResult<SettlementListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildSettlementWhere(query, tenantId, activeBranchId);
    // Two independent reads (not array-form $transaction) so the per-op RLS
    // extension scopes each to the tenant context — see rls-outside-request gaps.
    const [data, total] = await Promise.all([
      this.prisma.settlement.findMany({
        where,
        include: SETTLEMENT_LIST_INCLUDE,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.settlement.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Aggregate the settlement summary-card totals over the same scoped dataset the
   * list paginates (so cards reconcile with the list). Returns the nine KPI values
   * (doc §5.2): gross/discount/net/paid/due/approved/settled, derived balance, and
   * the pending-approval count.
   * @param tenantId tenant scope
   * @param activeBranchId active branch (from the JWT profile)
   * @param query the same filter set as the list
   */
  async summary(
    tenantId: string,
    activeBranchId: string | null,
    query: SettlementSummaryQueryDto,
  ): Promise<SettlementSummary> {
    const where = this.buildSettlementWhere(query, tenantId, activeBranchId);
    const [agg, pendingApprovalCount] = await Promise.all([
      this.prisma.settlement.aggregate({
        where,
        _sum: {
          grossAmount: true,
          discountAmount: true,
          netAmount: true,
          paidAmount: true,
          dueAmount: true,
          approvedAmount: true,
          settledAmount: true,
        },
      }),
      this.prisma.settlement.count({
        where: { ...where, status: SettlementStatus.PENDING_APPROVAL },
      }),
    ]);
    const approvedAmount = agg._sum.approvedAmount ?? 0;
    const settledAmount = agg._sum.settledAmount ?? 0;
    return {
      grossAmount: agg._sum.grossAmount ?? 0,
      discountAmount: agg._sum.discountAmount ?? 0,
      netAmount: agg._sum.netAmount ?? 0,
      paidAmount: agg._sum.paidAmount ?? 0,
      dueAmount: agg._sum.dueAmount ?? 0,
      approvedAmount,
      settledAmount,
      balance: approvedAmount - settledAmount,
      pendingApprovalCount,
    };
  }

  /**
   * Fetch one settlement with its source orders + payout history.
   * @throws SettlementNotFoundException if missing/soft-deleted/other tenant
   */
  async getOne(id: string, tenantId: string): Promise<SettlementDetail> {
    const settlement = await this.prisma.settlement.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: SETTLEMENT_DETAIL_INCLUDE,
    });
    if (!settlement) {
      throw new SettlementNotFoundException(id);
    }
    return settlement;
  }

  /**
   * List a settlement's payout history (newest first). Validates the settlement
   * first and resolves each payout's recording user to a display name.
   * @throws SettlementNotFoundException if the settlement does not resolve
   */
  async paymentHistory(
    id: string,
    tenantId: string,
  ): Promise<SettlementPaymentHistoryRow[]> {
    await this.getOne(id, tenantId);
    const rows = await this.prisma.settlementPayment.findMany({
      where: { settlementId: id, tenantId, deletedAt: null },
      orderBy: { paymentDate: 'desc' },
      select: {
        id: true,
        amount: true,
        payoutMode: true,
        reference: true,
        attachmentUrl: true,
        paymentDate: true,
        notes: true,
        createdBy: true,
        createdAt: true,
      },
    });
    const names = await this.resolvePersonNames(
      rows.map((r) => r.createdBy).filter((x): x is string => !!x),
    );
    return rows.map((r) => ({
      ...r,
      createdByName: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
    }));
  }

  /**
   * Approve a settlement (doc §7.2). Allowed from PENDING_APPROVAL or REJECTED
   * (resubmit). Confirms/adjusts the approved amount and records the approver,
   * timestamp, notes and attachment.
   * @throws SettlementNotFoundException if the settlement does not resolve
   * @throws SettlementInvalidStatusException if not awaiting a decision
   * @throws SettlementEditBlockedException if approvedAmount < already settled
   */
  async approve(
    id: string,
    tenantId: string,
    actorId: string | null,
    dto: ApproveSettlementDto,
  ): Promise<SettlementDetail> {
    const settlement = await this.getOne(id, tenantId);
    if (
      settlement.status !== SettlementStatus.PENDING_APPROVAL &&
      settlement.status !== SettlementStatus.REJECTED
    ) {
      throw new SettlementInvalidStatusException(
        id,
        settlement.status,
        'approved',
      );
    }
    const approvedAmount = dto.approvedAmount ?? settlement.approvedAmount;
    if (approvedAmount < settlement.settledAmount) {
      throw new SettlementEditBlockedException(
        settlement.settledAmount,
        approvedAmount,
      );
    }
    const paymentIds = settlement.sourcePayments.map((s) => s.paymentId);
    const status = this.deriveSettleStatus(
      approvedAmount,
      settlement.settledAmount,
    );

    await this.prisma.withTenant(tenantId, async (tx) => {
      // Cap at the payment(s)' collected amount NOT already committed to OTHER
      // non-rejected settlements, so Σ Approved(payment) can never exceed paid
      // (→ total settled can never exceed collected).
      const maxApproved = await this.maxApprovableForPayments(
        tx,
        tenantId,
        paymentIds,
        id,
      );
      if (approvedAmount > maxApproved) {
        throw new SettlementApprovedExceedsBasisException(
          maxApproved,
          approvedAmount,
        );
      }
      await tx.settlement.update({
        where: { id },
        data: {
          approvedAmount,
          status,
          approvedBy: actorId,
          approvedAt: new Date(),
          rejectedBy: null,
          rejectedAt: null,
          decisionNotes: dto.notes ?? null,
          decisionAttachmentUrl:
            dto.attachmentUrl ?? settlement.decisionAttachmentUrl,
          updatedBy: actorId,
        },
      });
    });
    return this.getOne(id, tenantId);
  }

  /**
   * Reject a settlement (doc §7.2). Allowed only from PENDING_APPROVAL. Records the
   * rejecting user, timestamp, notes and attachment; the settlement may then be
   * edited and resubmitted.
   * @throws SettlementNotFoundException if the settlement does not resolve
   * @throws SettlementInvalidStatusException if not pending approval
   */
  async reject(
    id: string,
    tenantId: string,
    actorId: string | null,
    dto: RejectSettlementDto,
  ): Promise<SettlementDetail> {
    const settlement = await this.getOne(id, tenantId);
    if (settlement.status !== SettlementStatus.PENDING_APPROVAL) {
      throw new SettlementInvalidStatusException(
        id,
        settlement.status,
        'rejected',
      );
    }
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.settlement.update({
        where: { id },
        data: {
          status: SettlementStatus.REJECTED,
          rejectedBy: actorId,
          rejectedAt: new Date(),
          approvedBy: null,
          approvedAt: null,
          decisionNotes: dto.notes ?? null,
          decisionAttachmentUrl:
            dto.attachmentUrl ?? settlement.decisionAttachmentUrl,
          updatedBy: actorId,
        },
      });
    });
    return this.getOne(id, tenantId);
  }

  /**
   * Record one payout against an approved settlement (doc §8). The amount must be
   * within the remaining balance. Appends to Payment History, accumulates the
   * Settled amount and recomputes the status (Partially Settled / Settled).
   * @throws SettlementNotFoundException if the settlement does not resolve
   * @throws SettlementNotApprovedException if not yet approved
   * @throws SettlementOverSettlementException if the amount exceeds the balance
   */
  async settle(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string | null,
    dto: SettleSettlementDto,
  ): Promise<SettlementDetail> {
    const settlement = await this.getOne(id, tenantId);
    if (
      settlement.status !== SettlementStatus.APPROVED &&
      settlement.status !== SettlementStatus.PARTIALLY_SETTLED
    ) {
      throw new SettlementNotApprovedException(id, settlement.status);
    }
    const balance = settlement.approvedAmount - settlement.settledAmount;
    if (dto.amount > balance) {
      throw new SettlementOverSettlementException(balance, dto.amount);
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.settlementPayment.create({
        data: {
          tenantId,
          branchId,
          settlementId: id,
          amount: dto.amount,
          payoutMode: dto.payoutMode,
          reference: dto.reference,
          attachmentUrl: dto.attachmentUrl ?? null,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
          notes: dto.notes ?? null,
          createdBy: actorId,
        },
      });
      const settledAmount = settlement.settledAmount + dto.amount;
      await tx.settlement.update({
        where: { id },
        data: {
          settledAmount,
          status: this.deriveSettleStatus(
            settlement.approvedAmount,
            settledAmount,
          ),
          updatedBy: actorId,
        },
      });
    });
    return this.getOne(id, tenantId);
  }

  /**
   * Edit a settlement (doc §7.3). Notes/attachment can change at any status.
   * Changing the approved amount while APPROVED/PARTIALLY_SETTLED resets the
   * settlement to PENDING_APPROVAL (re-approval rule) and clears the approval
   * trail. The approved amount can never drop below the amount already settled.
   * @throws SettlementNotFoundException if the settlement does not resolve
   * @throws SettlementEditBlockedException if approvedAmount < already settled
   */
  async update(
    id: string,
    tenantId: string,
    actorId: string | null,
    dto: UpdateSettlementDto,
  ): Promise<SettlementDetail> {
    const settlement = await this.getOne(id, tenantId);

    const paymentIds = settlement.sourcePayments.map((s) => s.paymentId);
    const data: Prisma.SettlementUpdateInput = { updatedBy: actorId };
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.attachmentUrl !== undefined)
      data.decisionAttachmentUrl = dto.attachmentUrl;

    let approvedToCap: number | null = null;
    if (
      dto.approvedAmount !== undefined &&
      dto.approvedAmount !== settlement.approvedAmount
    ) {
      const newApproved = dto.approvedAmount;
      if (newApproved < settlement.settledAmount) {
        throw new SettlementEditBlockedException(
          settlement.settledAmount,
          newApproved,
        );
      }
      data.approvedAmount = newApproved;
      approvedToCap = newApproved;
      // A financially significant change after approval forces re-approval.
      if (
        settlement.status === SettlementStatus.APPROVED ||
        settlement.status === SettlementStatus.PARTIALLY_SETTLED ||
        settlement.status === SettlementStatus.SETTLED
      ) {
        data.status = SettlementStatus.PENDING_APPROVAL;
        data.approvedBy = null;
        data.approvedAt = null;
      }
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      // Cap at the payment(s)' collected amount NOT already committed to OTHER
      // non-rejected settlements, so Σ Approved(payment) can never exceed paid.
      if (approvedToCap !== null) {
        const maxApproved = await this.maxApprovableForPayments(
          tx,
          tenantId,
          paymentIds,
          id,
        );
        if (approvedToCap > maxApproved) {
          throw new SettlementApprovedExceedsBasisException(
            maxApproved,
            approvedToCap,
          );
        }
      }
      await tx.settlement.update({ where: { id }, data });
    });
    return this.getOne(id, tenantId);
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  /**
   * The maximum Approved amount a settlement may carry without over-committing any
   * of its payments: `Σ over paymentIds of max(0, paid(payment) − reserved by the
   * payment's OTHER non-rejected settlements)`. Guarantees `Σ Approved(payment) ≤
   * paid`, so the total ever settled/paid-out for a payment can never exceed its
   * collected amount. Mirrors the basis `create()` uses. Runs on `tx` (RLS-safe).
   */
  private async maxApprovableForPayments(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentIds: string[],
    excludeSettlementId: string,
  ): Promise<number> {
    const otherReserved = await this.orderService.getReservedForPayments(
      tx,
      tenantId,
      paymentIds,
      excludeSettlementId,
    );
    const info = await this.orderService.getCollectionInfoForPayments(
      tx,
      tenantId,
      paymentIds,
    );
    let max = 0;
    for (const pid of paymentIds) {
      const paid = info.get(pid)?.paid ?? 0;
      max += Math.max(0, paid - (otherReserved.get(pid) ?? 0));
    }
    return max;
  }

  /** The payment's order FK for the chosen party type (null when absent). */
  private partyFk(
    info: PaymentCollectionInfo,
    partyType: SettlementPartyType,
  ): string | null {
    switch (partyType) {
      case SettlementPartyType.B2B:
        return info.referralPanelId;
      case SettlementPartyType.REFERRED_BY:
        return info.referredByDoctorId;
      case SettlementPartyType.INTERNAL_REFERRAL_USER:
        return info.internalReferralId;
      case SettlementPartyType.EXTERNAL_REFERRAL_USER:
        return info.externalReferralId;
    }
  }

  /**
   * Resolve the party master snapshot (name / mobile) for the chosen party type.
   * @throws SettlementPartyResolutionException when the master row is missing
   */
  private async resolveParty(
    tx: Prisma.TransactionClient,
    partyType: SettlementPartyType,
    partyId: string,
    tenantId: string,
  ): Promise<ResolvedParty> {
    const scope = { id: partyId, tenantId, deletedAt: null };
    switch (partyType) {
      case SettlementPartyType.B2B: {
        const panel = await tx.referralPanel.findFirst({
          where: scope,
          select: { name: true, directorMobile: true },
        });
        if (!panel)
          throw new SettlementPartyResolutionException(partyType, partyId);
        return { name: panel.name, mobile: panel.directorMobile };
      }
      case SettlementPartyType.REFERRED_BY: {
        const doc = await tx.referralDoctor.findFirst({
          where: scope,
          select: { firstName: true, lastName: true, mobileNumber: true },
        });
        if (!doc)
          throw new SettlementPartyResolutionException(partyType, partyId);
        return {
          name: [doc.firstName, doc.lastName].filter(Boolean).join(' ').trim(),
          mobile: doc.mobileNumber,
        };
      }
      case SettlementPartyType.INTERNAL_REFERRAL_USER: {
        const ref = await tx.internalReferral.findFirst({
          where: scope,
          select: {
            firstName: true,
            lastName: true,
            fullName: true,
            mobileNumber: true,
          },
        });
        if (!ref)
          throw new SettlementPartyResolutionException(partyType, partyId);
        return {
          name:
            ref.fullName ??
            [ref.firstName, ref.lastName].filter(Boolean).join(' ').trim(),
          mobile: ref.mobileNumber,
        };
      }
      case SettlementPartyType.EXTERNAL_REFERRAL_USER: {
        const ref = await tx.externalReferral.findFirst({
          where: scope,
          select: { name: true, mobileNumber: true },
        });
        if (!ref)
          throw new SettlementPartyResolutionException(partyType, partyId);
        return { name: ref.name, mobile: ref.mobileNumber };
      }
    }
  }

  /**
   * Draw the next settlement number from the tenant's billing settings, bumping the
   * counter atomically. Auto-creates the settings row on first use (mirrors the
   * invoice-number behaviour).
   */
  private async nextSettlementNo(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string> {
    const existing = await tx.billingSetting.findUnique({
      where: { tenantId },
      select: { settlementPrefix: true, nextSettlementNumber: true },
    });
    let prefix: string;
    let num: number;
    if (existing) {
      prefix = existing.settlementPrefix;
      num = existing.nextSettlementNumber;
      await tx.billingSetting.update({
        where: { tenantId },
        data: { nextSettlementNumber: { increment: 1 } },
      });
    } else {
      prefix = 'STL-';
      num = 1;
      await tx.billingSetting.create({
        data: { tenantId, nextSettlementNumber: 2 },
      });
    }
    return `${prefix}${String(num).padStart(4, '0')}`;
  }

  /**
   * Settlement status from the approved vs cumulative settled amounts: SETTLED once
   * the settled amount reaches the approved amount, PARTIALLY_SETTLED once any
   * payout exists, else APPROVED.
   */
  private deriveSettleStatus(
    approvedAmount: number,
    settledAmount: number,
  ): SettlementStatus {
    if (settledAmount >= approvedAmount && approvedAmount > 0)
      return SettlementStatus.SETTLED;
    if (settledAmount > 0) return SettlementStatus.PARTIALLY_SETTLED;
    return SettlementStatus.APPROVED;
  }

  /**
   * Resolve a set of Person ids to display names (`first middle last`). Person is
   * platform-level (no tenant scope). Mirrors the invoice/audit resolver.
   */
  private async resolvePersonNames(
    ids: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const persons = await this.prisma.person.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, middleName: true, lastName: true },
    });
    return new Map(
      persons.map((p) => [
        p.id,
        [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' '),
      ]),
    );
  }

  /** Build the shared WHERE clause for list + summary (tenant + branch + filters). */
  private buildSettlementWhere(
    query: ListSettlementsDto | SettlementSummaryQueryDto,
    tenantId: string,
    activeBranchId: string | null,
  ): Prisma.SettlementWhereInput {
    const where: Prisma.SettlementWhereInput = { tenantId, deletedAt: null };
    const branchId = query.branchId ?? activeBranchId;
    if (branchId) where.branchId = branchId;
    if (query.settlementType) where.partyType = query.settlementType;
    if (query.partyId) where.partyId = query.partyId;
    if (query.status) where.status = query.status;
    if (query.dateFrom || query.dateTo) {
      where.settlementDate = {};
      if (query.dateFrom) where.settlementDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.settlementDate.lte = new Date(query.dateTo);
    }
    if (query.search) {
      const contains = { contains: query.search, mode: 'insensitive' as const };
      where.OR = [
        { settlementNo: contains },
        { partyName: contains },
        { partyMobile: contains },
      ];
    }
    return where;
  }
}
