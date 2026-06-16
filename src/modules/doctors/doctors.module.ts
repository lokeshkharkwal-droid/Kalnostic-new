import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CategoryModule } from '../category/category.module';
import { DepartmentModule } from '../department/department.module';
import { DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';

/**
 * Doctors feature module. Tenant-scoped, tenant-level — manages a business's
 * registry of reporting/consultant doctors and their qualifications/experiences.
 * Imports DepartmentModule and CategoryModule to validate a doctor's
 * classification links via the exported services (CLAUDE.md rule #3 — never
 * import another service directly).
 */
@Module({
  imports: [PrismaModule, DepartmentModule, CategoryModule],
  controllers: [DoctorsController],
  providers: [DoctorsService],
  exports: [DoctorsService],
})
export class DoctorsModule {}
