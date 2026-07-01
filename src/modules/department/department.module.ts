import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { DepartmentController } from './department.controller';
import { DepartmentOptionsController } from './department-options.controller';
import { SiteAdminDepartmentController } from './siteadmin-department.controller';
import { DepartmentService } from './department.service';

/**
 * Department feature module. Tenant-scoped, tenant-level — manages a business's
 * departments and the staff mapped to them, plus SiteAdmin global department
 * templates and business-side template cloning. Imports BranchModule to validate
 * a person mapping's optional `branchId` against the caller's tenant via the
 * exported BranchService (CLAUDE.md rule #3 — never import another service
 * directly).
 *
 * `DepartmentOptionsController` is listed before `DepartmentController` so
 * `GET /departments/templates` is matched there, not as `GET /departments/:id`.
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [
    DepartmentOptionsController,
    DepartmentController,
    SiteAdminDepartmentController,
  ],
  providers: [DepartmentService],
  exports: [DepartmentService],
})
export class DepartmentModule {}
