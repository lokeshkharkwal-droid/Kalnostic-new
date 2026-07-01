import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { SubCategoryService } from './sub-category.service';
import { ListSubCategoryQueryDto } from './dto/list-sub-category-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Flat sub-category endpoints (`/sub-categories/...`) for the business side:
 * browsing SITE_ADMIN templates and cloning one into the tenant.
 * Business-authenticated; tenant comes from the JWT (global `JwtAuthGuard`).
 *
 * Registered BEFORE `SubCategoryController` so `GET /sub-categories/templates`
 * is matched here and not captured by that controller's `GET /sub-categories/:id`.
 */
@Controller('sub-categories')
export class SubCategoryOptionsController {
  constructor(private readonly subCategoryService: SubCategoryService) {}

  /**
   * Browse SITE_ADMIN global template sub-categories (read-only) so the tenant
   * can pick one to clone.
   */
  @Get('templates')
  findTemplates(@Query() query: ListSubCategoryQueryDto) {
    return this.subCategoryService.findAllTemplates(
      query.page ?? 1,
      query.limit ?? 20,
      {
        search: query.search,
        subCategoryType: query.subCategoryType,
        status: query.status,
        departmentId: query.departmentId,
        categoryId: query.categoryId,
      },
    );
  }

  /**
   * Fetch one SITE_ADMIN template sub-category (read-only).
   */
  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.subCategoryService.findTemplateById(id);
  }

  /**
   * Clone a SITE_ADMIN template sub-category into the caller's tenant catalogue,
   * cascade-cloning its parent template chain (category → department, or
   * department). Idempotent: any template already cloned returns the existing copy.
   */
  @Post(':id/clone')
  @Audit({
    module: AuditModule.SUB_CATEGORY,
    action: AuditAction.CREATE,
    description: 'Cloned a Site Admin sub-category template into the tenant',
  })
  clone(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.subCategoryService.cloneToTenant(id, tenantId);
  }
}
