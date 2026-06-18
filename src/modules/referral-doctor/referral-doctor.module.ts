import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { CategoryModule } from '../category/category.module';
import { DepartmentModule } from '../department/department.module';
import { SubCategoryModule } from '../sub-category/sub-category.module';
import { ReferralPanelSettingsModule } from '../referral-panel-settings/referral-panel-settings.module';
import { ReferralDoctorController } from './referral-doctor.controller';
import { ReferralDoctorService } from './referral-doctor.service';

/**
 * Referral-doctor feature module. Tenant-scoped, tenant-level (CLAUDE.md §4.6) —
 * manages a business's registry of external referring doctors and their
 * qualifications/experiences/commission. Imports Department/Category/SubCategory
 * modules to validate a referral doctor's classification links via the exported
 * services (CLAUDE.md rule #3 — never import another service directly). Assigned
 * lab-test/panel references are validated against the `LabTest`/`LabPanel` models
 * directly via `PrismaService`. Exports `ReferralDoctorService` for future modules.
 */
@Module({
  imports: [
    PrismaModule,
    BranchModule,
    DepartmentModule,
    CategoryModule,
    SubCategoryModule,
    ReferralPanelSettingsModule,
  ],
  controllers: [ReferralDoctorController],
  providers: [ReferralDoctorService],
  exports: [ReferralDoctorService],
})
export class ReferralDoctorModule {}
