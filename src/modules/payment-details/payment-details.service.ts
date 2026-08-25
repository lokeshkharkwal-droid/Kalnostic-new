import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import {
  derivePaymentStatus,
  computeEffectivePaid,
} from '../order/entities/order.entity';
import { RegistrationSettingsService } from '../registration-settings/registration-settings.service';
import { CreatePaymentDetailsDto } from './dto/create-payment-details.dto';
import { UpdatePaymentDetailsDto } from './dto/update-payment-details.dto';
import { ListPaymentDetailsDto } from './dto/list-payment-details.dto';
import {
  mapPaymentDetails,
  PaymentDetailsEntity,
} from './entities/payment-details.entity';
import {
  PaymentCollectionByOtherUserNotAllowedException,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly registrationSettingsService: RegistrationSettingsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Enforce the branch's `BillingMenu_AllowCollectionOfAmountByOtherUser` gate:
   * a user other than the order's creator may only collect/modify payments when
   * the setting is on. Legacy orders with no `createdBy` stay permissive. Orders
   * with no branch have no settings to consult, so they stay permissive too.
   * @throws PaymentCollectionByOtherUserNotAllowedException when barred
   */
  private async assertCanCollect(
    tenantId: string,
    order: { id: string; branchId: string | null; createdBy: string | null },
    actorId: string | null,
  ): Promise<void> {
    if (!order.createdBy || order.createdBy === actorId || !order.branchId) {
      return;
    }
    const settings = await this.registrationSettingsService.getForBranch(
      tenantId,
      order.branchId,
    );
    if (!settings.BillingMenu_AllowCollectionOfAmountByOtherUser) {
      throw new PaymentCollectionByOtherUserNotAllowedException(
        order.id,
        order.createdBy,
        actorId,
      );
    }
  }

  /**
   * Load the parent order and run {@link assertCanCollect}. Used by
   * `update`/`remove`, which start from a payment row rather than an order.
   * @throws PaymentOrderNotFoundException if the order no longer resolves
   * @throws PaymentCollectionByOtherUserNotAllowedException when barred
   */
  private async assertCanCollectForOrder(
    tenantId: string,
    orderId: string,
    actorId: string | null,
  ): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      select: { id: true, branchId: true, createdBy: true },
    });
    if (!order) {
      throw new PaymentOrderNotFoundException(orderId);
    }
    await this.assertCanCollect(tenantId, order, actorId);
  }

  /**
   * Create a payment against an order. Validates the order belongs to the
   * caller's tenant and inherits its `branchId`.
   * @param tenantId tenant scope
   * @param personId the acting user's `Person.id` (from JWT) — checked against
   *   the order's creator for the collection-by-other-user gate
   * @param dto validated payload (incl. `orderId`)
   * @returns the created payment record
   * @throws PaymentOrderNotFoundException if the order doesn't resolve
   * @throws PaymentOrderCancelledException if the order is cancelled
   * @throws PaymentCollectionByOtherUserNotAllowedException if a non-creator is
   *   barred by the branch setting
   * @throws PaymentOverpaymentException if `paidAmount` exceeds the pending balance
   */
  async create(
    tenantId: string,
    personId: string | null,
    dto: CreatePaymentDetailsDto,
  ): Promise<PaymentDetailsEntity> {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, tenantId, deletedAt: null },
      select: {
        id: true,
        branchId: true,
        status: true,
        createdBy: true,
        cancellationCharge: true,
      },
    });
    if (!order) {
      throw new PaymentOrderNotFoundException(dto.orderId);
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new PaymentOrderCancelledException(dto.orderId);
    }
    await this.assertCanCollect(tenantId, order, personId);
    const { paymentDate, ...rest } = dto;
    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      // Overpayment guard: never let the collected amount exceed the pending
      // balance. Pending is derived off the order's EFFECTIVE paid amount
      // (`paid − cancellationCharge − refunds − refund charges`) — the same
      // figure the billing UI and stored `paymentStatus` use — so a refund
      // (which returns money and re-opens balance) raises the acceptable amount
      // instead of being ignored. Using raw summed paid here would reject a
      // legitimate re-payment of refunded money.
      const agg = await tx.paymentDetails.aggregate({
        where: { orderId: dto.orderId, tenantId, deletedAt: null },
        _sum: {
          netAmount: true,
          paidAmount: true,
          refundAmount: true,
          refundCharge: true,
        },
      });
      const effectivePaid = computeEffectivePaid(
        agg._sum.paidAmount?.toNumber() ?? 0,
        order.cancellationCharge.toNumber(),
        agg._sum.refundAmount?.toNumber() ?? 0,
        agg._sum.refundCharge?.toNumber() ?? 0,
      );
      const pending = (agg._sum.netAmount?.toNumber() ?? 0) - effectivePaid;
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
      return mapPaymentDetails(row);
    });
    // Fire-and-forget: acknowledge the payment to the patient (email + in-app).
    // Handled by ClinicalEventListener; never blocks payment recording.
    void this.eventEmitter.emitAsync('payment.received', {
      tenantId,
      orderId: dto.orderId,
      amount: dto.paidAmount ?? 0,
      paymentMode: dto.paymentMode ?? null,
    });
    return result;
  }

  /**
   * Fetch one payment record by id, scoped to the caller's tenant.
   * @throws PaymentDetailsNotFoundException if missing/soft-deleted/other tenant
   */
  async findById(id: string, tenantId: string): Promise<PaymentDetailsEntity> {
    const row = await this.prisma.paymentDetails.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!row) {
      throw new PaymentDetailsNotFoundException(id);
    }
    return mapPaymentDetails(row);
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
  ): Promise<PaginatedResult<PaymentDetailsEntity>> {
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
    return { data: data.map(mapPaymentDetails), total, page, limit };
  }

  /**
   * Update a payment record (partial).
   * @param personId acting user (checked against the order's creator)
   * @throws PaymentDetailsNotFoundException if missing/soft-deleted/other tenant
   * @throws PaymentCollectionByOtherUserNotAllowedException if a non-creator is
   *   barred by the branch setting
   */
  async update(
    id: string,
    tenantId: string,
    personId: string | null,
    dto: UpdatePaymentDetailsDto,
  ): Promise<PaymentDetailsEntity> {
    const existing = await this.findById(id, tenantId);
    await this.assertCanCollectForOrder(tenantId, existing.orderId, personId);
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
      return mapPaymentDetails(row);
    });
  }

  /**
   * Soft-delete a payment record (sets `deletedAt`).
   * @param personId acting user (checked against the order's creator)
   * @throws PaymentDetailsNotFoundException if missing/soft-deleted/other tenant
   * @throws PaymentCollectionByOtherUserNotAllowedException if a non-creator is
   *   barred by the branch setting
   */
  async remove(
    id: string,
    tenantId: string,
    personId: string | null,
  ): Promise<PaymentDetailsEntity> {
    const existing = await this.findById(id, tenantId);
    await this.assertCanCollectForOrder(tenantId, existing.orderId, personId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.paymentDetails.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.recomputePaymentStatus(tx, tenantId, existing.orderId);
      return mapPaymentDetails(row);
    });
  }

  /**
   * Recompute and persist the parent order's derived `paymentStatus` from its
   * active payment ledger. Derived off the order's **effective** paid amount
   * (`paid − cancellationCharge − refunds − refund charges`) so a cancelled or
   * refunded order's status reflects reality. Called inside every payment write so
   * the stored status the orders/appointments lists filter by stays in sync.
   * @param tx active tenant-scoped transaction client
   * @param tenantId tenant scope
   * @param orderId the order whose ledger changed
   */
  private async recomputePaymentStatus(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
  ): Promise<void> {
    const [agg, order] = await Promise.all([
      tx.paymentDetails.aggregate({
        where: { orderId, tenantId, deletedAt: null },
        _sum: {
          netAmount: true,
          paidAmount: true,
          refundAmount: true,
          refundCharge: true,
        },
      }),
      tx.order.findFirst({
        where: { id: orderId, tenantId },
        select: { cancellationCharge: true },
      }),
    ]);
    const net = agg._sum.netAmount?.toNumber() ?? 0;
    const effectivePaid = computeEffectivePaid(
      agg._sum.paidAmount?.toNumber() ?? 0,
      order?.cancellationCharge.toNumber() ?? 0,
      agg._sum.refundAmount?.toNumber() ?? 0,
      agg._sum.refundCharge?.toNumber() ?? 0,
    );
    await tx.order.update({
      where: { id: orderId },
      data: { paymentStatus: derivePaymentStatus(net, effectivePaid) },
    });
  }
}
