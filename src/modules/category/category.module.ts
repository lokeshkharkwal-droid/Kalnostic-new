import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DepartmentModule } from '../department/department.module';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';

/**
 * Category feature module. Tenant-scoped, tenant-level — manages a business's
 * categories (Independent or Under Department) and the staff mapped to them.
 * Imports DepartmentModule to validate the parent department of an
 * UNDER_DEPARTMENT category via the exported DepartmentService (CLAUDE.md
 * rule #3 — never import another service directly).
 */
@Module({
  imports: [PrismaModule, DepartmentModule],
  controllers: [CategoryController],
  providers: [CategoryService],
  exports: [CategoryService],
})
export class CategoryModule {}
