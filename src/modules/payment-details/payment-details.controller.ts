import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PaymentDetailsService } from './payment-details.service';
import { CreatePaymentDetailsDto } from './dto/create-payment-details.dto';
import { UpdatePaymentDetailsDto } from './dto/update-payment-details.dto';
import { ListPaymentDetailsDto } from './dto/list-payment-details.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Payment ledger endpoints (`/payments`). Business-authenticated; tenant from the
 * JWT. The global `JwtAuthGuard` protects all routes. Payments can also be
 * created inline with an order via the order create API.
 */
@Controller('payments')
export class PaymentDetailsController {
  constructor(private readonly paymentDetailsService: PaymentDetailsService) {}

  /** Create a payment against an order. */
  @Post()
  @Audit({
    module: AuditModule.PAYMENT_DETAILS,
    action: AuditAction.CREATE,
    description: 'Created a payment',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreatePaymentDetailsDto,
  ) {
    return this.paymentDetailsService.create(tenantId, dto);
  }

  /** List payments (paginated, optionally filtered by `orderId`). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListPaymentDetailsDto,
  ) {
    return this.paymentDetailsService.findAll(tenantId, query);
  }

  /** Fetch one payment record. */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.paymentDetailsService.findById(id, tenantId);
  }

  /** Update a payment record. */
  @Patch(':id')
  @Audit({
    module: AuditModule.PAYMENT_DETAILS,
    action: AuditAction.UPDATE,
    description: 'Updated a payment',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentDetailsDto,
  ) {
    return this.paymentDetailsService.update(id, tenantId, dto);
  }

  /** Soft-delete a payment record. */
  @Delete(':id')
  @Audit({
    module: AuditModule.PAYMENT_DETAILS,
    action: AuditAction.DELETE,
    description: 'Deleted a payment',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.paymentDetailsService.remove(id, tenantId);
  }
}
