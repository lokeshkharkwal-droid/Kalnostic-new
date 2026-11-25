import { Injectable } from '@nestjs/common';
import { PaymentEntryType, Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '../../common/exceptions/kaltros.exception';
import { PatientPortalService } from './patient-portal.service';
import {
  BILL_STATUSES,
  BILL_STATUS_LABELS,
  composeName,
  paymentModeLabel,
} from './patient-portal.util';
import {
  PatientTransactionDetail,
  PatientTransactionRow,
  TRANSACTION_TYPE_LABELS,
} from './entities/patient-transaction.entity';

/**
 * Patient-facing transaction history — the SAME payment records that appear under
 * a bill's "Payment History" (never a separate store). **Person-scoped,
 * cross-business:** the list is consolidated across EVERY business (tenant) the
 * patient is enrolled in, and across every branch within each. For each business
 * the reads run inside that tenant's RLS context (`runWithTenant`) and still
 * filter `{ tenantId, …, order.patientId }`, so ownership is enforced twice — a
 * patient can never reach another patient's transaction by changing an id. Each
 * row is tagged with its `tenantId`/`tenantName`, which the detail endpoint then
 * requires (so it re-enters the correct business).
 *
 * Transaction type (what the payment was FOR) is resolved authoritatively: an
 * appointment order always wins (from its appointment FK), otherwise the stamped
 * `transactionType` (ORDER = collected inline at order creation, BILL = collected
 * later via Make Payment). Exactly one category per transaction.
 */
@Injectable()
export class PatientTransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientPortal: PatientPortalService,
  ) {}

  /** Every patient record the person holds in the tenant (all branches). */
  private async resolvePatientIds(
    tenantId: string,
    personId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.patient.findMany({
      where: { tenantId, personId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Resolve the final transaction type (exactly one category): an appointment
   * order always classifies as APPOINTMENT (from its FK), else the stamped value.
   */
  private resolveType(
    appointmentId: string | null,
    stored: TransactionType,
  ): TransactionType {
    return appointmentId ? TransactionType.APPOINTMENT : stored;
  }

  /** The list `where` for one tenant (tenantId kept for defence-in-depth + no-RLS). */
  private buildListWhere(
    tenantId: string,
    patientIds: string[],
    dateFrom?: string,
    dateTo?: string,
  ): Prisma.PaymentDetailsWhereInput {
    const where: Prisma.PaymentDetailsWhereInput = {
      tenantId,
      deletedAt: null,
      revertedAt: null,
      entryType: PaymentEntryType.PAYMENT,
      paidAmount: { gt: 0 },
      order: {
        patientId: { in: patientIds },
        deletedAt: null,
        status: { in: BILL_STATUSES },
      },
    };
    if (dateFrom || dateTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (dateFrom) createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
      where.createdAt = createdAt;
    }
    return where;
  }

  /**
   * Paginated transaction list for the patient, consolidated across every business
   * they belong to (and every branch within each). Only real collections (PAYMENT
   * rows with money, not reverted) appear — mirroring the staff "Payment History".
   * Optional date-range filter. Each business is queried for its newest
   * `page × limit` rows, merged, sorted by date desc and sliced to the page; the
   * total is the sum of per-business counts.
   * @returns the page plus pagination counts for the `meta` envelope
   */
  async listTransactions(
    personId: string,
    params: {
      dateFrom?: string;
      dateTo?: string;
      page: number;
      limit: number;
    },
  ): Promise<{
    data: PatientTransactionRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const tenants = await this.patientPortal.getEnrolledTenants(personId);
    if (tenants.length === 0) {
      return { data: [], total: 0, page: params.page, limit: params.limit };
    }

    const windowSize = params.page * params.limit;
    const perTenant = await Promise.all(
      tenants.map((t) =>
        this.prisma.runWithTenant(t.tenantId, async () => {
          const patientIds = await this.resolvePatientIds(t.tenantId, personId);
          if (patientIds.length === 0) {
            return { rows: [] as PatientTransactionRow[], count: 0 };
          }
          const where = this.buildListWhere(
            t.tenantId,
            patientIds,
            params.dateFrom,
            params.dateTo,
          );
          const [rows, count] = await Promise.all([
            this.prisma.paymentDetails.findMany({
              where,
              orderBy: { createdAt: 'desc' },
              take: windowSize,
              select: {
                id: true,
                paidAmount: true,
                paymentDate: true,
                createdAt: true,
                transactionType: true,
                order: {
                  select: {
                    appointmentId: true,
                    patient: {
                      select: {
                        salutation: true,
                        firstName: true,
                        middleName: true,
                        lastName: true,
                      },
                    },
                  },
                },
              },
            }),
            this.prisma.paymentDetails.count({ where }),
          ]);
          const mapped: PatientTransactionRow[] = rows.map((p) => {
            const type = this.resolveType(
              p.order.appointmentId,
              p.transactionType,
            );
            return {
              id: p.id,
              dateTime: (p.paymentDate ?? p.createdAt).toISOString(),
              patientName: composeName(p.order.patient),
              totalPayment: Number(p.paidAmount),
              transactionType: type,
              transactionTypeLabel: TRANSACTION_TYPE_LABELS[type],
              tenantId: t.tenantId,
              tenantName: t.tenantName,
            };
          });
          return { rows: mapped, count };
        }),
      ),
    );

    const all = perTenant
      .flatMap((r) => r.rows)
      .sort(
        (a, b) =>
          new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime(),
      );
    const total = perTenant.reduce((s, r) => s + r.count, 0);
    const start = (params.page - 1) * params.limit;
    const data = all.slice(start, start + params.limit);
    return { data, total, page: params.page, limit: params.limit };
  }

  /**
   * One transaction's full detail, re-entering the business it belongs to
   * (`tenantId` comes from the list row). Owner-checked: the payment's order must
   * belong to one of the person's patient records in that business.
   * @throws NotFoundException when the transaction isn't the patient's (no info leak)
   */
  async getTransactionDetail(
    personId: string,
    tenantId: string,
    id: string,
  ): Promise<PatientTransactionDetail> {
    const detail = await this.prisma.runWithTenant(tenantId, async () => {
      const patientIds = await this.resolvePatientIds(tenantId, personId);
      const txn = await this.prisma.paymentDetails.findFirst({
        where: {
          id,
          tenantId,
          deletedAt: null,
          order: {
            patientId: { in: patientIds },
            deletedAt: null,
            status: { in: BILL_STATUSES },
          },
        },
        select: {
          id: true,
          orderId: true,
          paidAmount: true,
          paymentMode: true,
          paymentDate: true,
          createdAt: true,
          transactionType: true,
          order: {
            select: {
              orderCode: true,
              appointmentAt: true,
              appointmentId: true,
              billStatus: true,
              branch: { select: { name: true } },
              patient: {
                select: {
                  salutation: true,
                  firstName: true,
                  middleName: true,
                  lastName: true,
                  umId: true,
                },
              },
              // Latest live refund on this order — surfaces as the "Refund Date".
              payments: {
                where: {
                  deletedAt: null,
                  revertedAt: null,
                  entryType: PaymentEntryType.REFUND,
                },
                orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
                take: 1,
                select: { paymentDate: true, createdAt: true },
              },
            },
          },
        },
      });
      if (!txn) {
        throw new NotFoundException('Transaction', id);
      }

      const type = this.resolveType(
        txn.order.appointmentId,
        txn.transactionType,
      );
      const refund = txn.order.payments[0];
      const refundDate = refund
        ? (refund.paymentDate ?? refund.createdAt).toISOString()
        : null;

      return {
        id: txn.id,
        amount: Number(txn.paidAmount),
        transactionId: txn.id,
        transactionType: type,
        transactionTypeLabel: TRANSACTION_TYPE_LABELS[type],
        billOrderId: txn.orderId,
        order: {
          patientName: composeName(txn.order.patient),
          patientId: txn.order.patient.umId ?? '—',
          appointmentAt: txn.order.appointmentAt?.toISOString() ?? null,
          orderId: txn.order.orderCode,
          billStatus: txn.order.billStatus,
          billStatusLabel: BILL_STATUS_LABELS[txn.order.billStatus],
          branchName: txn.order.branch?.name ?? null,
          tenantName: null as string | null,
        },
        payment: {
          transactionId: txn.id,
          paidOn: (txn.paymentDate ?? txn.createdAt).toISOString(),
          amount: Number(txn.paidAmount),
          paidVia: paymentModeLabel(txn.paymentMode),
          refundDate,
        },
      } satisfies PatientTransactionDetail;
    });

    // Stamp the business name (platform-level read, RLS-exempt).
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { name: true },
    });
    detail.order.tenantName = tenant?.name ?? null;
    return detail;
  }
}
