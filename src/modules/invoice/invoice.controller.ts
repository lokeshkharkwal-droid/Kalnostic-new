import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ReceiveInvoicePaymentDto } from './dto/receive-invoice-payment.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { ListInvoicesDto } from './dto/list-invoices.dto';
import { InvoiceSummaryQueryDto } from './dto/invoice-summary-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Finance invoice endpoints. Business-authenticated; tenant comes from the JWT and
 * the branch from the active profile. Invoices are created only from selected
 * outstanding order records. Literal routes (`/summary`) are declared before the
 * `/:id` routes so they win.
 */
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  /** Create an invoice from selected outstanding order records. */
  @Post()
  @Audit({
    module: AuditModule.INVOICE,
    action: AuditAction.CREATE,
    description: 'Created an invoice',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoiceService.create(
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /** List invoices (paginated, with filters). Scoped to the active branch. */
  @Get()
  list(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListInvoicesDto,
  ) {
    return this.invoiceService.list(tenantId, profile.branchId, query);
  }

  /** Summary-card totals over the same scoped dataset the list paginates. */
  @Get('summary')
  summary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: InvoiceSummaryQueryDto,
  ) {
    return this.invoiceService.summary(tenantId, profile.branchId, query);
  }

  /** Fetch one invoice with its source orders + payment history. */
  @Get(':id')
  getOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.invoiceService.getOne(id, tenantId);
  }

  /** List an invoice's payment history (newest first). */
  @Get(':id/payments')
  payments(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.invoiceService.paymentHistory(id, tenantId);
  }

  /** Record an invoice or TDS receipt against an invoice. */
  @Post(':id/receive-payment')
  @Audit({
    module: AuditModule.INVOICE,
    action: AuditAction.UPDATE,
    description: 'Recorded an invoice/TDS receipt',
  })
  receivePayment(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ReceiveInvoicePaymentDto,
  ) {
    return this.invoiceService.receivePayment(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /** Cancel an invoice with a mandatory reason (blocked once payments exist). */
  @Post(':id/cancel')
  @Audit({
    module: AuditModule.INVOICE,
    action: AuditAction.UPDATE,
    description: 'Cancelled an invoice',
  })
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CancelInvoiceDto,
  ) {
    return this.invoiceService.cancel(id, tenantId, personId, dto);
  }
}
