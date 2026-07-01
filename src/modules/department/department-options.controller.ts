import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { DepartmentService } from './department.service';
import { ListDepartmentQueryDto } from './dto/list-department-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Flat department endpoints (`/departments/...`) for the business side: browsing
 * SITE_ADMIN templates and cloning one into the tenant. Business-authenticated;
 * tenant comes from the JWT (global `JwtAuthGuard`).
 *
 * Registered BEFORE `DepartmentController` in the module so `GET /departments/templates`
 * is matched here and not captured by that controller's `GET /departments/:id`.
 */
@Controller('departments')
export class DepartmentOptionsController {
  constructor(private readonly departmentService: DepartmentService) {}

  /**
   * Browse SITE_ADMIN global template departments (read-only) so the tenant can
   * pick one to clone. Declared before `:id` routes so `templates` isn't matched
   * as an id.
   */
  @Get('templates')
  findTemplates(@Query() query: ListDepartmentQueryDto) {
    return this.departmentService.findAllTemplates(
      query.page ?? 1,
      query.limit ?? 20,
      {
        search: query.search,
        status: query.status,
        moduleMapping: query.moduleMapping,
      },
    );
  }

  /**
   * Fetch one SITE_ADMIN template department (read-only).
   */
  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.departmentService.findTemplateById(id);
  }

  /**
   * Clone a SITE_ADMIN template department into the caller's tenant catalogue.
   * `tenantId` comes from the JWT; a fresh tenant code is minted. Idempotent: a
   * template already cloned into the tenant returns the existing copy.
   */
  @Post(':id/clone')
  @Audit({
    module: AuditModule.DEPARTMENT,
    action: AuditAction.CREATE,
    description: 'Cloned a Site Admin department template into the tenant',
  })
  clone(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.departmentService.cloneToTenant(id, tenantId);
  }
}
