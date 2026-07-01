import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { CategoryService } from './category.service';
import { ListCategoryQueryDto } from './dto/list-category-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Flat category endpoints (`/categories/...`) for the business side: browsing
 * SITE_ADMIN templates and cloning one into the tenant. Business-authenticated;
 * tenant comes from the JWT (global `JwtAuthGuard`).
 *
 * Registered BEFORE `CategoryController` so `GET /categories/templates` is
 * matched here and not captured by that controller's `GET /categories/:id`.
 */
@Controller('categories')
export class CategoryOptionsController {
  constructor(private readonly categoryService: CategoryService) {}

  /**
   * Browse SITE_ADMIN global template categories (read-only) so the tenant can
   * pick one to clone.
   */
  @Get('templates')
  findTemplates(@Query() query: ListCategoryQueryDto) {
    return this.categoryService.findAllTemplates(
      query.page ?? 1,
      query.limit ?? 20,
      {
        search: query.search,
        categoryType: query.categoryType,
        status: query.status,
        departmentId: query.departmentId,
      },
    );
  }

  /**
   * Fetch one SITE_ADMIN template category (read-only).
   */
  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.categoryService.findTemplateById(id);
  }

  /**
   * Clone a SITE_ADMIN template category into the caller's tenant catalogue,
   * cascade-cloning its parent department template (UNDER_DEPARTMENT). Idempotent:
   * a template (or parent) already cloned returns the existing copy.
   */
  @Post(':id/clone')
  @Audit({
    module: AuditModule.CATEGORY,
    action: AuditAction.CREATE,
    description: 'Cloned a Site Admin category template into the tenant',
  })
  clone(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.categoryService.cloneToTenant(id, tenantId);
  }
}
