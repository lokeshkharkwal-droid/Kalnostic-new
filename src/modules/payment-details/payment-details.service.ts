import { Injectable } from '@nestjs/common';
import { PaymentDetails, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreatePaymentDetailsDto } from './dto/create-payment-details.dto';
import { UpdatePaymentDetailsDto } from './dto/update-payment-details.dto';
import { ListPaymentDetailsDto } from './dto/list-payment-details.dto';
import {
  PaymentDetailsNotFoundException,
  PaymentOrderNotFoundException,
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
   */
  async create(
    tenantId: string,
    dto: CreatePaymentDetailsDto,
  ): Promise<PaymentDetails> {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, tenantId, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (!order) {
      throw new PaymentOrderNotFoundException(dto.orderId);
    }
    const { paymentDate, ...rest } = dto;
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.paymentDetails.create({
        data: {
          ...rest,
          tenantId,
          branchId: order.branchId,
          paymentDate: paymentDate ? new Date(paymentDate) : null,
        },
      }),
    );
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
    await this.findById(id, tenantId);
    const { paymentDate, ...rest } = dto;
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.paymentDetails.update({
        where: { id },
        data: {
          ...rest,
          paymentDate: paymentDate ? new Date(paymentDate) : undefined,
        },
      }),
    );
  }

  /**
   * Soft-delete a payment record (sets `deletedAt`).
   * @throws PaymentDetailsNotFoundException if missing/soft-deleted/other tenant
   */
  async remove(id: string, tenantId: string): Promise<PaymentDetails> {
    await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.paymentDetails.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    );
  }
}
