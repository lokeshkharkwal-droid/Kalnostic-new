import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DepartmentModule } from '../department/department.module';
import { CategoryModule } from '../category/category.module';
import { SubCategoryController } from './sub-category.controller';
import { SubCategoryService } from './sub-category.service';

/**
 * Sub-category feature module. Tenant-scoped, tenant-level — manages a
 * business's sub-categories (Independent, Under Department, or Under Category)
 * and the staff mapped to them. Imports DepartmentModule and CategoryModule to
 * validate the parent of an UNDER_DEPARTMENT / UNDER_CATEGORY sub-category via
 * their exported services (CLAUDE.md rule #3 — never import another service
 * directly).
 */
@Module({
  imports: [PrismaModule, DepartmentModule, CategoryModule],
  controllers: [SubCategoryController],
  providers: [SubCategoryService],
  exports: [SubCategoryService],
})
export class SubCategoryModule {}
