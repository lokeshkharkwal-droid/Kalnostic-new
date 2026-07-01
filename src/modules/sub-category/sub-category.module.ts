import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { DepartmentModule } from '../department/department.module';
import { CategoryModule } from '../category/category.module';
import { SubCategoryController } from './sub-category.controller';
import { SubCategoryOptionsController } from './sub-category-options.controller';
import { SiteAdminSubCategoryController } from './siteadmin-sub-category.controller';
import { SubCategoryService } from './sub-category.service';

/**
 * Sub-category feature module. Tenant-scoped, tenant-level — manages a
 * business's sub-categories (Independent, Under Department, or Under Category)
 * and the staff mapped to them, plus SiteAdmin global sub-category templates and
 * business-side template cloning. Imports DepartmentModule and CategoryModule to
 * validate/clone the parent of an UNDER_DEPARTMENT / UNDER_CATEGORY sub-category
 * (tenant or SITE_ADMIN template), and BranchModule to validate a person
 * mapping's optional `branchId`, via their exported services (CLAUDE.md rule #3
 * — never import another service directly).
 *
 * `SubCategoryOptionsController` is listed before `SubCategoryController` so
 * `GET /sub-categories/templates` is matched there, not as `GET /sub-categories/:id`.
 */
@Module({
  imports: [PrismaModule, DepartmentModule, CategoryModule, BranchModule],
  controllers: [
    SubCategoryOptionsController,
    SubCategoryController,
    SiteAdminSubCategoryController,
  ],
  providers: [SubCategoryService],
  exports: [SubCategoryService],
})
export class SubCategoryModule {}
