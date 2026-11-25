import { Injectable } from '@nestjs/common';
import { PaymentEntryType, Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '../../common/exceptions/kaltros.exception';
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
 * a bill's "Payment History" (never a separate store). Lists the authenticated
 * patient's collected payments across EVERY branch of the active tenant, and
 * details one for the modal. Every read is scoped to the person's patient
 * record(s) + tenant from the JWT; ownership is enforced here, so a patient can
 * never reach another patient's transaction by changing an id.
 *
 * Transaction type (what the payment was FOR) is resolved authoritatively: an
 * appointment order always wins (from its appointment FK), otherwise the stamped
 * `transactionType` (ORDER = collected inline at order creation, BILL = collected
 * later via Make Payment). Exactly one category per transaction.
 */
@Injectable()
export class PatientTransactionService {
  constructor(private readonly prisma: PrismaService) {}

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

  /**
   * Paginated transaction list for the patient, consolidated across all branches
   * of the tenant. Only real collections (PAYMENT rows with money, not reverted)
   * appear — mirroring the staff "Payment History". Optional date-range filter.
   * @returns the page plus pagination counts for the `meta` envelope
   */
  async listTransactions(
    tenantId: string,
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
    const patientIds = await this.resolvePatientIds(tenantId, personId);
    if (patientIds.length === 0) {
      return { data: [], total: 0, page: params.page, limit: params.limit };
    }

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
    if (params.dateFrom || params.dateTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (params.dateFrom) createdAt.gte = new Date(params.dateFrom);
      if (params.dateTo) {
        const end = new Date(params.dateTo);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
      where.createdAt = createdAt;
    }

    const [rows, total] = await Promise.all([
      this.prisma.paymentDetails.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
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

    const data: PatientTransactionRow[] = rows.map((p) => {
      const type = this.resolveType(p.order.appointmentId, p.transactionType);
      return {
        id: p.id,
        dateTime: (p.paymentDate ?? p.createdAt).toISOString(),
        patientName: composeName(p.order.patient),
        totalPayment: Number(p.paidAmount),
        transactionType: type,
        transactionTypeLabel: TRANSACTION_TYPE_LABELS[type],
      };
    });
    return { data, total, page: params.page, limit: params.limit };
  }

  /**
   * One transaction's full detail (order context + payment facts), owner-checked:
   * the payment's order must belong to one of the person's patient records in the
   * tenant.
   * @throws NotFoundException when the transaction isn't the patient's (no info leak)
   */
  async getTransactionDetail(
    tenantId: string,
    personId: string,
    id: string,
  ): Promise<PatientTransactionDetail> {
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

    const type = this.resolveType(txn.order.appointmentId, txn.transactionType);
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
      },
      payment: {
        transactionId: txn.id,
        paidOn: (txn.paymentDate ?? txn.createdAt).toISOString(),
        amount: Number(txn.paidAmount),
        paidVia: paymentModeLabel(txn.paymentMode),
        refundDate,
      },
    };
  }
}
