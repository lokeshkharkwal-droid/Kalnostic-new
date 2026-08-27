import { UseGuards, Controller, Get, Query } from '@nestjs/common';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { FinancePaymentsService } from './finance-payments.service';
import { ListFinancePaymentsDto } from './dto/list-finance-payments.dto';
import { FinancePaymentsSummaryQueryDto } from './dto/finance-payments-summary-query.dto';

/**
 * Finance → Payments consolidated ledger (read-only). Two endpoints back the
 * single Payments page: the paginated records list and the summary KPI cards.
 * Both are business-JWT protected (global guard) and tenant-scoped. Writes
 * (record payment / cancel) are performed against the existing `/payments`,
 * `/invoices/:id/receive-payment`, `/orders/:id/cancel` and `/invoices/:id/cancel`
 * endpoints — this controller never mutates.
 */
@Controller('finance/payments')
@UseGuards(PermissionGuard)
export class FinancePaymentsController {
  constructor(
    private readonly financePaymentsService: FinancePaymentsService,
  ) {}

  /** Paginated, filtered ledger rows merged from order + invoice payments. */
  @Get()
  @RequirePermission(PERMISSION_KEYS.FIN_PAYMENTS_LIST)
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListFinancePaymentsDto,
  ) {
    return this.financePaymentsService.findAll(tenantId, query);
  }

  /** KPI totals (mode breakdown + cancelled/refunded) for the summary cards. */
  @Get('summary')
  @RequirePermission(PERMISSION_KEYS.FIN_PAYMENTS_LIST)
  summary(
    @CurrentTenant() tenantId: string,
    @Query() query: FinancePaymentsSummaryQueryDto,
  ) {
    return this.financePaymentsService.getSummary(tenantId, query);
  }
}
