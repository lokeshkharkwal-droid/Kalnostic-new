import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { MessagingReportService } from './messaging-report.service';
import {
  SmsReportQueryDto,
  WhatsappReportQueryDto,
} from './dto/messaging-report-query.dto';
import { MessageIdParamDto } from './dto/message-id-param.dto';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

/**
 * Business Admin messaging reports (REPORT → WhatsApp Report / SMS Report).
 * Read-only views over the Exchange gateway's message records for the caller's
 * tenant (tenant from the JWT). Each channel has its own view permission;
 * `business_admin` holds both. Static channel routes are declared explicitly so
 * each gets its own DTO and permission.
 */
@Controller('messaging-reports')
@UseGuards(PermissionGuard)
export class MessagingReportController {
  constructor(private readonly reports: MessagingReportService) {}

  /** WhatsApp Report: one page of messages for a date range (+ optional status). */
  @Get('whatsapp')
  @RequirePermission(PERMISSION_KEYS.BA_REPORTS_VIEW_WHATSAPP)
  whatsapp(
    @CurrentTenant() tenantId: string,
    @Query() query: WhatsappReportQueryDto,
  ) {
    return this.reports.list(tenantId, 'whatsapp', query);
  }

  /** WhatsApp Report → Message Detail. */
  @Get('whatsapp/:id')
  @RequirePermission(PERMISSION_KEYS.BA_REPORTS_VIEW_WHATSAPP)
  whatsappDetail(
    @CurrentTenant() tenantId: string,
    @Param() params: MessageIdParamDto,
  ) {
    return this.reports.detail(tenantId, 'whatsapp', params.id);
  }

  /** SMS Report: one page of messages for a date range (+ optional status), with parts count. */
  @Get('sms')
  @RequirePermission(PERMISSION_KEYS.BA_REPORTS_VIEW_SMS)
  sms(@CurrentTenant() tenantId: string, @Query() query: SmsReportQueryDto) {
    return this.reports.list(tenantId, 'sms', query);
  }

  /** SMS Report → Message Detail. */
  @Get('sms/:id')
  @RequirePermission(PERMISSION_KEYS.BA_REPORTS_VIEW_SMS)
  smsDetail(
    @CurrentTenant() tenantId: string,
    @Param() params: MessageIdParamDto,
  ) {
    return this.reports.detail(tenantId, 'sms', params.id);
  }
}
