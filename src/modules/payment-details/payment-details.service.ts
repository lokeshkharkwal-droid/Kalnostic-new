import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentDetails, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { derivePaymentStatus } from '../order/entities/order.entity';
import { CreatePaymentDetailsDto } from './dto/create-payment-details.dto';
import { UpdatePaymentDetailsDto } from './dto/update-payment-details.dto';
import { ListPaymentDetailsDto } from './dto/list-payment-details.dto';
import {
  PaymentDetailsNotFoundException,
  PaymentOrderCancelledException,
  PaymentOrderNotFoundException,
  PaymentOverpaymentException,
} from './exceptions/payment-details.exceptions';

/**
 * Payment ledger management for orders (1:many). Tenant-scoped + branch-level;
 * Prisma-direct. `branchId` is inherited from the parent order. Reads always
 * filter `{ tenantId, deletedAt: null }`; writes run in `withTenant`
 * transactions. Payments can also be created inline via the order create API.
 */
@Injectable()
export class PaymentDetailsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a payment against an order. Validates the order belongs to the
   * caller's tenant and inherits its `branchId`.
   * @param tenantId tenant scope
   * @param dto validated payload (incl. `orderId`)
   * @returns the created payment record
   * @throws PaymentOrderNotFoundException if the order doesn't resolve
   * @throws PaymentOrderCancelledException if the order is cancelled
   * @throws PaymentOverpaymentException if `paidAmount` exceeds the pending balance
   */
  async create(
    tenantId: string,
    dto: CreatePaymentDetailsDto,
  ): Promise<PaymentDetails> {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, tenantId, deletedAt: null },
      select: { id: true, branchId: true, status: true },
    });
    if (!order) {
      throw new PaymentOrderNotFoundException(dto.orderId);
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new PaymentOrderCancelledException(dto.orderId);
    }
    const { paymentDate, ...rest } = dto;
    return this.prisma.withTenant(tenantId, async (tx) => {
      // Overpayment guard: never let the summed paid exceed the summed net.
      const agg = await tx.paymentDetails.aggregate({
        where: { orderId: dto.orderId, tenantId, deletedAt: null },
        _sum: { netAmount: true, paidAmount: true },
      });
      const pending = (agg._sum.netAmount ?? 0) - (agg._sum.paidAmount ?? 0);
      const attempted = dto.paidAmount ?? 0;
      if (attempted > pending) {
        throw new PaymentOverpaymentException(pending, attempted);
      }
      const row = await tx.paymentDetails.create({
        data: {
          ...rest,
          tenantId,
          branchId: order.branchId,
          paymentDate: paymentDate ? new Date(paymentDate) : null,
        },
      });
      await this.recomputePaymentStatus(tx, tenantId, dto.orderId);
      return row;
    });
  }

  /**
   * Fetch one payment record by id, scoped to the caller's tenant.
   * @throws PaymentDetailsNotFoundException if missing/soft-deleted/other tenant
   */
  async findById(id: string, tenantId: string): Promise<PaymentDetails> {
    const row = await this.prisma.paymentDetails.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!row) {
      throw new PaymentDetailsNotFoundException(id);
    }
    return row;
  }

  /**
   * List payments in the caller's tenant (offset pagination), optionally filtered
   * to one `orderId`.
   * @param tenantId tenant scope
   * @param query `orderId` filter + pagination
   */
  async findAll(
    tenantId: string,
    query: ListPaymentDetailsDto,
  ): Promise<PaginatedResult<PaymentDetails>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PaymentDetailsWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.orderId) {
      where.orderId = query.orderId;
    }
    const [data, total] = await Promise.all([
      this.prisma.paymentDetails.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paymentDetails.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Update a payment record (partial).
   * @throws PaymentDetailsNotFoundException if missing/soft-deleted/other tenant
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdatePaymentDetailsDto,
  ): Promise<PaymentDetails> {
    const existing = await this.findById(id, tenantId);
    const { paymentDate, ...rest } = dto;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.paymentDetails.update({
        where: { id },
        data: {
          ...rest,
          paymentDate: paymentDate ? new Date(paymentDate) : undefined,
        },
      });
      await this.recomputePaymentStatus(tx, tenantId, existing.orderId);
      return row;
    });
  }

  /**
   * Soft-delete a payment record (sets `deletedAt`).
   * @throws PaymentDetailsNotFoundException if missing/soft-deleted/other tenant
   */
  async remove(id: string, tenantId: string): Promise<PaymentDetails> {
    const existing = await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.paymentDetails.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.recomputePaymentStatus(tx, tenantId, existing.orderId);
      return row;
    });
  }

  /**
   * Recompute and persist the parent order's derived `paymentStatus` from its
   * active payment ledger (summed `netAmount`/`paidAmount`). Called inside every
   * payment write so the stored status the orders/appointments lists filter by
   * stays in sync.
   * @param tx active tenant-scoped transaction client
   * @param tenantId tenant scope
   * @param orderId the order whose ledger changed
   */
  private async recomputePaymentStatus(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
  ): Promise<void> {
    const agg = await tx.paymentDetails.aggregate({
      where: { orderId, tenantId, deletedAt: null },
      _sum: { netAmount: true, paidAmount: true },
    });
    const net = agg._sum.netAmount ?? 0;
    const paid = agg._sum.paidAmount ?? 0;
    await tx.order.update({
      where: { id: orderId },
      data: { paymentStatus: derivePaymentStatus(net, paid) },
    });
  }
}
