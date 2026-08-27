import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { TechnicianSettingsController } from './technician-settings.controller';
import { TechnicianSettingsService } from './technician-settings.service';

/**
 * Technician › Laboratory settings module (Analytical TAT thresholds +
 * Laboratory Permissions). Tenant-scoped + branch-level. Imports
 * `BranchModule` to validate the active branch before reading/saving its
 * settings (`BranchService.findById`).
 */
@Module({
  imports: [PrismaModule, BranchModule, PermissionsModule],
  controllers: [TechnicianSettingsController],
  providers: [TechnicianSettingsService],
  exports: [TechnicianSettingsService],
})
export class TechnicianSettingsModule {}
