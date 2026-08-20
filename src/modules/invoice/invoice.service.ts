import { Injectable } from '@nestjs/common';
import {
  InvoiceDueStatus,
  InvoicePartyType,
  InvoicePaymentFor,
  InvoicePaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { OrderService } from '../order/order.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ReceiveInvoicePaymentDto } from './dto/receive-invoice-payment.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { ListInvoicesDto } from './dto/list-invoices.dto';
import { InvoiceSummaryQueryDto } from './dto/invoice-summary-query.dto';
import {
  INVOICE_DETAIL_INCLUDE,
  INVOICE_LIST_INCLUDE,
  InvoiceDetail,
  InvoiceListRow,
  InvoicePaymentHistoryRow,
  InvoiceSummary,
} from './entities/invoice.entity';
import {
  InvoiceAlreadyCancelledException,
  InvoiceCancelBlockedHasPaymentsException,
  InvoiceMixedPartyException,
  InvoiceNotFoundException,
  InvoiceOrderAlreadyInvoicedException,
  InvoiceOrderNotFoundException,
  InvoiceOrderNotOutstandingException,
  InvoicePartyMismatchException,
  InvoicePartyResolutionException,
  InvoicePaymentExceedsOutstandingException,
  InvoiceSourceOrdersEmptyException,
  InvoiceZeroAmountException,
} from './exceptions/invoice.exceptions';

/** Per-order info returned by OrderService for invoice creation. */
interface OrderPartyInfo {
  due: number;
  referralPanelId: string | null;
  referredByDoctorId: string | null;
  internalReferralId: string | null;
  externalReferralId: string | null;
}

/** The resolved party master snapshot used to fill invoice fields. */
interface ResolvedParty {
  name: string;
  mobile: string | null;
  isTdsApplicable: boolean;
  tds: number;
}

/**
 * Finance invoice management. Tenant-scoped + branch-level; Prisma-direct. Invoices
 * are created ONLY from selected outstanding order records — the gross amount and
 * party are re-derived server-side (never trusted from the body). Reuses
 * {@link OrderService} (via DI, rule #3) so an invoice's amount matches the
 * Outstanding report exactly. Completion rule = "Invoice Amount Only".
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
  ) {}

  /**
   * Create an invoice from selected outstanding order records. Validates the
   * records exist, all carry the chosen party (same-party), are not already
   * invoiced, and have a positive outstanding due. The gross amount is the sum of
   * those dues; TDS/net are derived; the invoice number is drawn atomically from
   * the tenant's billing settings.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from the JWT profile)
   * @param actorId acting person id (from JWT) — recorded as `createdBy`
   * @param dto party type + source order ids + due dates + optional TDS/notes
   * @returns the created invoice with its source orders + (empty) payment history
   * @throws InvoiceSourceOrdersEmptyException when no records are supplied
   * @throws InvoiceOrderNotFoundException when a record does not resolve
   * @throws InvoiceOrderAlreadyInvoicedException when a record was already invoiced
   * @throws InvoicePartyMismatchException when a record lacks the chosen party
   * @throws InvoiceMixedPartyException when records span multiple parties
   * @throws InvoiceOrderNotOutstandingException when a record has no due
   * @throws InvoiceZeroAmountException when the total due is zero
   * @throws InvoicePartyResolutionException when the party master is missing
   */
  async create(
    tenantId: string,
    branchId: string | null,
    actorId: string | null,
    dto: CreateInvoiceDto,
  ): Promise<InvoiceDetail> {
    if (dto.sourceOrderIds.length === 0) {
      throw new InvoiceSourceOrdersEmptyException();
    }
    const orderIds = [...new Set(dto.sourceOrderIds)];

    const id = await this.prisma
      .withTenant(tenantId, async (tx) => {
        // Double-invoice guard: reject any order already carrying an ACTIVE invoice
        // link (a cancelled invoice soft-deletes its links, freeing the order).
        const alreadyLinked = await tx.invoiceSourceOrder.findMany({
          where: { tenantId, orderId: { in: orderIds }, deletedAt: null },
          select: { orderId: true },
        });
        if (alreadyLinked.length > 0) {
          throw new InvoiceOrderAlreadyInvoicedException(
            alreadyLinked.map((r) => r.orderId),
          );
        }

        // Per-order outstanding due + party FKs — reuse the Outstanding report logic.
        const info = await this.orderService.getOutstandingInfoForOrders(
          tx,
          tenantId,
          orderIds,
        );
        const missing = orderIds.filter((oid) => !info.has(oid));
        if (missing.length > 0) {
          throw new InvoiceOrderNotFoundException(missing);
        }

        // Same-party validation against the chosen party type.
        const partyIds = new Set<string>();
        const missingParty: string[] = [];
        const noDue: string[] = [];
        // Invoices are deliberately whole-rupee (Invoice.grossAmount is an `Int`
        // column) — an order's due can now carry paise (PaymentDetails supports
        // decimals), so it's rounded to the nearest rupee here, at the point it
        // enters the invoice, as an intentional business rule rather than a
        // silent truncation.
        const dueByOrder = new Map<string, number>();
        let gross = 0;
        for (const oid of orderIds) {
          const row = info.get(oid) as OrderPartyInfo;
          const fk = this.partyFk(row, dto.partyType);
          if (!fk) {
            missingParty.push(oid);
            continue;
          }
          partyIds.add(fk);
          const due = Math.round(row.due);
          dueByOrder.set(oid, due);
          if (due <= 0) {
            noDue.push(oid);
            continue;
          }
          gross += due;
        }
        if (missingParty.length > 0) {
          throw new InvoicePartyMismatchException(dto.partyType, missingParty);
        }
        if (partyIds.size > 1) {
          throw new InvoiceMixedPartyException({ partyIds: [...partyIds] });
        }
        if (noDue.length > 0) {
          throw new InvoiceOrderNotOutstandingException(noDue);
        }
        if (gross <= 0) {
          throw new InvoiceZeroAmountException();
        }
        const partyId = [...partyIds][0] as string;

        // Party snapshot + TDS defaults.
        const party = await this.resolveParty(
          tx,
          dto.partyType,
          partyId,
          tenantId,
        );
        const isTdsApplicable = dto.isTdsApplicable ?? party.isTdsApplicable;
        const tdsPercent = isTdsApplicable ? (dto.tdsPercent ?? party.tds) : 0;
        const tdsAmount = isTdsApplicable
          ? Math.round((gross * tdsPercent) / 100)
          : 0;
        const netAmount = gross - tdsAmount;

        // Invoice number — atomic bump of the tenant's billing settings counter.
        const invoiceNo = await this.nextInvoiceNo(tx, tenantId);

        const invoiceDueDate = new Date(dto.invoiceDueDate);
        const dueStatus = this.deriveDueStatus(invoiceDueDate, netAmount);

        const created = await tx.invoice.create({
          data: {
            tenantId,
            branchId,
            invoiceNo,
            invoiceDueDate,
            tdsDueDate: dto.tdsDueDate ? new Date(dto.tdsDueDate) : null,
            partyType: dto.partyType,
            partyId,
            partyName: party.name,
            partyMobile: party.mobile,
            grossAmount: gross,
            isTdsApplicable,
            tdsPercent,
            tdsAmount,
            netAmount,
            paidInvoice: 0,
            paidTds: 0,
            outstandingInvoice: netAmount,
            outstandingTds: tdsAmount,
            paymentStatus: InvoicePaymentStatus.PENDING,
            dueStatus,
            notes: dto.notes ?? null,
            attachmentUrl: dto.attachmentUrl ?? null,
            createdBy: actorId,
            sourceOrders: {
              create: orderIds.map((oid) => ({
                tenantId,
                branchId,
                orderId: oid,
                invoicedAmount: dueByOrder.get(oid) ?? 0,
              })),
            },
          },
          select: { id: true },
        });
        return created.id;
      })
      .catch((err: unknown) => {
        // A partial-unique-index race on the order link maps to already-invoiced.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new InvoiceOrderAlreadyInvoicedException(orderIds);
        }
        throw err;
      });

    return this.getOne(id, tenantId);
  }

  /**
   * List invoices (paginated) scoped to the caller's tenant + active branch, with
   * optional filters. Newest first.
   * @param tenantId tenant scope
   * @param activeBranchId active branch (from the JWT profile)
   * @param query filters + pagination
   */
  async list(
    tenantId: string,
    activeBranchId: string | null,
    query: ListInvoicesDto,
  ): Promise<PaginatedResult<InvoiceListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildInvoiceWhere(query, tenantId, activeBranchId);
    // Two independent reads (not array-form $transaction) so the per-op RLS
    // extension scopes each to the tenant context — see rls-outside-request gaps.
    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: INVOICE_LIST_INCLUDE,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Aggregate the seven invoice summary-card totals over the same scoped dataset
   * the list paginates (so cards reconcile with the list).
   * @param tenantId tenant scope
   * @param activeBranchId active branch (from the JWT profile)
   * @param query the same filter set as the list
   */
  async summary(
    tenantId: string,
    activeBranchId: string | null,
    query: InvoiceSummaryQueryDto,
  ): Promise<InvoiceSummary> {
    const where = this.buildInvoiceWhere(query, tenantId, activeBranchId);
    const agg = await this.prisma.invoice.aggregate({
      where,
      _sum: {
        grossAmount: true,
        tdsAmount: true,
        netAmount: true,
        paidInvoice: true,
        paidTds: true,
        outstandingInvoice: true,
        outstandingTds: true,
      },
    });
    return {
      grossAmount: agg._sum.grossAmount ?? 0,
      tdsAmount: agg._sum.tdsAmount ?? 0,
      netAmount: agg._sum.netAmount ?? 0,
      paidInvoice: agg._sum.paidInvoice ?? 0,
      paidTds: agg._sum.paidTds ?? 0,
      outstandingInvoice: agg._sum.outstandingInvoice ?? 0,
      outstandingTds: agg._sum.outstandingTds ?? 0,
    };
  }

  /**
   * Fetch one invoice with its source orders + payment history.
   * @throws InvoiceNotFoundException if missing/soft-deleted/other tenant
   */
  async getOne(id: string, tenantId: string): Promise<InvoiceDetail> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: INVOICE_DETAIL_INCLUDE,
    });
    if (!invoice) {
      throw new InvoiceNotFoundException(id);
    }
    return invoice;
  }

  /**
   * List an invoice's payment history (newest first). Validates the invoice first.
   * @throws InvoiceNotFoundException if the invoice does not resolve
   */
  async paymentHistory(
    id: string,
    tenantId: string,
  ): Promise<InvoicePaymentHistoryRow[]> {
    await this.getOne(id, tenantId);
    const rows = await this.prisma.invoicePayment.findMany({
      where: { invoiceId: id, tenantId, deletedAt: null },
      orderBy: { paymentDate: 'desc' },
      select: {
        id: true,
        paymentFor: true,
        amount: true,
        paymentMode: true,
        reference: true,
        attachmentUrl: true,
        paymentDate: true,
        notes: true,
        createdBy: true,
        createdAt: true,
      },
    });
    // Resolve each receipt's recording user (a Person id) to a display name for the
    // "By" column, so the UI shows a name instead of a UUID.
    const names = await this.resolvePersonNames(
      rows.map((r) => r.createdBy).filter((x): x is string => !!x),
    );
    return rows.map((r) => ({
      ...r,
      createdByName: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
    }));
  }

  /**
   * Resolve a set of Person ids to display names (`first middle last`). Mirrors the
   * audit module's resolver. Person is platform-level (no tenant scope).
   * @param ids person ids (may contain blanks/dupes)
   * @returns map of person id → display name (absent ids simply omitted)
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

  /**
   * Record one receipt (INVOICE or TDS) against an invoice, update its paid /
   * outstanding balances, and recompute its payment + due status. Invoice and TDS
   * receipts are posted as separate calls (distinct mode / reference / audit).
   * @param id invoice id
   * @param tenantId tenant scope
   * @param branchId active branch (from the JWT profile)
   * @param actorId acting person id (recorded as `createdBy` on the receipt)
   * @param dto receipt payload
   * @throws InvoiceNotFoundException if the invoice does not resolve
   * @throws InvoiceAlreadyCancelledException if the invoice is cancelled
   * @throws InvoicePaymentExceedsOutstandingException if the amount is too high
   */
  async receivePayment(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string | null,
    dto: ReceiveInvoicePaymentDto,
  ): Promise<InvoiceDetail> {
    const invoice = await this.getOne(id, tenantId);
    if (invoice.paymentStatus === InvoicePaymentStatus.CANCELLED) {
      throw new InvoiceAlreadyCancelledException(id);
    }
    const outstanding =
      dto.paymentFor === InvoicePaymentFor.INVOICE
        ? invoice.outstandingInvoice
        : invoice.outstandingTds;
    if (dto.amount > outstanding) {
      throw new InvoicePaymentExceedsOutstandingException(
        outstanding,
        dto.amount,
      );
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.invoicePayment.create({
        data: {
          tenantId,
          branchId,
          invoiceId: id,
          paymentFor: dto.paymentFor,
          amount: dto.amount,
          paymentMode: dto.paymentMode,
          reference: dto.reference,
          attachmentUrl: dto.attachmentUrl ?? null,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
          notes: dto.notes ?? null,
          createdBy: actorId,
        },
      });

      const paidInvoice =
        invoice.paidInvoice +
        (dto.paymentFor === InvoicePaymentFor.INVOICE ? dto.amount : 0);
      const paidTds =
        invoice.paidTds +
        (dto.paymentFor === InvoicePaymentFor.TDS ? dto.amount : 0);
      const outstandingInvoice = invoice.netAmount - paidInvoice;
      const outstandingTds = invoice.tdsAmount - paidTds;
      const paymentStatus = this.derivePaymentStatus(
        paidInvoice,
        outstandingInvoice,
      );

      // "Settled Late": the invoice reaches COMPLETED (net fully received) after its
      // due date. Set once on that transition; never cleared. Reporting flag only —
      // dueStatus stays ON_TIME (there is no unpaid balance).
      const settledLate =
        invoice.settledLate ||
        (paymentStatus === InvoicePaymentStatus.COMPLETED &&
          Date.now() > invoice.invoiceDueDate.getTime());

      await tx.invoice.update({
        where: { id },
        data: {
          paidInvoice,
          paidTds,
          outstandingInvoice,
          outstandingTds,
          paymentStatus,
          dueStatus: this.deriveDueStatus(
            invoice.invoiceDueDate,
            outstandingInvoice,
          ),
          settledLate,
          updatedBy: actorId,
        },
      });
    });

    return this.getOne(id, tenantId);
  }

  /**
   * Cancel an invoice with a mandatory reason. Blocked when any payment exists. The
   * invoice stays historically visible (not soft-deleted) so its number is never
   * reused; its source-order links are soft-deleted so those orders can be
   * invoiced again.
   * @throws InvoiceNotFoundException if the invoice does not resolve
   * @throws InvoiceAlreadyCancelledException if already cancelled
   * @throws InvoiceCancelBlockedHasPaymentsException if payments were recorded
   */
  async cancel(
    id: string,
    tenantId: string,
    actorId: string | null,
    dto: CancelInvoiceDto,
  ): Promise<InvoiceDetail> {
    const invoice = await this.getOne(id, tenantId);
    if (invoice.paymentStatus === InvoicePaymentStatus.CANCELLED) {
      throw new InvoiceAlreadyCancelledException(id);
    }
    const paymentCount = await this.prisma.invoicePayment.count({
      where: { invoiceId: id, tenantId, deletedAt: null },
    });
    if (paymentCount > 0) {
      throw new InvoiceCancelBlockedHasPaymentsException(id);
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.invoice.update({
        where: { id },
        data: {
          paymentStatus: InvoicePaymentStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: actorId,
          cancelReason: dto.cancelReason,
          updatedBy: actorId,
        },
      });
      await tx.invoiceSourceOrder.updateMany({
        where: { invoiceId: id, tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    });

    return this.getOne(id, tenantId);
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  /** The order's FK for the chosen party type (null when absent). */
  private partyFk(
    info: OrderPartyInfo,
    partyType: InvoicePartyType,
  ): string | null {
    switch (partyType) {
      case InvoicePartyType.B2B:
        return info.referralPanelId;
      case InvoicePartyType.REFERRED_BY:
        return info.referredByDoctorId;
      case InvoicePartyType.INTERNAL_REFERRAL_USER:
        return info.internalReferralId;
      case InvoicePartyType.EXTERNAL_REFERRAL_USER:
        return info.externalReferralId;
    }
  }

  /**
   * Resolve the party master snapshot (name / mobile / TDS defaults) for the chosen
   * party type. B2B (ReferralPanel) carries no TDS config, so TDS defaults off.
   * @throws InvoicePartyResolutionException when the master row is missing
   */
  private async resolveParty(
    tx: Prisma.TransactionClient,
    partyType: InvoicePartyType,
    partyId: string,
    tenantId: string,
  ): Promise<ResolvedParty> {
    const scope = { id: partyId, tenantId, deletedAt: null };
    switch (partyType) {
      case InvoicePartyType.B2B: {
        const panel = await tx.referralPanel.findFirst({
          where: scope,
          select: { name: true, directorMobile: true },
        });
        if (!panel)
          throw new InvoicePartyResolutionException(partyType, partyId);
        return {
          name: panel.name,
          mobile: panel.directorMobile,
          isTdsApplicable: false,
          tds: 0,
        };
      }
      case InvoicePartyType.REFERRED_BY: {
        const doc = await tx.referralDoctor.findFirst({
          where: scope,
          select: {
            firstName: true,
            lastName: true,
            mobileNumber: true,
            isTdsApplicable: true,
            tds: true,
          },
        });
        if (!doc) throw new InvoicePartyResolutionException(partyType, partyId);
        return {
          name: [doc.firstName, doc.lastName].filter(Boolean).join(' ').trim(),
          mobile: doc.mobileNumber,
          isTdsApplicable: doc.isTdsApplicable,
          tds: doc.tds ?? 0,
        };
      }
      case InvoicePartyType.INTERNAL_REFERRAL_USER: {
        const ref = await tx.internalReferral.findFirst({
          where: scope,
          select: {
            firstName: true,
            lastName: true,
            fullName: true,
            mobileNumber: true,
            isTdsApplicable: true,
            tds: true,
          },
        });
        if (!ref) throw new InvoicePartyResolutionException(partyType, partyId);
        const name =
          ref.fullName ??
          [ref.firstName, ref.lastName].filter(Boolean).join(' ').trim();
        return {
          name,
          mobile: ref.mobileNumber,
          isTdsApplicable: ref.isTdsApplicable,
          tds: ref.tds ?? 0,
        };
      }
      case InvoicePartyType.EXTERNAL_REFERRAL_USER: {
        const ref = await tx.externalReferral.findFirst({
          where: scope,
          select: {
            name: true,
            mobileNumber: true,
            isTdsApplicable: true,
            tds: true,
          },
        });
        if (!ref) throw new InvoicePartyResolutionException(partyType, partyId);
        return {
          name: ref.name,
          mobile: ref.mobileNumber,
          isTdsApplicable: ref.isTdsApplicable,
          tds: ref.tds ?? 0,
        };
      }
    }
  }

  /**
   * Draw the next invoice number from the tenant's billing settings, bumping the
   * counter atomically. Auto-creates the settings row on first use (mirrors the
   * billing-settings "created on first access" behaviour).
   */
  private async nextInvoiceNo(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string> {
    const existing = await tx.billingSetting.findUnique({
      where: { tenantId },
      select: { invoicePrefix: true, nextInvoiceNumber: true },
    });
    let prefix: string;
    let num: number;
    if (existing) {
      prefix = existing.invoicePrefix;
      num = existing.nextInvoiceNumber;
      await tx.billingSetting.update({
        where: { tenantId },
        data: { nextInvoiceNumber: { increment: 1 } },
      });
    } else {
      prefix = 'INV-';
      num = 1;
      await tx.billingSetting.create({
        data: { tenantId, nextInvoiceNumber: 2 },
      });
    }
    return `${prefix}${String(num).padStart(4, '0')}`;
  }

  /**
   * Payment status under the "Invoice Amount Only" completion rule: COMPLETED once
   * the net invoice balance is settled (outstanding TDS is tracked separately and
   * does not block completion), PARTIAL once anything is paid, else PENDING.
   */
  private derivePaymentStatus(
    paidInvoice: number,
    outstandingInvoice: number,
  ): InvoicePaymentStatus {
    if (outstandingInvoice <= 0) return InvoicePaymentStatus.COMPLETED;
    if (paidInvoice > 0) return InvoicePaymentStatus.PARTIAL;
    return InvoicePaymentStatus.PENDING;
  }

  /** OVERDUE when a balance remains past the due date, else ON_TIME. */
  private deriveDueStatus(
    invoiceDueDate: Date,
    outstandingInvoice: number,
  ): InvoiceDueStatus {
    if (outstandingInvoice > 0 && invoiceDueDate.getTime() < Date.now()) {
      return InvoiceDueStatus.OVERDUE;
    }
    return InvoiceDueStatus.ON_TIME;
  }

  /** Build the shared WHERE clause for list + summary (tenant + branch + filters). */
  private buildInvoiceWhere(
    query: ListInvoicesDto | InvoiceSummaryQueryDto,
    tenantId: string,
    activeBranchId: string | null,
  ): Prisma.InvoiceWhereInput {
    const where: Prisma.InvoiceWhereInput = { tenantId, deletedAt: null };
    const branchId = query.branchId ?? activeBranchId;
    if (branchId) where.branchId = branchId;
    if (query.invoiceType) where.partyType = query.invoiceType;
    if (query.partyId) where.partyId = query.partyId;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.dueStatus) where.dueStatus = query.dueStatus;
    if (query.dateFrom || query.dateTo) {
      where.invoiceDate = {};
      if (query.dateFrom) where.invoiceDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.invoiceDate.lte = new Date(query.dateTo);
    }
    if (query.search) {
      const contains = { contains: query.search, mode: 'insensitive' as const };
      where.OR = [
        { invoiceNo: contains },
        { partyName: contains },
        { partyMobile: contains },
      ];
    }
    return where;
  }
}
