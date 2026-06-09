import { Controller, Get, Param, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { QueryAuditDto } from './dto/query-audit.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

/**
 * Audit-log read endpoints (business-authenticated; tenant comes from the JWT).
 * The global `JwtAuthGuard` protects all routes. Audit rows are written only by
 * the `AuditInterceptor` / internal `AuditService.record` calls — never by
 * clients — so there are no create/update/delete routes here.
 */
@Controller('audits')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * List audit logs in the caller's tenant (paginated, filterable).
   */
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: QueryAuditDto) {
    return this.auditService.findAllForTenant(tenantId, query);
  }

  /**
   * Fetch one audit log by id.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.auditService.findById(id, tenantId);
  }
}
