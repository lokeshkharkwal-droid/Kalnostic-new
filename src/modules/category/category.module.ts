import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { DepartmentModule } from '../department/department.module';
import { CategoryController } from './category.controller';
import { CategoryOptionsController } from './category-options.controller';
import { SiteAdminCategoryController } from './siteadmin-category.controller';
import { CategoryService } from './category.service';

/**
 * Category feature module. Tenant-scoped, tenant-level — manages a business's
 * categories (Independent or Under Department) and the staff mapped to them,
 * plus SiteAdmin global category templates and business-side template cloning.
 * Imports DepartmentModule to validate/clone the parent department of an
 * UNDER_DEPARTMENT category (tenant or SITE_ADMIN template), and BranchModule to
 * validate a person mapping's optional `branchId`, via their exported services
 * (CLAUDE.md rule #3 — never import another service directly).
 *
 * `CategoryOptionsController` is listed before `CategoryController` so
 * `GET /categories/templates` is matched there, not as `GET /categories/:id`.
 */
@Module({
  imports: [PrismaModule, DepartmentModule, BranchModule],
  controllers: [
    CategoryOptionsController,
    CategoryController,
    SiteAdminCategoryController,
  ],
  providers: [CategoryService],
  exports: [CategoryService],
})
export class CategoryModule {}
