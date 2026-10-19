import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { CategoryModule } from '../category/category.module';
import { SubCategoryModule } from '../sub-category/sub-category.module';
import { DepartmentModule } from '../department/department.module';
import { RadiologyReportingDoctorController } from './radiology-reporting-doctor.controller';
import { RadiologyReportingDoctorOptionsController } from './radiology-reporting-doctor-options.controller';
import { RadiologyReportingDoctorService } from './radiology-reporting-doctor.service';

/**
 * Radiology Reporting Doctor feature module (the "Reporting Doctors" master under
 * Radiology Configuration). Tenant-scoped + optionally branch-scoped. The model is
 * FLAT — no qualification/experience/schedule/slot child tables. Imports
 * DepartmentModule, CategoryModule, and SubCategoryModule to validate the logical
 * classification refs, and BranchModule to validate the assigned branch, via the
 * exported services (CLAUDE.md rule #3 — never import another service directly).
 */
@Module({
  imports: [
    PrismaModule,
    DepartmentModule,
    CategoryModule,
    SubCategoryModule,
    BranchModule,
  ],
  controllers: [
    RadiologyReportingDoctorOptionsController,
    RadiologyReportingDoctorController,
  ],
  providers: [RadiologyReportingDoctorService],
  exports: [RadiologyReportingDoctorService],
})
export class RadiologyReportingDoctorModule {}
