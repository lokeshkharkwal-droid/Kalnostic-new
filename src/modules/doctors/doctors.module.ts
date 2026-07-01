import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { CategoryModule } from '../category/category.module';
import { SubCategoryModule } from '../sub-category/sub-category.module';
import { DepartmentModule } from '../department/department.module';
import { DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';

/**
 * Doctors feature module. Tenant-scoped — manages a business's registry of
 * reporting/consultant doctors, their qualifications/experiences, and their
 * per-branch assignments (role / availability / fees). Imports DepartmentModule,
 * CategoryModule, and SubCategoryModule to validate classification links, and
 * BranchModule to validate assigned branches, via the exported services
 * (CLAUDE.md rule #3 — never import another service directly).
 */
@Module({
  imports: [
    PrismaModule,
    DepartmentModule,
    CategoryModule,
    SubCategoryModule,
    BranchModule,
  ],
  controllers: [DoctorsController],
  providers: [DoctorsService],
  exports: [DoctorsService],
})
export class DoctorsModule {}
