import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PatientCategoryController } from './patient-category.controller';
import { PatientCategoryService } from './patient-category.service';

/**
 * Patient Category feature module. Tenant-scoped, tenant-level — manages a
 * business's patient pricing categories (e.g. General, VIP, Senior Citizen),
 * each mapped to a Lab Test List / Lab Panel List on the caller's active
 * branch. Lab test/panel selection validation is a plain scoped existence
 * check done directly via `PrismaService` (no cross-module service dependency
 * needed).
 */
@Module({
  imports: [PrismaModule],
  controllers: [PatientCategoryController],
  providers: [PatientCategoryService],
  exports: [PatientCategoryService],
})
export class PatientCategoryModule {}
